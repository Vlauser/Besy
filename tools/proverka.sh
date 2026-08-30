#!/bin/bash
# Проверка сайта после установки. Запускать на сервере под root.
#
# Если сайт работает на PHP из контейнера, а системный php другой версии,
# укажите, чем его вызывать, — иначе проверка расширений соврёт,
# посмотрев не на тот PHP:
#
#   PHP="docker exec axiomantic-php php" bash tools/proverka.sh
SITE="${1:-https://axiomantic.ru}"
ROOT=/var/www/axiomantic
PHP="${PHP:-php}"
ok=0; bad=0
say(){ if [ "$1" = y ]; then printf '  \033[32mOK\033[0m   %s\n' "$2"; ok=$((ok+1)); else printf '  \033[31mНЕТ\033[0m  %s\n' "$2"; bad=$((bad+1)); fi; }
code(){ curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1"; }

echo; echo "== Страницы =="
for p in "" projects services about blog contacts privacy consent landing landing-price \
         website-development website-for-lawyers website-for-experts website-for-coffee-shop \
         bots seo landing-ekaterinburg; do
  c=$(code "$SITE/$p"); [ "$c" = 200 ] && say y "/$p" || say n "/$p → $c"
done

echo; echo "== Служебные адреса =="
c=$(code "$SITE/sitemap.xml");  [ "$c" = 200 ] && say y "sitemap.xml" || say n "sitemap.xml → $c"
c=$(code "$SITE/robots.txt");   [ "$c" = 200 ] && say y "robots.txt"  || say n "robots.txt → $c"
c=$(code "$SITE/admin/");       [ "$c" = 302 ] || [ "$c" = 200 ] && say y "админка отвечает ($c)" || say n "админка → $c"
c=$(code "$SITE/nesushestvuyushaya-stranica-123"); [ "$c" = 404 ] && say y "404 на несуществующей" || say n "404 → $c"

echo; echo "== Закрыто от посторонних =="
for p in data/content.json data/users.json data/leads.json inc/config.php tools/ \
         config.local.php README.md install.php; do
  c=$(code "$SITE/$p")
  [ "$c" = 404 ] || [ "$c" = 403 ] && say y "$p закрыт ($c)" || say n "$p ОТДАЁТСЯ → $c"
done

echo; echo "== HTTPS =="
loc=$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 15 "http://${SITE#https://}/")
case "$loc" in https://*) say y "http уводит на $loc";; *) say n "нет редиректа на https (получили «$loc»)";; esac

echo; echo "== Файлы на сервере =="
[ -f "$ROOT/install.php" ] && say n "install.php НЕ УДАЛЁН — удалите!" || say y "install.php удалён"
[ -f "$ROOT/config.local.php" ] && say y "config.local.php есть" || say n "config.local.php отсутствует"
d=$($PHP -r "require '$ROOT/inc/config.php'; echo DATA_DIR;" 2>/dev/null)
say y "данные лежат в $d"
case "$d" in "$ROOT"/*) say n "данные ВНУТРИ корня сайта";; *) say y "данные за корнем сайта";; esac
[ -w "$d" ] && say y "папка данных доступна на запись" || say n "в папку данных нельзя писать"
[ -w "$ROOT/uploads" ] && say y "uploads доступна на запись" || say n "в uploads нельзя писать — картинки не загрузятся"
$PHP -m | grep -q '^gd$' && say y "расширение gd" || say n "нет gd — картинки не сожмутся"
$PHP -m | grep -q '^mbstring$' && say y "расширение mbstring" || say n "нет mbstring"
v=$($PHP -r 'echo PHP_VERSION;' 2>/dev/null)
case "$v" in 8.*) say y "PHP $v" ;; *) say n "PHP $v — движку нужен 8.1 или новее" ;; esac

echo; echo "== Итог: успешно $ok, проблем $bad =="
[ "$bad" = 0 ] && echo "Всё в порядке." || echo "Разберите строки с пометкой НЕТ."
