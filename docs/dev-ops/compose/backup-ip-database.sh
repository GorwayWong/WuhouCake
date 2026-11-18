#!/bin/sh
set -eu
umask 077
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
unset COMPOSE_FILE COMPOSE_PATH_SEPARATOR COMPOSE_ENV_FILES COMPOSE_DISABLE_ENV_FILE COMPOSE_PROJECT_NAME
exec python3 backup-ip-database.py "$@"
