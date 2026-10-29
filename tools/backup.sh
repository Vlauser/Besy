#!/bin/bash
# Резервное копирование сайта AXIOMANTIC.
#
#   bash /var/www/axiomantic/tools/backup.sh
#
# Кладёт архив в /var/backups/axiomantic, хранит последние 14 штук.
# Если в админке заполнены токен бота и chat_id, копия содержимого
# уходит ещё и в Telegram — тогда она лежит вне сервера и переживёт
# даже его полную потерю.
#
# Раз в сутки в 4 утра:
#   crontab -e
#   0 4 * * * bash /var/www/axiomantic/tools/backup.sh >/dev/null 2>&1

set -u

SITE_ROOT="${SITE_ROOT:-/var/www/axiomantic}"
DEST="${DEST:-/var/backups/axiomantic}"
KEEP="${KEEP:-14}"

[ -f "$SITE_ROOT/inc/config.php" ] || { echo "Не нахожу сайт в $SITE_ROOT"; exit 1; }

# DATA_DIR может быть вынесена за корень сайта — спрашиваем у самого движка
DATA_DIR=$(php -r "require '$SITE_ROOT/inc/config.php'; echo DATA_DIR;" 2>/dev/null)
[ -d "$DATA_DIR" ] || { echo "Не нахожу папку данных ($DATA_DIR)"; exit 1; }

mkdir -p "$DEST" || exit 1
chmod 700 "$DEST"

STAMP=$(date +%Y-%m-%d-%H%M)
DATA_ARC="$DEST/data-$STAMP.tar.gz"
FULL_ARC="$DEST/full-$STAMP.tar.gz"

# 1. Содержимое, заявки, учётки — маленький архив, его же шлём в Telegram
tar czf "$DATA_ARC" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")" || exit 1

# 2. Полный архив: данные плюс загруженные картинки
if [ -d "$SITE_ROOT/uploads" ]; then
    tar czf "$FULL_ARC" \
        -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")" \
        -C "$SITE_ROOT" uploads || exit 1
else
    cp "$DATA_ARC" "$FULL_ARC"
fi

chmod 600 "$DATA_ARC" "$FULL_ARC"
echo "Готово: $(du -h "$FULL_ARC" | cut -f1)  $FULL_ARC"

# 3. Копия содержимого в Telegram — если бот настроен в админке
TOKEN=$(php -r "require '$SITE_ROOT/inc/config.php'; require '$SITE_ROOT/inc/store.php'; echo trim((string)c('integrations.telegram_token'));" 2>/dev/null)
CHAT=$(php -r "require '$SITE_ROOT/inc/config.php'; require '$SITE_ROOT/inc/store.php'; echo trim((string)c('integrations.telegram_chat_id'));" 2>/dev/null)

# Получателей в настройках может быть несколько через запятую —
# телеграму такую строку целиком отдавать нельзя, он её не поймёт.
CHATS=$(echo "$CHAT" | tr ',;' '  ')

if [ -n "$TOKEN" ] && [ -n "$CHATS" ]; then
    SIZE=$(stat -c%s "$DATA_ARC")
    if [ "$SIZE" -lt 47000000 ]; then
        SENT=0
        for ID in $CHATS; do
            curl -s -o /dev/null --max-time 60 \
                 -F "chat_id=$ID" \
                 -F "caption=Копия сайта $(date '+%d.%m.%Y %H:%M')" \
                 -F "document=@$DATA_ARC" \
                 "https://api.telegram.org/bot$TOKEN/sendDocument" \
              && SENT=$((SENT+1)) \
              || echo "Не удалось отправить копию адресату $ID"
        done
        [ "$SENT" -gt 0 ] && echo "Копия отправлена в Telegram, адресатов: $SENT"
    else
        echo "Архив крупнее 47 МБ — в Telegram не отправляю"
    fi
else
    echo "Бот не настроен — копия только на сервере"
fi

# 4. Убираем старые
find "$DEST" -name 'data-*.tar.gz' -type f -printf '%T@ %p\n' | sort -rn | tail -n +$((KEEP+1)) | cut -d' ' -f2- | xargs -r rm -f
find "$DEST" -name 'full-*.tar.gz' -type f -printf '%T@ %p\n' | sort -rn | tail -n +$((KEEP+1)) | cut -d' ' -f2- | xargs -r rm -f

echo "Копий на сервере: $(find "$DEST" -name 'full-*.tar.gz' | wc -l), храним последние $KEEP"
