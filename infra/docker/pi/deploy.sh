#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
uuid=$(sh "$script_dir/check-usb.sh")
marker=/srv/tracker-data/tracker/.tracker-usb-uuid
data_dir=/srv/tracker-data/tracker/postgres
database_secret="$script_dir/secrets/postgres_password.txt"
auth_secret="$script_dir/secrets/better_auth_secret.txt"

[ -d "$data_dir" ] || { echo "Missing $data_dir; run prepare.sh while the USB is mounted" >&2; exit 1; }
[ -f "$marker" ] && [ "$(cat "$marker")" = "$uuid" ] || {
  echo 'USB marker is missing or mismatched; run prepare.sh while the USB is mounted' >&2
  exit 1
}
[ -s "$database_secret" ] || { echo 'Database password file is missing or empty; run prepare.sh' >&2; exit 1; }
[ -s "$auth_secret" ] || { echo 'Authentication secret file is missing or empty; run prepare.sh' >&2; exit 1; }

compose() {
  docker compose --project-directory "$script_dir" --env-file "$script_dir/.env" -f "$script_dir/compose.yaml" "$@"
}

compose config --quiet
compose build web
compose up -d --wait --wait-timeout 180 postgres
compose stop web
# The image already contains Node, tsx, and the migration source. Calling pnpm
# here can try to modify /app when it runs as the unprivileged node user.
compose run --rm --no-deps web node --import tsx scripts/migrate.ts
compose up -d --wait --wait-timeout 180 web
echo 'Tracker is healthy on the Pi at http://127.0.0.1:5173.'
