#!/bin/bash
# Обновление сайта AXIOMANTIC из архива.
#
#   bash /var/www/axiomantic/tools/obnovit.sh /root/axiomantic-novyy.zip
#
# Порядок такой, чтобы обновление нельзя было испортить:
#   1. снимает резервную копию;
#   2. распаковывает архив во временную папку;
#   3. переносит на сайт всё, КРОМЕ data, uploads и config.local.php;
#   4. чинит права и убирает установщик;
#   5. прогоняет проверку сайта.
#
# Содержимое, картинки и настройки путей не трогаются никогда.

set -eu

ARCHIVE="${1:-}"
SITE_ROOT="${SITE_ROOT:-/var/www/axiomantic}"
WEB_USER="${WEB_USER:-www-data}"

[ -n "$ARCHIVE" ] || { echo "Укажите архив: bash $0 /root/arhiv.zip"; exit 1; }
[ -f "$ARCHIVE" ]  || { echo "Не нахожу файл $ARCHIVE"; exit 1; }
[ -f "$SITE_ROOT/inc/config.php" ] || { echo "Не нахожу сайт в $SITE_ROOT"; exit 1; }
command -v unzip >/dev/null || { echo "Нет unzip: apt install -y unzip"; exit 1; }

echo "== 1. Резервная копия =="
bash "$SITE_ROOT/tools/backup.sh" || { echo "Копия не сделалась — обновление отменено"; exit 1; }

echo
echo "== 2. Распаковка =="
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
unzip -q "$ARCHIVE" -d "$TMP"

# Архив может быть как с файлами в корне, так и с одной папкой внутри
SRC="$TMP"
[ -f "$SRC/index.php" ] || SRC=$(find "$TMP" -maxdepth 2 -name index.php -printf '%h\n' | head -1)
[ -n "$SRC" ] && [ -f "$SRC/index.php" ] || { echo "В архиве нет index.php — это не тот файл"; exit 1; }

echo "Найдено файлов: $(find "$SRC" -type f | wc -l)"

echo
echo "== 3. Перенос на сайт =="
# Исключения берегут всё, что принадлежит именно этому серверу
if command -v rsync >/dev/null; then
    rsync -a --delete \
          --exclude 'data/' \
          --exclude 'uploads/' \
          --exclude 'config.local.php' \
          "$SRC"/ "$SITE_ROOT"/
    echo "Код и оформление обновлены, data и uploads не тронуты"
else
    # Без rsync копируем через tar. Разница одна: файлы, которых в новой
    # версии больше нет, останутся на диске. На работу это не влияет.
    rm -rf "$SRC/data" "$SRC/uploads" "$SRC/config.local.php"
    (cd "$SRC" && tar cf - .) | (cd "$SITE_ROOT" && tar xf -)
    echo "Код и оформление обновлены, data и uploads не тронуты"
    echo "Внимание: без rsync старые лишние файлы не удаляются."
    echo "Поставить: apt install -y rsync"
fi

echo
echo "== 4. Права и уборка =="
DATA_DIR=$(php -r "require '$SITE_ROOT/inc/config.php'; echo DATA_DIR;")
mkdir -p "$SITE_ROOT/uploads"
chown -R "$WEB_USER:$WEB_USER" "$SITE_ROOT"
chmod 775 "$SITE_ROOT/uploads"
[ -d "$DATA_DIR" ] && chown -R "$WEB_USER:$WEB_USER" "$DATA_DIR"

# Установщик нужен один раз; если администратор уже есть — он лишний и опасен
if [ -f "$DATA_DIR/users.json" ] && [ -f "$SITE_ROOT/install.php" ]; then
    rm -f "$SITE_ROOT/install.php"
    echo "install.php удалён — администратор уже создан"
fi
rm -f "$SITE_ROOT/sravnit.php"

echo "Данные: $DATA_DIR"

echo
echo "== 5. Проверка =="
if [ -f "$SITE_ROOT/tools/proverka.sh" ]; then
    bash "$SITE_ROOT/tools/proverka.sh"
else
    echo "Скрипта проверки нет — откройте сайт в браузере вручную"
fi
