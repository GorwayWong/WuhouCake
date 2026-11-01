#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
docker compose run --rm -T certbot renew --quiet
docker compose exec -T gateway caddy reload --force --config /etc/caddy/Caddyfile --adapter caddyfile
