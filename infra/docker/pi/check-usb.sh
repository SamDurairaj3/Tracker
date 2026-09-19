#!/bin/sh
set -eu

mountpoint=/srv/tracker-data
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
config="$script_dir/.env"
[ -f "$config" ] || { echo "Missing $config; copy .env.example and set TRACKER_USB_UUID" >&2; exit 1; }
expected_uuid=$(sed -n 's/^TRACKER_USB_UUID=//p' "$config")
case "$expected_uuid" in
  ''|*[!0123456789abcdefABCDEF-]*)
    echo 'TRACKER_USB_UUID must be the ext4 filesystem UUID from findmnt' >&2
    exit 1
    ;;
esac
command -v findmnt >/dev/null 2>&1 || { echo 'findmnt is required' >&2; exit 1; }

fs_type=$(findmnt --mountpoint "$mountpoint" --noheadings --output FSTYPE) || {
  echo "$mountpoint is not mounted; refusing to use the microSD" >&2
  exit 1
}
actual_uuid=$(findmnt --mountpoint "$mountpoint" --noheadings --output UUID) || {
  echo 'Could not read mounted filesystem UUID' >&2
  exit 1
}

[ "$fs_type" = ext4 ] || { echo "$mountpoint must be an ext4 mount" >&2; exit 1; }
[ "$actual_uuid" = "$expected_uuid" ] || {
  echo "Mounted filesystem UUID does not match infra/docker/pi/.env" >&2
  exit 1
}

echo "Verified ext4 USB filesystem $actual_uuid at $mountpoint" >&2
printf '%s\n' "$actual_uuid"
