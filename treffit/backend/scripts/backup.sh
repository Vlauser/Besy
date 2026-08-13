#!/usr/bin/env bash
# Dump the database and archive uploaded media.
#
#   BACKUP_DIR   where to write        (default /srv/treffit/backups)
#   KEEP_DAYS    retention             (default 14)
#   PGDATABASE / PGUSER / PGHOST       standard libpq variables
#
# A dating service without backups is a question of when, not if.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/treffit/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
MEDIA_ROOT="${TREFFIT_MEDIA_ROOT:-/srv/treffit/backend/var/media}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

# Fail loudly on a partial dump instead of leaving a truncated file behind.
DB_FILE="$BACKUP_DIR/treffit-$STAMP.sql.gz"
pg_dump --no-owner --no-privileges | gzip -9 > "$DB_FILE.partial"
mv "$DB_FILE.partial" "$DB_FILE"
echo "БД → $DB_FILE ($(du -h "$DB_FILE" | cut -f1))"

if [ -d "$MEDIA_ROOT" ]; then
  MEDIA_FILE="$BACKUP_DIR/media-$STAMP.tar.gz"
  tar -czf "$MEDIA_FILE.partial" -C "$(dirname "$MEDIA_ROOT")" "$(basename "$MEDIA_ROOT")"
  mv "$MEDIA_FILE.partial" "$MEDIA_FILE"
  echo "Медиа → $MEDIA_FILE ($(du -h "$MEDIA_FILE" | cut -f1))"
fi

find "$BACKUP_DIR" -name 'treffit-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'media-*.tar.gz' -mtime "+$KEEP_DAYS" -delete
echo "Старше $KEEP_DAYS дней удалено."
