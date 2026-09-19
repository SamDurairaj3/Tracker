#!/bin/sh
set -eu

usage() {
  echo "Usage: $0 /absolute/backup/directory" >&2
  exit 2
}

fail() {
  echo "Tracker backup failed: $1" >&2
  exit 1
}

[ "$#" -eq 1 ] || usage
destination_input=$1
while [ "${destination_input%/}" != "$destination_input" ]; do
  destination_input=${destination_input%/}
done
[ -n "$destination_input" ] || destination_input=/
case "$destination_input" in
  /*) ;;
  *) fail 'destination must be an absolute path' ;;
esac
case "$destination_input" in
  /srv/tracker-data|/srv/tracker-data/*)
    fail 'destination must be outside /srv/tracker-data'
    ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
uuid=$(sh "$script_dir/check-usb.sh")
marker=/srv/tracker-data/tracker/.tracker-usb-uuid
data_dir=/srv/tracker-data/tracker/postgres
secret="$script_dir/secrets/postgres_password.txt"

[ -d "$data_dir" ] || fail "missing $data_dir; run prepare.sh while the USB is mounted"
[ -f "$marker" ] && [ "$(cat "$marker")" = "$uuid" ] || {
  fail 'USB marker is missing or mismatched; run prepare.sh while the USB is mounted'
}
[ -s "$secret" ] || fail 'database password file is missing or empty; run prepare.sh'

compose() {
  docker compose --project-directory "$script_dir" --env-file "$script_dir/.env" -f "$script_dir/compose.yaml" "$@"
}

umask 077
sudo_owner=
if [ -n "${SUDO_UID:-}" ] || [ -n "${SUDO_GID:-}" ]; then
  [ -n "${SUDO_UID:-}" ] && [ -n "${SUDO_GID:-}" ] || {
    fail 'SUDO_UID and SUDO_GID must both be supplied by sudo'
  }
  case "$SUDO_UID" in
    *[!0-9]*) fail 'SUDO_UID must be numeric' ;;
  esac
  case "$SUDO_GID" in
    *[!0-9]*) fail 'SUDO_GID must be numeric' ;;
  esac
  sudo_owner="$SUDO_UID:$SUDO_GID"
fi

destination_created=false
if [ ! -d "$destination_input" ]; then
  destination_parent=$(dirname -- "$destination_input")
  resolved_parent=$(readlink -f -- "$destination_parent") || fail 'could not resolve destination parent'
  [ -d "$resolved_parent" ] || fail 'destination parent must already exist'
  case "$resolved_parent" in
    /srv/tracker-data|/srv/tracker-data/*)
      fail 'resolved destination parent must be outside /srv/tracker-data'
      ;;
  esac
  mkdir -- "$destination_input" || fail 'could not create destination directory'
  destination_created=true
fi
destination=$(readlink -f -- "$destination_input") || fail 'could not resolve destination directory'
[ -d "$destination" ] || fail 'destination is not a directory'
case "$destination" in
  /srv/tracker-data|/srv/tracker-data/*)
    fail 'resolved destination must be outside /srv/tracker-data'
    ;;
esac
[ -w "$destination" ] || fail 'destination directory is not writable'

if [ "$destination_created" = true ] && [ -n "$sudo_owner" ]; then
  chown "$sudo_owner" "$destination"
fi

compose config --quiet || fail 'Docker Compose configuration is invalid'
compose exec -T postgres pg_isready -U tracker -d tracker >/dev/null || {
  fail 'PostgreSQL is not ready'
}

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_name="tracker-$timestamp-$$.dump"
checksum_name="$backup_name.sha256"
container_archive="/tmp/$backup_name"
host_archive="$destination/$backup_name"
host_checksum="$destination/$checksum_name"
partial_archive="$destination/.$backup_name.partial"
partial_checksum="$destination/.$checksum_name.partial"
published_archive=false
published_checksum=false

[ ! -e "$host_archive" ] || fail "destination file already exists: $host_archive"
[ ! -e "$host_checksum" ] || fail "checksum file already exists: $host_checksum"
[ ! -e "$partial_archive" ] || fail "partial file already exists: $partial_archive"
[ ! -e "$partial_checksum" ] || fail "partial file already exists: $partial_checksum"

cleanup() {
  status=$?
  trap - 0 1 2 3 15
  set +e
  if [ -n "$container_archive" ]; then
    if ! compose exec -T postgres rm -f -- "$container_archive" >/dev/null 2>&1; then
      echo "Warning: could not remove container temporary archive $container_archive" >&2
    fi
  fi
  rm -f -- "$partial_archive" "$partial_checksum"
  if [ "$published_checksum" != true ]; then
    rm -f -- "$host_checksum"
  fi
  if [ "$published_archive" != true ]; then
    rm -f -- "$host_archive"
  fi
  exit "$status"
}
trap cleanup 0
trap 'exit 1' 1 2 3 15

compose exec -T postgres rm -f -- "$container_archive"
compose exec -T postgres pg_dump \
  -U tracker \
  -d tracker \
  --format=custom \
  --file="$container_archive" \
  --no-owner \
  --no-acl \
  --lock-wait-timeout=30s
compose exec -T postgres pg_restore --list "$container_archive" >/dev/null

# Copy to a hidden file on the destination filesystem, then rename it there.
# The rename is atomic and no pg_dump bytes travel through compose exec stdout.
compose cp "postgres:$container_archive" "$partial_archive"
[ -s "$partial_archive" ] || fail 'copied archive is empty'
chmod 600 "$partial_archive"

archive_hash=$(sha256sum "$partial_archive" | awk '{print $1}')
case "$archive_hash" in
  ''|*[!0-9a-fA-F]*) fail 'could not calculate archive SHA-256' ;;
esac
[ "${#archive_hash}" -eq 64 ] || fail 'invalid archive SHA-256 length'
printf '%s  %s\n' "$archive_hash" "$backup_name" > "$partial_checksum"
chmod 600 "$partial_checksum"

if [ -n "$sudo_owner" ]; then
  chown "$sudo_owner" "$partial_archive" "$partial_checksum"
fi

mv -- "$partial_archive" "$host_archive"
mv -- "$partial_checksum" "$host_checksum"
compose exec -T postgres rm -f -- "$container_archive"
container_archive=
published_archive=true
published_checksum=true

echo "Backup: $host_archive"
echo "SHA-256: $host_checksum"
