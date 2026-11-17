#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

backrest() { docker compose exec -T -u postgres postgres pgbackrest --stanza=wuhou "$@"; }

case "${1:-}" in
    full|diff) backrest --type="$1" backup ;;
    check) backrest check ;;
    metrics)
        # Gather every sample before emitting any successful scrape.
        archive=$(docker compose exec -T -u postgres postgres psql -XAtq -v ON_ERROR_STOP=1 -U wuhou -d wuhou <<'SQL'
SELECT 'wuhou_pitr_archive_enabled ' || (current_setting('archive_mode') = 'on' AND current_setting('archive_command') <> '')::int;
SELECT 'wuhou_pitr_archive_failures_total ' || failed_count FROM pg_stat_archiver;
SELECT 'wuhou_pitr_wal_pending_age_seconds ' || COALESCE(
    EXTRACT(epoch FROM (clock_timestamp() - min((pg_stat_file('pg_wal/archive_status/' || name, true)).modification))),
    0)
FROM pg_ls_dir('pg_wal/archive_status') AS files(name)
WHERE name LIKE '%.ready';
SQL
        )
        backup=$(backrest --output=json info | python3 -c '
import json, sys
stanza, = json.load(sys.stdin)
latest = max((b["timestamp"]["stop"] for b in stanza.get("backup", []) if not b.get("error")), default=0)
print("wuhou_pitr_latest_backup_timestamp_seconds", latest)
')
        disk=$(docker compose exec -T -u postgres postgres df -P /var/lib/postgresql/data /var/lib/pgbackrest)
        space=$(printf '%s\n' "$disk" | awk 'NR==2 {print "wuhou_pitr_disk_free_bytes{disk=\"postgres\"} " $4*1024}
            NR==3 {print "wuhou_pitr_disk_free_bytes{disk=\"repository\"} " $4*1024}')
        [ "$(printf '%s\n' "$space" | wc -l | tr -d ' ')" = 2 ]
        printf '%s\n' '# TYPE wuhou_pitr_archive_failures_total counter' "$archive" "$backup" "$space"
        ;;
    *) printf '%s\n' "Usage: $0 {full|diff|check|metrics}" >&2; exit 2 ;;
esac
