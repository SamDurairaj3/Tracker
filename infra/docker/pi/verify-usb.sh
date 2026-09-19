#!/bin/sh
set -eu

fail() {
  echo "Tracker PostgreSQL refused to start: $1" >&2
  exit 1
}

[ -n "${TRACKER_USB_UUID:-}" ] || fail 'TRACKER_USB_UUID is not set'
[ -f /run/tracker/host-mountinfo ] || fail 'host mount information is unavailable'
[ -f /run/tracker/volume-id ] || fail 'USB volume marker is missing'

# /proc/1/mountinfo is bind-mounted from the Linux host, not from this
# container's mount namespace. Field 5 is the exact mountpoint; the filesystem
# type appears immediately after the " - " separator.
awk '$5 == "/srv/tracker-data" {
  for (i = 1; i < NF; i++) {
    if ($i == "-" && $(i + 1) == "ext4") mounted = 1
  }
} END { exit !mounted }' /run/tracker/host-mountinfo || fail 'USB ext4 filesystem is not mounted at /srv/tracker-data'

actual_uuid=$(cat /run/tracker/volume-id)
[ "$actual_uuid" = "$TRACKER_USB_UUID" ] || fail 'USB volume marker does not match the configured UUID'

# The official entrypoint is invoked only after both mount checks pass.
exec /usr/local/bin/docker-entrypoint.sh "$@"
