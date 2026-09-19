#!/bin/sh
set -eu

secret=/run/secrets/postgres_password
private_copy=/run/tracker/postgres_password
[ -s "$secret" ] || { echo 'Database secret is missing or empty' >&2; exit 1; }

# Compose file secrets are host bind mounts. A 0600 host file is readable to
# root, so make a private copy in tmpfs before dropping to the unprivileged
# application user. The password is never placed in an environment variable.
install -m 0400 -o node -g node "$secret" "$private_copy"
export DATABASE_PASSWORD_FILE="$private_copy"
exec gosu node "$@"
