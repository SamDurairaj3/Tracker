# Raspberry Pi deployment

This guide runs Tracker on a Raspberry Pi 4B with 4 GB of RAM, Ubuntu Server
**ARM64**, Docker Engine, and Docker Compose V2. PostgreSQL data lives in the
host directory `/srv/tracker-data/tracker/postgres` on the mounted ext4 USB
drive. Docker does not use a named volume for database files.

The normal deployment is private: the web app is published only on
`127.0.0.1:5173`, and PostgreSQL has no host port. Tracker has invite-only
Better Auth login. A separate Cloudflare Quick Tunnel overlay can expose the
loopback web port temporarily after its mandatory preflight succeeds. Nothing
in `deploy.sh` starts that tunnel.

## 1. Verify the USB mount

This process does not format or erase the USB drive. Check the existing drive:

```sh
lsblk -f
findmnt --mountpoint /srv/tracker-data --output SOURCE,FSTYPE,UUID,TARGET
```

The second command must show an **ext4** filesystem mounted **exactly** at
`/srv/tracker-data`, with the USB filesystem UUID. A directory with that name
is insufficient. If the mount is missing, create the mountpoint and configure
the existing filesystem in `/etc/fstab`:

```text
UUID=<your-USB-filesystem-UUID> /srv/tracker-data ext4 defaults,nofail,x-systemd.device-timeout=30s 0 2
```

Run `sudo mount /srv/tracker-data`, then verify it again with `findmnt`. The
`nofail` option allows Ubuntu to boot without the drive; Tracker's checks then
prevent PostgreSQL from initializing on the microSD card.

## 2. Transfer the source archive

On the Windows computer holding this project, run:

```powershell
cd D:\InternalTools\Tracker
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-pi.ps1
```

Copy the printed `tracker-pi-….tar.gz` archive to the Pi:

```powershell
scp "<printed-archive-path>" <pi-user>@<pi-LAN-address>:~
```

On the Pi:

```sh
mkdir -p "$HOME/tracker"
tar -xzf "$HOME/<archive-name>.tar.gz" -C "$HOME/tracker"
cd "$HOME/tracker/infra/docker/pi"
```

The archive excludes `.env`, secrets, dependencies, build output, databases,
and backups. During updates, retain the Pi's existing `.env`, `secrets/`, and
USB data directory.

## 3. Configure and prepare secrets

From `$HOME/tracker/infra/docker/pi`:

```sh
cp usb-config.example .env
nano .env
sh ./prepare.sh
```

Set `TRACKER_USB_UUID` to the UUID printed by `findmnt`. On later visits, keep
and verify the existing `.env` rather than replacing it.

`prepare.sh` checks the mount before writing. It creates the PostgreSQL data
directory and USB marker, then generates these ignored mode-`0600` files only
when they do not already exist:

- `secrets/postgres_password.txt`
- `secrets/better_auth_secret.txt`

The authentication secret is high entropy and is never placed in a normal
environment variable. Compose mounts it only into `web`. The entrypoint copies
both mounted secrets into private tmpfs, exports only their `*_FILE` paths, and
drops to the unprivileged `node` user. PostgreSQL receives only its password.
Do not replace either file during an update. Replacing the database password
does not rotate PostgreSQL; replacing the auth secret invalidates sessions and
can make protected auth data unreadable.

## 4. Build, migrate, and start

```sh
sh ./deploy.sh
docker compose --env-file .env -f compose.yaml ps
curl -fsS http://127.0.0.1:5173/api/health
```

`deploy.sh` verifies the USB and both secret files, validates Compose, builds
the ARM64 image, starts PostgreSQL, applies the checksummed SQL migrations, and
starts the web app. Migration `0002_better_auth.sql` creates the Better Auth
user, account, session, verification, admin-role, and database rate-limit
schema. Runtime requests validate the schema but never mutate it. A healthy
response is `{"status":"ok"}` and contains no database details.

The first build needs internet access for images and packages and can take
several minutes. For a failed run, inspect:

```sh
docker compose --env-file .env -f compose.yaml logs --tail 100
```

Migrations are repeatable and checksummed. Transfer corrected source over the
existing tree and rerun `sh ./deploy.sh`; do not delete the database or secrets.

## 5. Provision invited users

There is no public sign-up. Create the first administrator from the Pi
deployment directory:

```sh
docker compose --env-file .env -f compose.yaml run --rm --no-deps web \
  node --import tsx scripts/auth-admin.ts create \
  --email admin@example.com --name "Admin Name" --role admin
```

The command reads the password twice from stdin with hidden interactive input.
Passwords are never accepted as command-line arguments, environment variables,
logs, or source. Better Auth hashes them with its default scrypt implementation.
Use at least 12 characters.

Create engineers the same way with `--role engineer`. Manage accounts with:

```sh
docker compose --env-file .env -f compose.yaml run --rm --no-deps web \
  node --import tsx scripts/auth-admin.ts list

docker compose --env-file .env -f compose.yaml run --rm --no-deps web \
  node --import tsx scripts/auth-admin.ts disable --email engineer@example.com

docker compose --env-file .env -f compose.yaml run --rm --no-deps web \
  node --import tsx scripts/auth-admin.ts enable --email engineer@example.com

docker compose --env-file .env -f compose.yaml run --rm --no-deps web \
  node --import tsx scripts/auth-admin.ts reset-password --email engineer@example.com
```

Disabling an account revokes its sessions. Resetting a password reads and
confirms the new password through stdin and revokes existing sessions. The CLI
refuses to disable the last active administrator. Password reset and account
recovery are administrator-assisted for this pilot; no recovery email is sent.

Verify credentials and a full session round trip before considering a tunnel:

```sh
docker compose --env-file .env -f compose.yaml run --rm --no-deps web \
  node --import tsx scripts/auth-admin.ts verify-login --email admin@example.com
```

This reads one password from stdin, signs in through Better Auth, resolves the
created session, signs it out, and prints only pass/fail status.

## 6. Test through a private SSH tunnel

Keep this tunnel open on the Windows computer:

```powershell
ssh -L 5173:127.0.0.1:5173 <pi-user>@<pi-LAN-address>
```

Open `http://localhost:5173`. The root sends administrators to `/management`
and engineers to `/engineering`. `/management` is admin-only;
`/engineering` and `/mobile` require any active admin or engineer session.
Authenticated users share the same pilot work-item view, while “my work” and
assignment filters use the signed-in display name. Login, session, protected
HTML, and work-item API responses use `no-store` headers.

## 7. Optional Cloudflare Quick Tunnel review

This is an opt-in review path, not a production ingress. It uses Cloudflare's
official `cloudflare/cloudflared:2026.9.1` ARM64 image with host networking so
cloudflared can reach `http://127.0.0.1:5173`. The app remains loopback-only and
PostgreSQL remains unexposed.

Start only after deployment, migration, admin creation, and private login tests
pass. `quick-tunnel.sh start` enforces those checks and repeats the specified
administrator's login/session test before starting cloudflared:

```sh
sh ./quick-tunnel.sh start admin@example.com
sh ./quick-tunnel.sh status
sh ./quick-tunnel.sh logs
```

The logs print a random `https://….trycloudflare.com` URL. Tracker allows only
localhost/loopback hosts and HTTPS `*.trycloudflare.com` hosts; origin and CSRF
checks remain enabled. Because the origin is reachable only through loopback,
Better Auth trusts Cloudflare's single `cf-connecting-ip` header for auth rate
limits. It does not trust `x-forwarded-for`. Production cookies are Secure,
HttpOnly, and SameSite=Lax, and auth rate limits are stored in PostgreSQL.

Stop and remove only the tunnel container with:

```sh
sh ./quick-tunnel.sh stop
```

If Docker requires elevation, add `sudo` to the four script commands. Quick
Tunnels have random URLs, no SLA, a 200 concurrent-request limit, and no
Server-Sent Events support. A restart can produce a different URL. They do not
provide a durable hostname or Cloudflare Access policy. Use this only for a
short review, share the URL narrowly, and stop it afterward.

## USB and network fail-closed behavior

Compose uses `create_host_path: false` for the database bind and requires the
marker generated after the exact ext4 UUID check. The PostgreSQL wrapper also
checks the host mount table through read-only `/proc/1/mountinfo`. If the USB is
missing, PostgreSQL cannot initialize on microSD even if stale directories
exist.

PostgreSQL has a 1 GB memory limit and 20-connection cap. The web app has a 2 GB
limit and shares one bounded pool of five connections between Tracker and
Better Auth. The database network is internal. The normal Compose file has no
cloudflared service, and the Quick Tunnel overlay is behind an explicit profile
and management script.

## Backups and restore tests

Run backups to an absolute directory outside `/srv/tracker-data`:

```sh
sh ./backup.sh /home/<pi-user>/tracker-backups
sh ./test-restore.sh /home/<pi-user>/tracker-backups/<printed-backup-name>.dump
```

If Docker requires elevation:

```sh
sudo sh ./backup.sh /home/<pi-user>/tracker-backups
sudo sh ./test-restore.sh /home/<pi-user>/tracker-backups/<printed-backup-name>.dump
```

Files created through `sudo` are returned to the invoking user's UID and GID.
Dump and checksum files use mode `0600`. A `/home` directory is only temporary
microSD staging; copy each `.dump` and `.sha256` to a NAS, another computer, or
a second device. For a mounted destination:

```sh
findmnt --mountpoint /mnt/tracker-backups
sudo sh ./backup.sh /mnt/tracker-backups
```

The backup script refuses `/srv/tracker-data` and descendants. It verifies the
USB, creates a custom-format archive inside PostgreSQL without ownership/ACL
data, validates it, copies through a hidden partial file, calculates SHA-256,
and atomically publishes the pair. The restore test verifies the checksum and
archive, restores into a unique temporary database, checks Tracker's required
tables, counts rows, rejects orphan checklist steps, and always removes the
temporary database. It never restores over the live database.

Keep secure off-device copies of both secret files with the database backup.
Do not use `docker compose down -v` or delete the USB data directory during
normal updates.

## Existing D1 data and remaining Pi validation

The previous D1 database is untouched. The detailed
[D1 cutover checklist](postgresql.md#existing-d1-data-separate-cutover-still-required)
remains open. Export, classify, stage, and compare that data before selecting a
new authoritative database.

The base Pi deployment and a manual backup/restore recovery were exercised
previously. The auth migration, user provisioning, login/session test, new
backup scripts, off-device restore, and opt-in Quick Tunnel preflight still
need to be run on the Pi. This implementation does not start a tunnel or deploy
anything. On the development computer, validate Compose and both POSIX scripts,
then use this section in order on the Pi.
