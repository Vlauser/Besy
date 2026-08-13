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

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ] && [ -f "$ENV_FILE" ]; then
    # PUBLIC_URL пишет finish-tls.sh, из него и берём домен.
    DOMAIN="$(sed -n 's#^TREFFIT_PUBLIC_URL=https\?://##p' "$ENV_FILE" | tr -d '/' | tail -1)"
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
