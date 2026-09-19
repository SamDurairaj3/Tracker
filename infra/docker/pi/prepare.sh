#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
uuid=$(sh "$script_dir/check-usb.sh")
marker=/srv/tracker-data/tracker/.tracker-usb-uuid
data_dir=/srv/tracker-data/tracker/postgres
secret_dir="$script_dir/secrets"
secret="$secret_dir/postgres_password.txt"

# The host check runs before any write under /srv/tracker-data.
if [ -e "$marker" ] && [ "$(cat "$marker")" != "$uuid" ]; then
  echo 'Existing USB marker has a different UUID; refusing to overwrite it' >&2
  exit 1
fi
sudo mkdir -p "$data_dir"
if [ ! -e "$marker" ]; then
  printf '%s\n' "$uuid" | sudo tee "$marker" >/dev/null
fi

umask 077
mkdir -p "$secret_dir"
if [ ! -e "$secret" ]; then
  command -v openssl >/dev/null 2>&1 || { echo 'OpenSSL is required to generate the database password' >&2; exit 1; }
  openssl rand -base64 48 > "$secret"
fi
[ -s "$secret" ] || { echo 'Database password file is empty' >&2; exit 1; }
chmod 600 "$secret"
echo 'USB data directory and local database secret are ready.'
echo 'Existing database files and existing password were preserved.'
