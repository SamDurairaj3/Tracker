# Tracker

Modular internal operations software, starting with work tracking for a engineering team.

## Workspace layout

```text
app/                    Browser dashboard and API (Next.js)
public/                 Web assets
apps/
  api/                 Main backend and business rules (NestJS)
  mobile/              Future engineer companion app
packages/
  ui/                  Shared interface components
  contracts/           Shared API types and validation contracts
  domain/              Framework-independent domain rules
  config/              Shared TypeScript and tooling configuration
services/
  analytics/           Future Python forecasting, simulation, ML, and LLM work
infra/
  docker/              Local containers and deployment definitions
docs/
  product/             Product concepts and workflow definitions
  architecture/        System design documentation
  decisions/           Architecture decision records
scripts/               Workspace maintenance and developer utilities
tests/
  e2e/                 Cross-application end-to-end tests
```

The current web slice stores work items in PostgreSQL through the shared API and displays them in the engineer, management, and mobile workspaces. It now runs on standard Node.js/Next.js in preparation for a later Raspberry Pi deployment.

The web application stays at the workspace root. The existing `apps/api` and reusable package directories are future scaffolding; the active API is `app/api/work-items`. Historical Sites configuration is retained, but the old Cloudflare runtime cannot run this PostgreSQL version directly.

## Local development

### Requirements

- Node.js 24 or newer
- pnpm 11
- PostgreSQL with a dedicated empty database and user

### First-time setup

1. Install the workspace packages with `pnpm install`.
2. Copy `.env.example` to `.env.local` if that file does not already exist; otherwise update it. Set `DATABASE_URL` for your database.
3. Run `pnpm db:migrate` to create the PostgreSQL tables.
4. Start the web application with `pnpm dev`.
5. Open `http://localhost:5173`.

New databases start empty. Demo seeding is an explicit, guarded operation; it is never run by startup or migrations. No browser storage is used as the source of truth for work records. Existing D1 data is preserved but has not been imported.

See [the PostgreSQL setup and cutover guide](docs/architecture/postgresql.md) for local configuration and existing D1 data. The [Raspberry Pi deployment guide](docs/architecture/pi-deployment.md) covers transferring the app, checking the USB mount, and starting Docker Compose. Nothing has been deployed to the Pi.

## Application surfaces

| Route | Audience | Purpose |
|---|---|---|
| `/management` | Management | Organization-wide work visibility with Kanban and Gantt views |
| `/engineering` | Engineers | Create owned work, update its workflow, and complete assigned actions |
| `/mobile` | Engineers on phones | Installable companion for creating work cards, owned work, and assigned actions |

The root route redirects to `/management`. All three surfaces read and write the same work-item API, so engineer-created work is included in management totals, Kanban columns, filters, and the Gantt schedule.

### Mobile PWA

Open `/mobile` on a phone or supported desktop browser. When the browser offers installation, the install card adds Vector Work as a standalone app that starts on the mobile workspace.

The mobile experience caches only its application shell and static assets. Work-item API responses are never treated as cached authoritative data. An unfinished work-card form is saved locally on the device, but creating the actual work item requires an active connection; once created, it uses the shared API and appears in management immediately.

Superseded interface prototypes are preserved under `archive/` with timestamped filenames and explanatory header comments.

## Quality commands

| Command | Purpose |
|---|---|
| `pnpm lint` | Check source quality and common mistakes |
| `pnpm typecheck` | Verify strict TypeScript types |
| `pnpm build` | Produce the deployable web build |
| `pnpm start` | Serve the Node.js production build on localhost |
| `pnpm db:migrate` | Apply pending PostgreSQL schema migrations |
| `pnpm db:seed:demo --confirm-demo` | Seed an empty development database only after explicit environment opt-in |
| `pnpm test` | Run isolated embedded PostgreSQL and API tests |
| `pnpm test:postgres` | Run native PostgreSQL tests when `TEST_DATABASE_URL` is set |
| `pnpm check` | Run lint, typecheck, tests, and production build |

## Environment files

Commit safe variable names and local defaults in `.env.example`. Keep developer-specific values and every secret in ignored `.env.local` files.
