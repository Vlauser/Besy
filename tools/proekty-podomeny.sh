#!/bin/bash
# Поднять поддомены под проекты портфолио.
#
#   bash proekty-podomeny.sh mirror   — снять копии сайтов с площадки,
#                                       где они сейчас живут
#   bash proekty-podomeny.sh nginx    — создать конфиги и включить их
#   bash proekty-podomeny.sh cert     — выпустить сертификат на все поддомены
#   bash proekty-podomeny.sh all      — всё подряд
#
# Домен и список проектов правятся ниже. Слева — поддомен, справа —
# адрес, откуда снимать копию. Адреса взяты из админки, раздел
# «Портфолио», поле «Ссылка на сайт».

set -u

DOMAIN="${DOMAIN:-axiomantic.ru}"
ROOT="${ROOT:-/var/www/projects}"
WEB_USER="${WEB_USER:-www-data}"
EMAIL="${EMAIL:-}"                      # для certbot, если ещё не зарегистрирован

PROJECTS="
raid38|https://irkutsk-enduro-school.polinaperevoznikova1.chatgpt.site
besy|https://besy-vpn.polinaperevoznikova1.chatgpt.site
forma|https://forma-clinic.polinaperevoznikova1.chatgpt.site
pravo|https://pravo-legal.polinaperevoznikova1.chatgpt.site
mellow|https://mellow-coffee.polinaperevoznikova1.chatgpt.site
rewind|https://rewind-film-festival.polinaperevoznikova1.chatgpt.site
keramika|https://keramika-studio.polinaperevoznikova1.chatgpt.site
cupcake|https://cupcake-studio.polinaperevoznikova1.chatgpt.site
"

slugs() { echo "$PROJECTS" | grep -v '^$' | cut -d'|' -f1; }

# ---------- 1. Копии сайтов ----------
do_mirror() {
  command -v wget >/dev/null || { echo "Нет wget: apt install -y wget"; exit 1; }
  echo "$PROJECTS" | grep -v '^$' | while IFS='|' read -r slug src; do
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
  mirror) do_mirror ;;
  nginx)  do_nginx ;;
  cert)   do_cert ;;
  all)    do_mirror; do_nginx; do_cert ;;
  *) echo "Что делать: mirror | nginx | cert | all"; exit 1 ;;
esac
