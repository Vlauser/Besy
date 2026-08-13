#!/usr/bin/env bash
#
# Отвечает на один вопрос: можно ли уже выпускать сертификат?
#
#   bash deploy/check-dns.sh treffit.ru
#
# Спрашивает и публичный резолвер, и авторитетные серверы домена. Это
# разделяет «записи ещё расходятся по кэшам» и «зона вообще не поднята
# у регистратора» — лечатся они по-разному.
#
set -uo pipefail

DOMAIN="${1:-}"
[ -n "$DOMAIN" ] || { echo "Использование: bash deploy/check-dns.sh ВАШ.ДОМЕН"; exit 2; }

GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; OFF=$'\033[0m'

command -v dig >/dev/null || { echo "Нужен dig: apt install -y dnsutils"; exit 2; }

SERVER_IP="$(curl -s --max-time 10 ifconfig.me || echo '')"
echo "${BOLD}Домен:${OFF} $DOMAIN"
echo "${BOLD}IP этого сервера:${OFF} ${SERVER_IP:-не удалось определить}"
echo

# Авторитетные серверы берём из реестра, а не из панели: важно то, что
# видит остальной интернет.
NS_LIST="$(dig +short NS "$DOMAIN" 2>/dev/null | sed 's/\.$//')"
if [ -z "$NS_LIST" ]; then
    NS_LIST="$(whois "$DOMAIN" 2>/dev/null | awk '/^nserver:/ {print $2}' | sed 's/\.$//' | head -4)"
    [ -n "$NS_LIST" ] && echo "${YELLOW}NS в зоне ещё не опубликованы, беру из whois${OFF}"
fi

PUBLIC_IP="$(dig +short A "$DOMAIN" @8.8.8.8 2>/dev/null | tail -1)"
printf '%-26s %s\n' "8.8.8.8 (публичный):" "${PUBLIC_IP:-пусто}"

AUTH_ANSWERED=""
for ns in $NS_LIST; do
    answer="$(dig +short A "$DOMAIN" "@${ns}" 2>/dev/null | tail -1)"
    printf '%-26s %s\n' "${ns} (авторитетный):" "${answer:-пусто}"
    [ -n "$answer" ] && AUTH_ANSWERED="$answer"
done
[ -n "$NS_LIST" ] || printf '%-26s %s\n' "авторитетные:" "не найдены"

echo
if [ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" = "$SERVER_IP" ]; then
    echo "${GREEN}${BOLD}Готово к выпуску сертификата.${OFF}"
    echo "Дальше:  sudo bash deploy/finish-tls.sh $DOMAIN ваша@почта"
    exit 0
fi

if [ -n "$PUBLIC_IP" ] && [ -n "$SERVER_IP" ] && [ "$PUBLIC_IP" != "$SERVER_IP" ]; then
    echo "${RED}${BOLD}Домен указывает не на этот сервер.${OFF}"
    echo "Ожидался $SERVER_IP, получено $PUBLIC_IP — поправьте A-запись."
    exit 1
fi

if [ -n "$AUTH_ANSWERED" ]; then
    echo "${YELLOW}${BOLD}Зона поднята, но публичные резолверы её ещё не видят.${OFF}"
    echo "Обычное дело: подождите 10–30 минут и запустите проверку снова."
    exit 1
fi

echo "${RED}${BOLD}Зона не опубликована.${OFF}"
echo "Авторитетные серверы домена сами отвечают, что записи нет."
echo "Для только что зарегистрированного домена это норма первые 1–2 часа."
echo "Если дольше — это вопрос к регистратору, а не к настройкам сервера."
exit 1
