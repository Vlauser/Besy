#!/bin/bash
# Поднять поддомены под проекты портфолио.
#
#   bash proekty-podomeny.sh deploy <архив.zip>
#                                     — разложить готовые сборки от
#                                       дизайнера по папкам поддоменов
#   bash proekty-podomeny.sh mirror   — снять копии сайтов с площадки,
#                                       где они сейчас живут (запасной путь,
#                                       работает не со всеми сайтами)
#   bash proekty-podomeny.sh nginx    — создать конфиги и включить их
#   bash proekty-podomeny.sh cert     — выпустить сертификат на все поддомены
#
# Домен и список проектов правятся ниже. Слева — поддомен, дальше —
# папка в архиве дизайнера и адрес, откуда можно снять копию.

set -u

DOMAIN="${DOMAIN:-axiomantic.ru}"
ROOT="${ROOT:-/var/www/projects}"
WEB_USER="${WEB_USER:-www-data}"
EMAIL="${EMAIL:-}"                      # для certbot, если ещё не зарегистрирован

# поддомен | папка в архиве дизайнера | адрес для запасного зеркала
PROJECTS="
raid38|irkutsk-enduro-school|https://irkutsk-enduro-school.polinaperevoznikova1.chatgpt.site
besy|besy-vpn|https://besy-vpn.polinaperevoznikova1.chatgpt.site
forma|forma-clinic|https://forma-clinic.polinaperevoznikova1.chatgpt.site
pravo|pravo-legal|https://pravo-legal.polinaperevoznikova1.chatgpt.site
mellow|mellow-coffee|https://mellow-coffee.polinaperevoznikova1.chatgpt.site
rewind|rewind-film-festival|https://rewind-film-festival.polinaperevoznikova1.chatgpt.site
keramika|keramika-studio|https://keramika-studio.polinaperevoznikova1.chatgpt.site
cupcake|cupcake-studio|https://cupcake-studio.polinaperevoznikova1.chatgpt.site
"

rows()  { echo "$PROJECTS" | grep -v '^$' | grep -v '^#'; }
slugs() { rows | cut -d'|' -f1; }

# ---------- 0. Разложить сборки от дизайнера ----------
do_deploy() {
  ARC="${1:-}"
  [ -f "$ARC" ] || { echo "Укажите архив: bash $0 deploy /root/arhiv.zip"; exit 1; }
  command -v unzip >/dev/null || { echo "Нет unzip: apt install -y unzip"; exit 1; }

  TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
  unzip -q "$ARC" -d "$TMP" || { echo "Архив не распаковался"; exit 1; }
  echo "Распаковано во временную папку, раскладываю."
  echo

  mkdir -p "$ROOT"
  ok=0; bad=0
  while IFS='|' read -r slug dir _; do
    # папка может лежать как в корне архива, так и внутри одной общей
    src=$(find "$TMP" -maxdepth 3 -type d -name "$dir" | head -1)
    if [ -z "$src" ]; then
      echo "  ✕ $slug — папки «$dir» в архиве нет"; bad=$((bad+1)); continue
    fi
    if [ ! -f "$src/index.html" ]; then
      echo "  ✕ $slug — в «$dir» нет index.html"; bad=$((bad+1)); continue
    fi
    rm -rf "${ROOT:?}/$slug"
    mkdir -p "$ROOT/$slug"
    cp -a "$src"/. "$ROOT/$slug"/
    printf '  ✓ %-10s ← %-24s %s, файлов: %s\n' \
      "$slug" "$dir" "$(du -sh "$ROOT/$slug" | cut -f1)" "$(find "$ROOT/$slug" -type f | wc -l)"
    ok=$((ok+1))
  done <<< "$(rows)"

  chown -R "$WEB_USER:$WEB_USER" "$ROOT"
  find "$ROOT" -type d -exec chmod 755 {} \; ; find "$ROOT" -type f -exec chmod 644 {} \;
  echo
  echo "Разложено: $ok, не получилось: $bad"
  [ "$bad" = 0 ] || echo "Проверьте имена папок внутри архива и список PROJECTS в этом файле."
}

# ---------- 1. Копии сайтов ----------
do_mirror() {
  command -v wget >/dev/null || { echo "Нет wget: apt install -y wget"; exit 1; }
  rows | while IFS='|' read -r slug _dir src; do
    echo
    echo "=== $slug  ←  $src"
    mkdir -p "$ROOT/$slug"
    # -p тянет картинки и стили, -k чинит ссылки на локальные,
    # -nH --cut-dirs=0 кладёт файлы в корень папки проекта
    wget --quiet --show-progress \
         --page-requisites --convert-links --adjust-extension \
         --span-hosts --domains="$(echo "$src" | awk -F/ '{print $3}')" \
         --no-host-directories --directory-prefix="$ROOT/$slug" \
         --user-agent="Mozilla/5.0" \
         "$src/" || echo "  не всё скачалось — проверьте вручную"
    if [ -f "$ROOT/$slug/index.html" ]; then
      echo "  готово: $(du -sh "$ROOT/$slug" | cut -f1)"
    else
      echo "  ВНИМАНИЕ: index.html не появился, папка пуста или сайт отдаётся скриптом"
    fi
  done
  chown -R "$WEB_USER:$WEB_USER" "$ROOT"
}

# ---------- 2. Конфиги nginx ----------
do_nginx() {
  for slug in $(slugs); do
    conf="/etc/nginx/sites-available/$slug.$DOMAIN"
    cat > "$conf" <<CONF
# Проект портфолио: $slug
server {
    listen 80;
    listen [::]:80;
    server_name $slug.$DOMAIN;

    root $ROOT/$slug;
    index index.html index.htm;

    location / {
        try_files \$uri \$uri/ \$uri.html /index.html;
    }

    location ~* \.(css|js|jpg|jpeg|png|gif|webp|svg|ico|woff2)\$ {
        expires 30d;
        access_log off;
    }

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    access_log /var/log/nginx/$slug.access.log;
    error_log  /var/log/nginx/$slug.error.log;
}
CONF
    ln -sf "$conf" "/etc/nginx/sites-enabled/$slug.$DOMAIN"
    echo "  создан $conf"
  done
  nginx -t && systemctl reload nginx && echo "nginx перечитал конфиги"
}

# ---------- 3. Сертификат ----------
do_cert() {
  args=""
  for slug in $(slugs); do args="$args -d $slug.$DOMAIN"; done
  echo "certbot --nginx$args"
  # shellcheck disable=SC2086
  if [ -n "$EMAIL" ]; then
    certbot --nginx $args --non-interactive --agree-tos -m "$EMAIL" --redirect
  else
    certbot --nginx $args --redirect
  fi
}

case "${1:-}" in
  deploy) do_deploy "${2:-}" ;;
  mirror) do_mirror ;;
  nginx)  do_nginx ;;
  cert)   do_cert ;;
  *) echo "Что делать: deploy <архив.zip> | mirror | nginx | cert"; exit 1 ;;
esac
