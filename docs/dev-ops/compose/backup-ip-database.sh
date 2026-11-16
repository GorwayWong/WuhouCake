#!/bin/sh
set -eu
umask 077
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
mkdir -p backups
backup="backups/wuhou-$(date -u +%Y%m%dT%H%M%SZ).dump"
trap 'rm -f "$backup.partial"' EXIT HUP INT TERM
docker compose exec -T postgres pg_dump -U wuhou -d wuhou --format=custom > "$backup.partial"
mv "$backup.partial" "$backup"
find backups -type f -name 'wuhou-*.dump' -mtime +7 -delete
