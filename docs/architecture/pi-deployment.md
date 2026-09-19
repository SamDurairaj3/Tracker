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

## Backups and existing D1 data

Before storing important new work, arrange regular database backups to a
**second device or another machine**, with a restore test. A copy on the same
USB drive will not survive a drive failure. One manual backup command, from
the Pi deployment directory, is:

```sh
mkdir -p "$HOME/tracker-backups"
set -o pipefail
docker compose --env-file .env -f compose.yaml exec -T postgres \
  pg_dump -U tracker -d tracker -Fc \
  > "$HOME/tracker-backups/tracker-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Copy the resulting archive off the Pi and verify that it can be restored into
a separate test database. Also keep a secure copy of the password file. The
Pi's microSD backup directory above is a temporary staging location, not the
only backup location. Do not use `docker compose down -v` or delete the USB
data directory during normal updates.

The previous D1 database is untouched. Before cutting over real work, decide
which D1 data is authoritative, export and back it up, classify any demo
records, import into a separate PostgreSQL staging database, and compare
records and checklist links before choosing it for production. The detailed
[D1 cutover checklist](postgresql.md#existing-d1-data-separate-cutover-still-required)
remains open. The old Cloudflare/Sites build is not the runtime for these
containers.

This Step 2 implementation has not been run on the user's Pi; the drive mount,
ARM64 image build, restore test, and D1 migration must be validated there.
On the development computer, Docker Compose v5.5.0 accepted `compose.yaml`,
including the private database network, exact USB bind, and loopback-only web
port. The app production build, lint, type checks, 20 local tests, and source
archive verification passed. No Docker daemon is installed on that computer,
so an actual container build and runtime check are still pending on the Pi.

Compose choices follow [Docker's bind-mount guidance](https://docs.docker.com/reference/compose-file/services/#volumes),
[startup ordering](https://docs.docker.com/compose/how-tos/startup-order/), and
the [PostgreSQL image's data directory guidance](https://github.com/docker-library/docs/blob/master/postgres/content.md).
