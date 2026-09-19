# Raspberry Pi deployment (Step 2)

This guide prepares Tracker for a Raspberry Pi 4B with 4 GB of RAM, Ubuntu
Server **ARM64**, Docker Engine, and Docker Compose V2. It has two containers:
the Node.js web app and PostgreSQL. The database files live in the **host
directory** `/srv/tracker-data/tracker/postgres` on the ext4 USB drive. No
Docker named volume is used for those files.

This is a local-only deployment. Docker publishes the web app only on the Pi's
`127.0.0.1:5173`; PostgreSQL publishes no host port. You can view the app from
another computer through an SSH tunnel. Authentication, direct phone access,
HTTPS, and any internet-facing access are later steps.

## 1. Verify the USB mount

This process does not format or erase the USB drive. If it already contains
files, leave them in place. On the Pi, check the existing drive and mount:

```sh
lsblk -f
findmnt --mountpoint /srv/tracker-data --output SOURCE,FSTYPE,UUID,TARGET
```

The second command must show an **ext4** filesystem mounted **exactly** at
`/srv/tracker-data`, with the USB filesystem's UUID. Seeing only `/` or a
directory named `/srv/tracker-data` is not enough. If the mount is missing,
create the mountpoint with `sudo mkdir -p /srv/tracker-data`, then configure the
existing ext4 filesystem in `/etc/fstab` using its UUID. For example, add one
line after replacing the placeholder with the UUID from `lsblk -f`:

```text
UUID=<your-USB-filesystem-UUID> /srv/tracker-data ext4 defaults,nofail,x-systemd.device-timeout=30s 0 2
```

Mount it with `sudo mount /srv/tracker-data`, then rerun `findmnt`. Do not run
the preparation or deployment commands until the mount and UUID are correct.
The `nofail` option lets Ubuntu boot without the USB drive; Tracker's checks
then refuse to initialize PostgreSQL on the microSD card.

## 2. Transfer the app files from this computer

The Pi has no app files yet. On the Windows computer that holds this project,
open PowerShell and run:

```powershell
cd D:\InternalTools\Tracker
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-pi.ps1
```

The command prints the exact path to a new `tracker-pi-….tar.gz` source archive
under `D:\InternalTools\Tracker\data\deploy-bundles`. It excludes local
dependencies, test databases, build output, `.env` files, and secrets. Copy
the printed archive to the Pi, replacing the placeholders:

```powershell
scp "<printed-archive-path>" <pi-username>@<pi-LAN-address>:~
```

On the Pi, unpack that archive into a new app folder:

```sh
mkdir -p "$HOME/tracker"
tar -xzf "$HOME/<copied-tracker-pi-archive-name>.tar.gz" -C "$HOME/tracker"
cd "$HOME/tracker/infra/docker/pi"
```

An existing `$HOME/tracker` folder is never deleted by these commands. For a
future update, transfer a new archive and review changes to local deployment
files before unpacking over it. The generated database password and the USB
database directory must be retained across updates.

## 3. Configure and prepare

Check that `docker compose version` works on the Pi. From
`$HOME/tracker/infra/docker/pi`, copy the safe template and set the UUID shown
by `findmnt`:

```sh
cp usb-config.example .env
nano .env
sh ./prepare.sh
```

If `.env` already exists on a later visit, keep it and check its UUID; do not
copy the example over it.

The `.env` file holds only the expected USB filesystem UUID, not a password.
`prepare.sh` checks that the named ext4 drive is actually mounted before it
creates `/srv/tracker-data/tracker/postgres` and an identifying marker on that
drive. It generates a random database password in the ignored file
`infra/docker/pi/secrets/postgres_password.txt` with mode `0600`. If that file
already exists, it is retained. Back up this password file securely alongside
database backups; replacing the file does **not** rotate an existing
PostgreSQL user's password.

## 4. Build and start

Run this from the same Pi directory:

```sh
sh ./deploy.sh
docker compose --env-file .env -f compose.yaml ps
curl -fsS http://127.0.0.1:5173/api/health
```

The deployment script checks the USB again, validates Compose, builds the
Node.js image for the Pi's ARM64 architecture, starts PostgreSQL, runs pending
schema migrations directly with Node, and starts the web app after the database
is ready. The migration runs as the unprivileged app user and does not need to
install packages or write to `/app`. Docker and an internet connection for
image/package downloads are required on the Pi
for the first build. Compilation may take several minutes on a 4 GB Pi. If it
fails, read `docker compose --env-file .env -f compose.yaml logs --tail 100`
before retrying `sh ./deploy.sh`. A successful health request returns
`{"status":"ok"}`.

If an earlier deployment stopped at the migration step with
`permission denied, open '/app/_tmp_...'`, transfer the updated source archive
from this project to the Pi and unpack it over the existing app source. The
archive excludes `.env`, `secrets/`, and database files. Keep those files and
the USB data directory in place, then rerun `sh ./deploy.sh` (or
`sudo sh ./deploy.sh` if that is how Docker is accessed on the Pi). PostgreSQL
does not need to be reinitialized. Migrations are designed to be rerun safely;
the app starts after they succeed. Do not delete the database or regenerate its
password to fix this error.

If the updated files have not reached the Pi yet, the image that already built
can run the migration directly. From the existing Pi deployment directory,
with the USB still mounted and PostgreSQL healthy, use:

```sh
sudo docker compose --env-file .env -f compose.yaml run --rm --no-deps web \
  node --import tsx scripts/migrate.ts
sudo docker compose --env-file .env -f compose.yaml up -d --wait --wait-timeout 180 web
```

This gets the current deployment past the failed step. Transfer the corrected
`deploy.sh` afterward so future deployments use the same direct command.

The database starts empty. Deployment does not load the old D1 records or
insert demo records. Creating a work card through engineering or mobile uses
the same API that management reads.

To view the app on your Windows computer, keep this SSH tunnel open in a
PowerShell window (replace the Pi username and LAN address):

```powershell
ssh -L 5173:127.0.0.1:5173 <pi-username>@<pi-LAN-address>
```

Then open `http://localhost:5173/management` in that computer's browser.
The `/engineering` and `/mobile` routes are also available through the tunnel
for desktop testing. A normal phone browser cannot reach the Pi service until
a later, deliberately secured network step.

## USB fail-closed behavior

The Compose file bind-mounts the specific host data path and sets
`create_host_path: false`, so Compose will not invent the PostgreSQL directory
on microSD when it is absent. It also requires a marker file that the
preparation script creates only after verifying the mounted drive's UUID.
Before invoking the official PostgreSQL entrypoint, the container checks
the **host** mount table through a read-only `/proc/1/mountinfo` bind mount.
It requires ext4 mounted exactly at `/srv/tracker-data` and the matching UUID
marker. If the USB is missing at boot, PostgreSQL cannot initialize on the
microSD even if stale directories happen to exist there. Docker's
`unless-stopped` policy retries; once the USB is mounted, rerun `sh ./deploy.sh`
if the containers have not recovered.

PostgreSQL has a 1 GB memory limit and a 20-connection cap; the Node app has a
2 GB limit and a pool of five database connections. The database network is
internal to Compose. The web process runs as an unprivileged user. At startup,
its root wrapper copies the Docker secret into a tiny private tmpfs, then drops
privileges. Secrets are never placed in the app's environment or in source
control. The database and web containers have health checks and
`unless-stopped` restart policies.

## Backups and restore tests

Run backups from the Pi deployment directory. The destination must be an
explicit absolute directory outside `/srv/tracker-data`. If your user can run
Docker without `sudo`, use:

```sh
sh ./backup.sh /home/<pi-user>/tracker-backups
sh ./test-restore.sh /home/<pi-user>/tracker-backups/<printed-backup-name>.dump
```

If Docker access requires `sudo`, use the same paths with:

```sh
sudo sh ./backup.sh /home/<pi-user>/tracker-backups
sudo sh ./test-restore.sh /home/<pi-user>/tracker-backups/<printed-backup-name>.dump
```

Replace `<pi-user>` and use the exact dump path printed by `backup.sh`. Files
created through `sudo` are returned to the invoking user's UID and GID. Backup
archives and checksum files use mode `0600`.

A directory under `/home` is useful as temporary microSD staging, but it is not
protection against loss of the Pi. Copy each `.dump` and its `.sha256` companion
to a NAS, another computer, or a second removable device. You can also pass an
already-mounted NAS or second-device directory directly, for example:

```sh
findmnt --mountpoint /mnt/tracker-backups
sudo sh ./backup.sh /mnt/tracker-backups
```

Verify that the intended destination device is mounted before running the
backup. The script refuses `/srv/tracker-data` and all directories beneath it,
because a backup beside the live PostgreSQL files would be lost with the same
USB drive.

`backup.sh` checks the configured USB UUID, deployment marker, password file,
Compose configuration, and PostgreSQL readiness. It writes a custom-format
`pg_dump` archive inside the PostgreSQL container with ownership and ACL data
removed and a 30-second lock timeout. It validates that archive with
`pg_restore --list`, copies it to a hidden partial file on the destination,
calculates SHA-256, and renames both files into place. The checksum companion
contains only the dump basename, so the pair can be moved together. Container
and partial files are removed after success or failure. This avoids streaming
`pg_dump` through `docker compose exec`, which hung on this Pi during the
manual recovery procedure.

`test-restore.sh` checks the optional adjacent `.sha256` companion, validates
the archive, and restores it into a uniquely named temporary database. It
requires the Tracker migration, work-item, checklist, and counter tables,
prints their restored row counts, and requires zero orphan checklist steps.
The temporary database and container archive are removed after success or
failure. The live `tracker` database is never a restore target and is not
modified by this test.

Keep a secure copy of `infra/docker/pi/secrets/postgres_password.txt` alongside
your off-device backups. Replacing that file does not rotate the existing
PostgreSQL user's password. Do not use `docker compose down -v` or delete the
USB data directory during normal updates.

## Existing D1 data

The previous D1 database is untouched. Before cutting over real work, decide
which D1 data is authoritative, export and back it up, classify any demo
records, import into a separate PostgreSQL staging database, and compare
records and checklist links before choosing it for production. The detailed
[D1 cutover checklist](postgresql.md#existing-d1-data-separate-cutover-still-required)
remains open. The old Cloudflare/Sites build is not the runtime for these
containers.

The base Pi deployment and a manual backup/restore recovery have been exercised
on the user's Pi. The new repeatable backup scripts and an off-device restore
test still need to be run there; D1 migration also remains open.
On the development computer, Docker Compose v5.5.0 accepted `compose.yaml`,
including the private database network, exact USB bind, and loopback-only web
port. The app production build, lint, type checks, 20 local tests, and source
archive verification passed. Docker Desktop is installed there, but its daemon
was not running during this check; container runtime validation remains Pi-side.

Compose choices follow [Docker's bind-mount guidance](https://docs.docker.com/reference/compose-file/services/#volumes),
[startup ordering](https://docs.docker.com/compose/how-tos/startup-order/), and
the [PostgreSQL image's data directory guidance](https://github.com/docker-library/docs/blob/master/postgres/content.md).
