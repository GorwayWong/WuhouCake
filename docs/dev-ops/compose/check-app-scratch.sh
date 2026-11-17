#!/bin/sh
# Usage: check-app-scratch.sh ABSOLUTE_MOUNT [APP_UID] [APP_GID]
set -eu
mount_dir=${1:?need the host scratch mount}
app_uid=${2:-10001}
app_gid=${3:-10001}

case "$mount_dir" in
    /*) ;;
    *) echo "APP_SCRATCH_HOST_DIR must be absolute" >&2; exit 1 ;;
esac
if [ "$mount_dir" = / ] || [ "$(realpath -e "$mount_dir")" != "$mount_dir" ]; then
    echo "Use a canonical scratch path other than /" >&2
    exit 1
fi
if ! kind=$(findmnt -n -o FSTYPE --mountpoint "$mount_dir"); then
    echo "$mount_dir is not an exact mount point" >&2
    exit 1
fi
case "$kind" in
    ext4|xfs) ;;
    *) echo "Scratch requires a dedicated ext4 or XFS filesystem" >&2; exit 1 ;;
esac
if [ "$(stat -c '%d' "$mount_dir")" = "$(stat -c '%d' "$(dirname "$mount_dir")")" ]; then
    echo "Scratch shares its parent filesystem" >&2
    exit 1
fi
if [ "$(findmnt -n -o FSROOT --mountpoint "$mount_dir")" != / ] ||
   ! findmnt -n -o OPTIONS --mountpoint "$mount_dir" | grep -Eq '(^|,)rw(,|$)'; then
    echo "Scratch must expose the writable root of the dedicated filesystem" >&2
    exit 1
fi
if [ "$(stat -c '%u:%g:%a' "$mount_dir")" != "$app_uid:$app_gid:700" ]; then
    echo "Scratch mount must be owned by $app_uid:$app_gid with mode 0700" >&2
    exit 1
fi
df -B1 --output=size,avail "$mount_dir" | awk 'NR == 2 {
    if ($2 < 960 * 1048576) exit 1
    printf "Scratch mount verified: %.0f MiB total, %.0f MiB available\n", $1 / 1048576, $2 / 1048576
    valid = 1
} END { if (!valid) exit 1 }' || {
    echo "Scratch requires at least 960 MiB available (896 MiB budget plus 64 MiB reserve)" >&2
    exit 1
}
