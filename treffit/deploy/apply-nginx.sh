#!/usr/bin/env bash
#
# Обновляет конфиг nginx из шаблона репозитория.
#
#   sudo bash deploy/apply-nginx.sh            домен возьмёт из backend/.env
#   sudo bash deploy/apply-nginx.sh treffit.ru домен указан явно
#
# deploy/nginx.conf — шаблон, а не готовый файл: в нём стоят
# treffit.example.com и /srv/treffit/frontend. Скопировать его в
# sites-available как есть нельзя — nginx не найдёт ни сертификат, ни
# собранный фронтенд. Подстановкой обычно занимается finish-tls.sh, но
# гонять его целиком ради одной правки конфига незачем: он лезет за
# сертификатом и переустанавливает вебхук бота.
#
# Скрипт не трогает ничего до того, как новый конфиг пройдёт nginx -t, и
# откатывается, если проверка не прошла.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
TEMPLATE="$REPO_ROOT/deploy/nginx.conf"
SITE=/etc/nginx/sites-available/treffit

RED=$'\033[31m'; GREEN=$'\033[32m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
ok()  { printf '  %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
die() { printf '\n%sОшибка:%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Запускайте через sudo."
[ -f "$TEMPLATE" ] || die "Не нашёл шаблон $TEMPLATE"

# Имя хоста из адреса в .env. Берём только то, что до первого слэша:
# PUBLIC_URL записан как https://домен/api, и путь в имя домена попасть
# не должен.
read_host() {
    sed -n "s#^$1=https\?://\([^/:]*\).*#\1#p" "$ENV_FILE" 2>/dev/null | tail -1
}

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ] && [ -f "$ENV_FILE" ]; then
    # MINI_APP_URL — это ровно адрес сайта, без пути; PUBLIC_URL на случай,
    # если первого в файле почему-то нет.
    DOMAIN="$(read_host TREFFIT_MINI_APP_URL)"
    [ -n "$DOMAIN" ] || DOMAIN="$(read_host TREFFIT_PUBLIC_URL)"
fi
[ -n "$DOMAIN" ] || die "Не смог определить домен. Укажите: sudo bash deploy/apply-nginx.sh ваш.домен"

CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
[ -f "$CERT" ] || die "Нет сертификата для $DOMAIN ($CERT). Сначала deploy/finish-tls.sh"

printf '\n%sДомен:%s %s\n%sФронтенд:%s %s/frontend/dist\n\n' \
    "$BOLD" "$OFF" "$DOMAIN" "$BOLD" "$OFF" "$REPO_ROOT"

BACKUP=""
if [ -f "$SITE" ]; then
    BACKUP="$SITE.bak.$(date +%s)"
    cp "$SITE" "$BACKUP"
    ok "старый конфиг сохранён: $BACKUP"
fi

# Те же две подстановки, что делает finish-tls.sh.
sed -e "s/treffit.example.com/$DOMAIN/g" \
    -e "s#/srv/treffit/frontend#${REPO_ROOT}/frontend#g" \
    "$TEMPLATE" > "$SITE"
ln -sf "$SITE" /etc/nginx/sites-enabled/treffit
rm -f /etc/nginx/sites-enabled/default

if ! nginx -t; then
    if [ -n "$BACKUP" ]; then
        cp "$BACKUP" "$SITE"
        printf '  вернул прежний конфиг, nginx не тронут\n'
    else
        rm -f "$SITE" /etc/nginx/sites-enabled/treffit
    fi
    die "новый конфиг не прошёл проверку — выше видно, на чём"
fi

systemctl reload nginx
ok "nginx перезагружен"
