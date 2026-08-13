#!/usr/bin/env bash
#
# Первичная установка Treffit на чистый Ubuntu 20.04/22.04/24.04.
#
# Делает шаги 1–7 из docs/deploy.md: пакеты, пользователь, база, venv,
# зависимости, миграции, сборка фронтенда, systemd. Домен, TLS и настройку
# бота НЕ трогает — это шаги 8–9, они требуют вашего домена и токена.
#
#   sudo bash deploy/bootstrap.sh
#
# Скрипт идемпотентный: повторный запуск ничего не ломает и, что важнее,
# НЕ перегенерирует .env — иначе сменился бы SECRET_KEY, а это разлогинит
# всех и сломает секрет вебхука.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRV=/srv/treffit
SERVICE_USER=treffit
NODE_MAJOR=20

# Код использует StrEnum, asyncio.to_thread и Path.is_relative_to —
# минимум 3.11. На Ubuntu 20.04 системный python3 это 3.8, поэтому нужный
# интерпретатор ставится отдельно.
PYTHON_MIN="3.11"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
STEP=0

step()  { STEP=$((STEP + 1)); printf '\n%s[%d/9] %s%s\n' "$BOLD" "$STEP" "$1" "$OFF"; }
psql_as_postgres() { (cd /tmp && sudo -u postgres psql "$@"); }

find_python() {
    local candidate
    for candidate in python3.13 python3.12 python3.11; do
        command -v "$candidate" >/dev/null 2>&1 && { echo "$candidate"; return 0; }
    done
    if command -v python3 >/dev/null 2>&1 \
       && python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'; then
        echo python3
        return 0
    fi
    return 1
}
ok()    { printf '  %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn()  { printf '  %s!%s %s\n' "$YELLOW" "$OFF" "$1"; }
die()   { printf '\n%sОшибка:%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Запускайте через sudo."
[ -f "$REPO_ROOT/backend/requirements.txt" ] || die "Не нашёл backend/ рядом со скриптом. Запускайте из клонированного репозитория."

# ---------------------------------------------------------------- 1. пакеты

step "Системные пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
    build-essential postgresql redis-server nginx certbot python3-certbot-nginx \
    git curl ca-certificates gnupg software-properties-common >/dev/null
ok "postgres, redis, nginx"

if ! PYTHON="$(find_python)"; then
    warn "нужен Python >= ${PYTHON_MIN}, ставлю python3.11"
    if ! apt-get install -y -qq python3.11 python3.11-venv python3.11-dev >/dev/null 2>&1; then
        # На 20.04 python3.11 есть только в deadsnakes.
        add-apt-repository -y ppa:deadsnakes/ppa >/dev/null 2>&1 \
            || die "не удалось подключить ppa:deadsnakes/ppa — поставьте Python 3.11 вручную"
        apt-get update -qq
        apt-get install -y -qq python3.11 python3.11-venv python3.11-dev >/dev/null \
            || die "python3.11 не установился"
    fi
    # На 20.04 часть сборок всё ещё зовёт distutils; на новых он не нужен.
    apt-get install -y -qq python3.11-distutils >/dev/null 2>&1 || true
    PYTHON="$(find_python)" || die "python3.11 установлен, но не найден в PATH"
fi
ok "$PYTHON $($PYTHON -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"

if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 18 ]; then
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq && apt-get install -y -qq nodejs >/dev/null
fi
ok "node $(node -v)"

systemctl enable --now postgresql redis-server >/dev/null 2>&1 || true
systemctl is-active --quiet postgresql   || die "postgresql не запустился"
systemctl is-active --quiet redis-server || die "redis не запустился"
ok "postgresql и redis работают"

# ------------------------------------------------------- 2. пользователь и пути

step "Пользователь и каталоги"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    adduser --system --group --home "$SRV" --no-create-home "$SERVICE_USER" >/dev/null
fi
mkdir -p "$SRV" "$SRV/backups"
ln -sfn "$REPO_ROOT/backend"  "$SRV/backend"
ln -sfn "$REPO_ROOT/frontend" "$SRV/frontend"
mkdir -p "$REPO_ROOT/backend/var/media"
chown -R "$SERVICE_USER:$SERVICE_USER" "$SRV/backups" "$REPO_ROOT/backend/var"
ok "$SRV/backend → $REPO_ROOT/backend"

# ------------------------------------------------------------------ 3. база

step "База данных"
DB_EXISTS=$(psql_as_postgres -tAc "SELECT 1 FROM pg_database WHERE datname='treffit'" || true)
if [ "$DB_EXISTS" = "1" ]; then
    warn "база treffit уже есть, пароль не меняю"
    DB_PASSWORD=""
else
    DB_PASSWORD="$(openssl rand -hex 24)"
    psql_as_postgres -q <<SQL
CREATE USER treffit WITH PASSWORD '${DB_PASSWORD}';
CREATE DATABASE treffit OWNER treffit;
SQL
    ok "база и роль treffit созданы"
fi

# --------------------------------------------------------------- 4. окружение

step "Файл .env"
ENV_FILE="$REPO_ROOT/backend/.env"
if [ -f "$ENV_FILE" ]; then
    warn ".env уже существует — оставляю как есть (секреты не перегенерирую)"
else
    [ -n "$DB_PASSWORD" ] || die ".env отсутствует, но база уже создана — впишите пароль в .env вручную"
    cat > "$ENV_FILE" <<ENV
# Сгенерировано deploy/bootstrap.sh $(date -Is)
TREFFIT_SECRET_KEY=$(openssl rand -hex 32)
TREFFIT_DATABASE_URL=postgresql+asyncpg://treffit:${DB_PASSWORD}@localhost:5432/treffit
TREFFIT_REDIS_URL=redis://localhost:6379/0
TREFFIT_MEDIA_ROOT=${REPO_ROOT}/backend/var/media

# --- заполните перед шагом 9 (настройка бота) ---
TREFFIT_BOT_TOKEN=
TREFFIT_MINI_APP_URL=
TREFFIT_PUBLIC_URL=
TREFFIT_CORS_ORIGINS=
TREFFIT_ADMIN_TELEGRAM_IDS=

# --- правила продукта ---
TREFFIT_BLIND_MODE=true
TREFFIT_REVEAL_THRESHOLD=3

# Никогда не включайте на проде: даёт сессию на любой telegram_id.
TREFFIT_ALLOW_DEV_AUTH=false
ENV
    ok "создан $ENV_FILE"
fi
chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ------------------------------------------------------------ 5. python-среда

step "Python-окружение (несколько минут: onnxruntime тяжёлый)"
cd "$REPO_ROOT/backend"
# Окружение, собранное старым интерпретатором, надо пересоздать, иначе
# pip продолжит ставить пакеты под него.
if [ -d .venv ] && ! .venv/bin/python -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
    warn "существующий .venv собран старым Python — пересоздаю"
    rm -rf .venv
fi
[ -d .venv ] || "$PYTHON" -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
chown -R "$SERVICE_USER:$SERVICE_USER" .venv
.venv/bin/python -c "import fastapi, nudenet, redis" || die "зависимости не встали"
ok "venv готов, модель модерации на месте"

# ---------------------------------------------------------------- 6. миграции

step "Миграции"
sudo -u "$SERVICE_USER" env $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs -d '\n') \
    .venv/bin/alembic upgrade head >/dev/null
# Без -d psql уходит в базу postgres и всегда насчитывает ноль таблиц.
TABLES=$(psql_as_postgres -d treffit -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
[ "$TABLES" -ge 15 ] || die "ожидал минимум 15 таблиц, вижу $TABLES"
ok "схема накатана ($TABLES таблиц)"

# ------------------------------------------------------------- 7. фронтенд

step "Сборка фронтенда"
cd "$REPO_ROOT/frontend"
npm ci --silent --no-audit --no-fund
npm run build --silent
[ -f dist/index.html ] || die "сборка не создала dist/index.html"
chown -R "$SERVICE_USER:$SERVICE_USER" dist
ok "dist/ собран ($(du -sh dist | cut -f1))"

# --------------------------------------------------------------- 8. systemd

step "Сервисы systemd"
# ProtectHome=true прячет /home и /root от сервиса. Если репозиторий лежит
# там, юнит стартовал бы с невнятной ошибкой «нет такого файла».
HOME_GUARD="s#^ProtectHome=true#ProtectHome=true#"
case "$REPO_ROOT" in
    /home/*|/root/*)
        warn "репозиторий в $REPO_ROOT — отключаю ProtectHome в юните"
        warn "для прода лучше держать код в /srv или /opt"
        HOME_GUARD="s#^ProtectHome=true#ProtectHome=false#"
        ;;
esac

for unit in "$REPO_ROOT"/deploy/treffit-*.service "$REPO_ROOT"/deploy/treffit-*.timer; do
    # Юниты написаны под /srv/treffit — подставляем реальный путь клона.
    sed -e "s#/srv/treffit/backend#${REPO_ROOT}/backend#g" -e "$HOME_GUARD" "$unit" \
        > "/etc/systemd/system/$(basename "$unit")"
done
systemctl daemon-reload
systemctl enable --now treffit-api treffit-sync.timer treffit-backup.timer >/dev/null 2>&1
sleep 4
systemctl is-active --quiet treffit-api || {
    journalctl -u treffit-api -n 30 --no-pager
    die "treffit-api не поднялся, лог выше"
}
ok "treffit-api запущен, таймеры синка и бэкапа включены"

# --------------------------------------------------------------- 9. проверка

step "Проверка"
for attempt in $(seq 1 10); do
    if curl -fsS --max-time 3 http://127.0.0.1:8000/health >/dev/null 2>&1; then break; fi
    [ "$attempt" -eq 10 ] && die "API не отвечает на /health"
    sleep 1
done
ok "GET /health → $(curl -fsS http://127.0.0.1:8000/health)"
ok "GET /config → $(curl -fsS http://127.0.0.1:8000/config | head -c 60)…"

cat <<DONE

${GREEN}${BOLD}Бэкенд поднят.${OFF} Дальше руками — нужны ваш домен и токен:

  ${BOLD}1. nginx и TLS${OFF}
     cp ${REPO_ROOT}/deploy/nginx.conf /etc/nginx/sites-available/treffit
     sed -i 's/treffit.example.com/ВАШ.ДОМЕН/g' /etc/nginx/sites-available/treffit
     sed -i 's#/srv/treffit/frontend#${REPO_ROOT}/frontend#g' /etc/nginx/sites-available/treffit
     ln -sf /etc/nginx/sites-available/treffit /etc/nginx/sites-enabled/treffit
     rm -f /etc/nginx/sites-enabled/default
     mkdir -p /var/www/certbot && nginx -t && systemctl reload nginx
     certbot --nginx -d ВАШ.ДОМЕН

  ${BOLD}2. Впишите в ${ENV_FILE}${OFF}
     TREFFIT_BOT_TOKEN=<токен от BotFather>
     TREFFIT_MINI_APP_URL=https://t.me/<ваш_бот>/app
     TREFFIT_PUBLIC_URL=https://ВАШ.ДОМЕН/api
     TREFFIT_CORS_ORIGINS=https://ВАШ.ДОМЕН
     TREFFIT_ADMIN_TELEGRAM_IDS=<ваш telegram_id>
     затем: systemctl restart treffit-api

  ${BOLD}3. В BotFather${OFF}: /newapp → бот, короткое имя app, URL https://ВАШ.ДОМЕН

  ${BOLD}4. Регистрация вебхука${OFF}
     cd ${REPO_ROOT}/backend
     sudo -u ${SERVICE_USER} env \$(grep -v '^#' .env | grep -v '^\$' | xargs -d '\\n') \\
         .venv/bin/python -m scripts.setup_bot
     ... и затем --status для проверки

  ${BOLD}5.${OFF} Раздел 10 в docs/deploy.md — проверка в живом Telegram.

DONE
