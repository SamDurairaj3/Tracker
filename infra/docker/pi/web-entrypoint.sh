#!/bin/sh
set -eu

database_secret=/run/secrets/postgres_password
auth_secret=/run/secrets/better_auth_secret
private_database_secret=/run/tracker/postgres_password
private_auth_secret=/run/tracker/better_auth_secret
[ -s "$database_secret" ] || { echo 'Database secret is missing or empty' >&2; exit 1; }
[ -s "$auth_secret" ] || { echo 'Authentication secret is missing or empty' >&2; exit 1; }

# Compose file secrets are host bind mounts. A 0600 host file is readable to
# root, so copy both into private tmpfs before dropping to the node user.
install -m 0400 -o node -g node "$database_secret" "$private_database_secret"
install -m 0400 -o node -g node "$auth_secret" "$private_auth_secret"
export DATABASE_PASSWORD_FILE="$private_database_secret"
export BETTER_AUTH_SECRET_FILE="$private_auth_secret"
exec gosu node "$@"
