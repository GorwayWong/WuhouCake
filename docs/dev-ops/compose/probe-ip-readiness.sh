#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

ready=0
if body=$(docker compose exec -T app wget -T 3 -qO- http://127.0.0.1:8080/actuator/health/readiness 2>/dev/null) &&
    printf '%s\n' "$body" | grep -Eq '^[[:space:]]*\{[[:space:]]*"status"[[:space:]]*:[[:space:]]*"UP"[[:space:]]*\}[[:space:]]*$'; then
    ready=1
fi
printf 'wuhou_app_ready %s\n' "$ready"
