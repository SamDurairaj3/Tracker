# Tracker

Modular internal operations software, starting with work tracking for an engineering team.

## Workspace layout

```text
app/                    Browser dashboard and API (Next.js)
public/                 Web assets
apps/
  api/                  Main backend and business rules (NestJS)
  mobile/               Future engineer companion app
packages/
  ui/                    Shared interface components
  contracts/             Shared API types and validation contracts
  domain/                Framework-independent domain rules
  config/                Shared TypeScript and tooling configuration
services/
  analytics/             Future Python forecasting, simulation, ML, and LLM work
infra/
  docker/                Local containers and deployment definitions
docs/
  product/               Product concepts and workflow definitions
  architecture/          System design documentation
  decisions/             Architecture decision records
scripts/                 Workspace maintenance and developer utilities
tests/
  e2e/                   Cross-application end-to-end tests
```

The current web slice stores work items in PostgreSQL through the shared API and displays them in the engineer, management, and mobile workspaces. It runs on standard Node.js/Next.js in preparation for a Raspberry Pi deployment and uses Better Auth for invite-only accounts and database-backed sessions.

The web application stays at the workspace root. The existing `apps/api` and reusable package directories are future scaffolding; the active API is `app/api/work-items`. Historical Sites configuration is retained, but the old Cloudflare runtime cannot run this PostgreSQL version directly.

## Local development

### Requirements

- Node.js 24 or newer
- pnpm 11
- PostgreSQL with a dedicated empty database and user

### First-time setup

1. Install the workspace packages with `pnpm install`.
2. Copy `.env.example` to `.env.local` if that file does not already exist; otherwise update it. Set `DATABASE_URL` for your database.
3. Create an ignored `secrets/better_auth_secret.txt` containing one high-entropy line of at least 32 bytes. Keep `BETTER_AUTH_SECRET_FILE` in `.env.local` pointed at that file.
4. Generate an ignored P-256 key with `openssl ecparam -name prime256v1 -genkey -noout -out secrets/vapid_private_key.pem`, then set `VAPID_PRIVATE_KEY_FILE` and a `VAPID_SUBJECT=mailto:<contact-address>` in `.env.local`.
5. Run `pnpm db:migrate` to create the work-item, authentication, and push-subscription tables.
6. Create the first invited administrator with `pnpm auth:admin -- create --email <address> --name "<name>" --role admin`. The command reads the password privately from stdin.
7. Run `pnpm dev`, then open `http://localhost:5173` and sign in.

New databases start empty. Demo seeding is an explicit, guarded operation; it is never run by startup or migrations. No browser storage is used as the source of truth for work records. Existing D1 data is preserved but has not been imported.

See [the PostgreSQL setup and cutover guide](docs/architecture/postgresql.md) for local authentication, database configuration, and existing D1 data. The [Raspberry Pi deployment guide](docs/architecture/pi-deployment.md) covers source transfer, USB checks, account provisioning, private SSH testing, and the separate opt-in Quick Tunnel review path. Nothing has been deployed to the Pi, and normal deployment does not start a tunnel.

## Application surfaces

| Route | Audience | Purpose |
|---|---|---|
| `/management` | Administrators | Create and assign work cards, and review organization-wide Kanban and Gantt views |
| `/management/users` | Administrators | Create, edit, disable, re-enable, and reset invited accounts |
| `/engineering` | Invited administrators and engineers | Create owned work, update its workflow, and complete assigned actions |
| `/mobile` | Invited administrators and engineers on phones | Installable companion for creating work cards, owned work, and assigned actions |

Unauthenticated requests go to `/login`. After sign-in, the root route sends administrators to `/management` and engineers to `/engineering`; engineers cannot open management routes. Every work-item API operation also requires an active administrator or engineer session. All three work surfaces use the same work-item API, so engineer-created work is included in management totals, Kanban columns, filters, and the Gantt schedule.

Administrators manage invite-only accounts at `/management/users`. The portal creates credential accounts, edits names, emails, and roles, resets passwords, and disables or re-enables access without deleting attribution history. Renames update exact owner, creator, and checklist-assignee references in one transaction. Session-revoking changes require the affected administrator to sign in again. The local `auth:admin` CLI remains the recovery path when no administrator can use the portal.

### Mobile PWA

Open `/mobile` on a phone or supported desktop browser after signing in. When the browser offers installation, the install card adds Vector Work as a standalone app that starts on the mobile workspace.

The service worker caches static Next.js assets, icons, and the manifest only. It never caches protected HTML or API responses. An unfinished work-card form is saved locally on the device, but creating the actual work item requires an active authenticated connection; once created, it uses the shared API and appears in management immediately. Cards open a shared full-detail view. Engineers can update owned workflow status and their assigned checklist actions; administrators can update workflow and checklist status. Mobile Notifications includes a live attention feed and an explicit device-level Web Push control. After a user selects **Enable push notifications** and accepts the browser prompt, the device can receive relevant card, assignment, activity, and comment alerts while the PWA is closed. The actor who caused the event is not alerted, and pushes are limited to the card owner and checklist assignees.

Superseded interface prototypes are preserved under `archive/` with timestamped filenames and explanatory header comments.

## Quality commands

| Command | Purpose |
|---|---|
| `pnpm lint` | Check source quality and common mistakes |
| `pnpm typecheck` | Verify strict TypeScript types |
| `pnpm build` | Produce the deployable web build |
| `pnpm start` | Serve the Node.js production build on localhost |
| `pnpm db:migrate` | Apply pending PostgreSQL schema migrations |
| `pnpm auth:admin -- <command>` | Create, list, disable, enable, reset, or verify invited accounts |
| `pnpm db:seed:demo --confirm-demo` | Seed an empty development database only after explicit environment opt-in |
| `pnpm test` | Run isolated embedded PostgreSQL, auth, API, and security tests |
| `pnpm test:postgres` | Run native PostgreSQL tests when `TEST_DATABASE_URL` is set |
| `pnpm check` | Run lint, typecheck, tests, and production build |

## Environment files

Commit safe variable names and local defaults in `.env.example`. Keep developer-specific values in ignored `.env.local` files and store authentication and database credentials in ignored secret files where the deployment supports them. Never use `NEXT_PUBLIC_` variables for secrets.
