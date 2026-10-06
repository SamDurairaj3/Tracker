#!/bin/sh
set -eu

usage() {
  echo "Usage: $0 /path/to/tracker-backup.dump" >&2
  exit 2
}

fail() {
  echo "Tracker restore test failed: $1" >&2
  exit 1
}

[ "$#" -eq 1 ] || usage
[ -f "$1" ] || fail 'dump file does not exist'
[ -r "$1" ] || fail 'dump file is not readable'

dump_path=$(readlink -f -- "$1") || fail 'could not resolve dump path'
dump_name=$(basename -- "$dump_path")
checksum_path="$dump_path.sha256"

if [ -e "$checksum_path" ]; then
  [ -f "$checksum_path" ] && [ -r "$checksum_path" ] || {
    fail 'checksum companion is not a readable regular file'
  }
  line_count=$(wc -l < "$checksum_path" | tr -d ' ')
  [ "$line_count" -eq 1 ] || fail 'checksum companion must contain exactly one line'
  IFS= read -r checksum_line < "$checksum_path" || fail 'could not read checksum companion'
  expected_hash=${checksum_line%% *}
  expected_name=${checksum_line#"$expected_hash  "}
  [ "$expected_name" != "$checksum_line" ] || fail 'checksum companion has an invalid format'
  [ "$expected_name" = "$dump_name" ] || fail 'checksum companion must name only this dump basename'
  case "$expected_hash" in
    ''|*[!0-9a-fA-F]*) fail 'checksum companion has an invalid SHA-256' ;;
  esac
  [ "${#expected_hash}" -eq 64 ] || fail 'checksum companion has an invalid SHA-256 length'
  actual_hash=$(sha256sum "$dump_path" | awk '{print $1}')
  [ "$actual_hash" = "$expected_hash" ] || fail 'dump SHA-256 does not match its companion file'
  echo "Checksum verified: $(basename -- "$checksum_path")"
else
  echo "No checksum companion found at $checksum_path; continuing with archive validation." >&2
fi

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

compose config --quiet || fail 'Docker Compose configuration is invalid'
compose exec -T postgres pg_isready -U tracker -d tracker >/dev/null || {
  fail 'PostgreSQL is not ready'
}

timestamp=$(date -u +%Y%m%d%H%M%S)
restore_database="tracker_restore_${timestamp}_$$"
container_archive="/tmp/$restore_database.dump"
database_created=false

case "$restore_database" in
  tracker_restore_[0-9]*) ;;
  *) fail 'generated restore database name is unsafe' ;;
esac

cleanup() {
  status=$?
  trap - 0 1 2 3 15
  set +e
  if [ "$database_created" = true ]; then
    if ! compose exec -T postgres dropdb --if-exists --force -U tracker "$restore_database" >/dev/null 2>&1; then
      echo "Warning: could not drop temporary database $restore_database" >&2
    fi
  fi
  if [ -n "$container_archive" ]; then
    if ! compose exec -T postgres rm -f -- "$container_archive" >/dev/null 2>&1; then
      echo "Warning: could not remove container temporary archive $container_archive" >&2
    fi
  fi
  exit "$status"
}
trap cleanup 0
trap 'exit 1' 1 2 3 15

compose exec -T postgres rm -f -- "$container_archive"
compose cp "$dump_path" "postgres:$container_archive"
compose exec -T postgres pg_restore --list "$container_archive" >/dev/null

compose exec -T postgres createdb -U tracker -T template0 "$restore_database"
database_created=true
compose exec -T postgres pg_restore \
  -U tracker \
  -d "$restore_database" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-acl \
  "$container_archive"

required_count=$(compose exec -T postgres psql -X -U tracker -d "$restore_database" -At -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name IN ('tracker_schema_migrations', 'work_items', 'checklist_steps', 'work_item_counters', 'work_item_activity', 'push_subscriptions', 'work_item_teams');")
[ "$required_count" = 7 ] || fail 'one or more required Tracker tables are missing'

echo 'Restored row counts:'
compose exec -T postgres psql -X -U tracker -d "$restore_database" -At -v ON_ERROR_STOP=1 -c \
  "SELECT 'tracker_schema_migrations=' || count(*) FROM tracker_schema_migrations
   UNION ALL SELECT 'work_items=' || count(*) FROM work_items
   UNION ALL SELECT 'checklist_steps=' || count(*) FROM checklist_steps
   UNION ALL SELECT 'work_item_counters=' || count(*) FROM work_item_counters
   UNION ALL SELECT 'work_item_activity=' || count(*) FROM work_item_activity
   UNION ALL SELECT 'push_subscriptions=' || count(*) FROM push_subscriptions
   UNION ALL SELECT 'work_item_teams=' || count(*) FROM work_item_teams;"

orphan_count=$(compose exec -T postgres psql -X -U tracker -d "$restore_database" -At -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM checklist_steps AS step LEFT JOIN work_items AS item ON item.id = step.work_item_id WHERE item.id IS NULL;")
[ "$orphan_count" = 0 ] || fail "restore contains $orphan_count orphan checklist_steps rows"
echo 'Orphan checklist_steps: 0'

activity_orphan_count=$(compose exec -T postgres psql -X -U tracker -d "$restore_database" -At -v ON_ERROR_STOP=1 -c   "SELECT count(*) FROM work_item_activity AS activity LEFT JOIN work_items AS item ON item.id = activity.work_item_id WHERE item.id IS NULL;")
[ "$activity_orphan_count" = 0 ] || fail "restore contains $activity_orphan_count orphan work_item_activity rows"
echo 'Orphan work_item_activity: 0'

compose exec -T postgres dropdb --if-exists --force -U tracker "$restore_database"
database_created=false
compose exec -T postgres rm -f -- "$container_archive"
container_archive=
echo 'Restore test passed. The live tracker database was not modified.'
