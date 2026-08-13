#!/usr/bin/env bash
#
# Завершает установку: сертификат → боевой nginx → вебхук бота.
#
#   sudo bash deploy/finish-tls.sh treffit.ru ваша@почта
#
# Порядок здесь важен, поэтому он зашит в скрипт: боевой конфиг nginx
# ссылается на файлы сертификата, и до первого выпуска `nginx -t` на нём
# не проходит. Скрипт идемпотентный — повторный запуск ничего не портит.
#
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "Использование: sudo bash deploy/finish-tls.sh ВАШ.ДОМЕН ваша@почта"
    exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
SITE=/etc/nginx/sites-available/treffit
SERVICE_USER=treffit

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
STEP=0
step() { STEP=$((STEP + 1)); printf '\n%s[%d/5] %s%s\n' "$BOLD" "$STEP" "$1" "$OFF"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$OFF" "$1"; }
die()  { printf '\n%sОшибка:%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Запускайте через sudo."
[ -f "$ENV_FILE" ] || die "Не нашёл $ENV_FILE — сначала deploy/bootstrap.sh"

# ------------------------------------------------------------- 1. DNS

step "Проверка DNS"
SERVER_IP="$(curl -s --max-time 10 ifconfig.me || true)"
RESOLVED="$(dig +short A "$DOMAIN" @8.8.8.8 2>/dev/null | tail -1 || true)"
[ -n "$RESOLVED" ] || die "$DOMAIN пока не резолвится. Проверьте: bash deploy/check-dns.sh $DOMAIN"
if [ -n "$SERVER_IP" ] && [ "$RESOLVED" != "$SERVER_IP" ]; then
    die "$DOMAIN указывает на $RESOLVED, а сервер — $SERVER_IP"
fi
ok "$DOMAIN → $RESOLVED"

# ------------------------------------------------------- 2. сертификат

step "Сертификат Let's Encrypt"
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    warn "сертификат уже есть, пропускаю выпуск"
else
    # Проверка http-01 идёт на 80-й порт, поэтому сначала поднимаем
    # временный конфиг, отдающий каталог с challenge.
    mkdir -p /var/www/certbot
    sed "s/treffit.example.com/$DOMAIN/g" "$REPO_ROOT/deploy/nginx-acme.conf" > "$SITE"
    ln -sf "$SITE" /etc/nginx/sites-enabled/treffit
    rm -f /etc/nginx/sites-enabled/default
    nginx -t >/dev/null 2>&1 || die "временный конфиг nginx не проходит проверку"
    systemctl reload nginx
    ok "временный http-конфиг поднят"

    certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
        --agree-tos --no-eff-email -m "$EMAIL" \
        --deploy-hook "systemctl reload nginx" \
        || die "certbot не выпустил сертификат, подробности в /var/log/letsencrypt/letsencrypt.log"
    ok "сертификат выпущен"
fi

# ---------------------------------------------------------- 3. nginx

step "Боевой конфиг nginx"
sed -e "s/treffit.example.com/$DOMAIN/g" \
    -e "s#/srv/treffit/frontend#${REPO_ROOT}/frontend#g" \
    "$REPO_ROOT/deploy/nginx.conf" > "$SITE"
ln -sf "$SITE" /etc/nginx/sites-enabled/treffit
nginx -t || die "боевой конфиг не проходит проверку"
systemctl reload nginx
ok "nginx перезагружен"

# -sS вместо -s: без этого настоящая причина (отказ соединения, TLS,
# закрытый порт) молча теряется и остаётся бесполезное «пусто».
HEALTH="$(curl -sS --max-time 10 "https://$DOMAIN/api/health" 2>/tmp/treffit-curl.err || true)"

if [ "$HEALTH" != '{"status":"ok"}' ]; then
    # Многие VPS не маршрутизируют собственный внешний IP обратно на себя
    # (hairpin NAT). Снаружи всё работает, а запрос с самого сервера не
    # доходит — поэтому пробуем ещё раз, но через loopback.
    LOCAL="$(curl -sS --max-time 10 --resolve "${DOMAIN}:443:127.0.0.1" \
        "https://$DOMAIN/api/health" 2>/dev/null || true)"
    if [ "$LOCAL" = '{"status":"ok"}' ]; then
        warn "снаружи проверить не удалось (hairpin NAT), но локально nginx отвечает"
        HEALTH="$LOCAL"
    fi
fi

if [ "$HEALTH" != '{"status":"ok"}' ]; then
    echo
    printf '%sНе достучались до https://%s/api/health%s\n' "$RED$BOLD" "$DOMAIN" "$OFF"
    printf '  ответ curl: %s\n' "${HEALTH:-(пусто)}"
    printf '  ошибка curl: %s\n' "$(cat /tmp/treffit-curl.err 2>/dev/null || echo '-')"
    echo
    echo "--- бэкенд напрямую ---"
    curl -sS --max-time 5 http://127.0.0.1:8000/health || echo "(бэкенд не отвечает)"
    echo
    echo "--- сервис ---"
    systemctl is-active treffit-api || true
    echo "--- слушающие порты ---"
    ss -lntp 2>/dev/null | grep -E ':(80|443|8000)\b' || echo "(80/443/8000 никто не слушает)"
    echo "--- последние ошибки nginx ---"
    tail -n 10 /var/log/nginx/error.log 2>/dev/null || echo "(лог пуст)"
    echo
    echo "Чаще всего это закрытый извне порт 443: certbot проверялся по 80,"
    echo "и 80 открыт, а 443 мог остаться закрытым в firewall или в панели"
    echo "провайдера. Проверьте ufw и firewall в панели Aeza."
    die "проверка https не прошла"
fi
ok "https://$DOMAIN/api/health → $HEALTH"

# ------------------------------------------------------------ 4. .env

step "Проверка .env"
missing=""
for key in TREFFIT_BOT_TOKEN TREFFIT_MINI_APP_URL; do
    grep -qE "^${key}=.+" "$ENV_FILE" || missing="$missing $key"
done
[ -z "$missing" ] || die "в $ENV_FILE не заполнено:$missing"

# Эти два всегда выводятся из домена — подставляем, чтобы не расходились.
for pair in "TREFFIT_PUBLIC_URL=https://$DOMAIN/api" "TREFFIT_CORS_ORIGINS=https://$DOMAIN"; do
    key="${pair%%=*}"
    if grep -q "^${key}=" "$ENV_FILE"; then
        sed -i "s#^${key}=.*#${pair}#" "$ENV_FILE"
    else
        echo "$pair" >> "$ENV_FILE"
    fi
done
chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"
systemctl restart treffit-api
ok "PUBLIC_URL и CORS выставлены на https://$DOMAIN, сервис перезапущен"

# ----------------------------------------------------------- 5. вебхук

step "Регистрация вебхука"
cd "$REPO_ROOT/backend"
sudo -u "$SERVICE_USER" env $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs -d '\n') \
    .venv/bin/python -m scripts.setup_bot || die "setup_bot не отработал"
echo
sudo -u "$SERVICE_USER" env $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs -d '\n') \
    .venv/bin/python -m scripts.setup_bot --status

cat <<DONE

${GREEN}${BOLD}Всё поднято.${OFF} Осталась проверка в живом Telegram:

  1. Напишите боту /start — должно прийти приветствие с кнопкой.
  2. Откройте Mini App. Экрана «Dev Login» быть НЕ должно: если он есть,
     значит initData не прошёл проверку (обычно токен не от того бота).
  3. Пройдите онбординг: согласия → анкета → фильтры → фото → тест.
  4. Со второго аккаунта поставьте взаимный лайк — попап матча должен
     появиться у обоих без перезагрузки (это проверка WebSocket).
  5. Закройте приложение на втором аккаунте и напишите ему — должен
     прийти push от бота.

Логи, если что-то пойдёт не так:  journalctl -u treffit-api -f
Полный список проверок:           docs/deploy.md, раздел 10
DONE
