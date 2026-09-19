# PostgreSQL preparation for the Raspberry Pi

Step 1 moves work-item storage to PostgreSQL and runs the existing web app in
Node.js. Nothing in this step deploys to the Pi, configures a public hostname,
or changes the existing hosted site. Management, engineering, and mobile still
call the same `/api/work-items` endpoint.

## Local setup

You need Node.js 24+, pnpm 11, and a running PostgreSQL server. Create a dedicated
empty database and a database user that owns it. The normal dependency install
does not install or start PostgreSQL.

1. Run `pnpm install` from the project folder.
2. Copy `.env.example` to `.env.local` **only if `.env.local` does not exist**.
   Otherwise add the new variables to your existing file.
3. Set `DATABASE_URL` to your database connection string. The checked-in password
   is only an example. URL-encode any special characters in credentials.
4. Run `pnpm db:migrate` to create the tables. You can safely rerun this command;
   it records applied migrations and refuses changes to their contents.
5. Run `pnpm dev`, then open `http://localhost:5173`.

The app initially shows no work cards. Creating a card in engineering or mobile
makes it available through management's existing refresh behavior. Requests do
not create tables, run migrations, or seed records. If PostgreSQL is unavailable
or migrations were not run, the API returns its existing generic failure messages;
it never silently falls back to D1 or browser storage.

For a production-style local check, run `pnpm build`, then `pnpm start`.
Both development and start commands bind to `127.0.0.1` only. The Node build lives
in `.next-node`, separate from the old Sites outputs. Building requires no
database connection; serving work records does.

Next.js loads `.env.local` for the app. Database scripts explicitly load this
same file with Node's `--env-file-if-exists`; already-exported environment
variables take precedence. `DATABASE_URL` is server-only. `NEXT_PUBLIC_API_URL`
is no longer documented because clients already use the same-origin API.

## Optional demo data

Use a separate, disposable development database for demonstrations. Demo data
is never part of a migration and is never inserted on app startup.

To opt in, set `ALLOW_DEMO_SEED=true` in that development environment, set
`NODE_ENV=development`, then run `pnpm db:seed:demo --confirm-demo`.
For example, in PowerShell after configuring the development database:

```powershell
$env:NODE_ENV = 'development'
$env:ALLOW_DEMO_SEED = 'true'
pnpm db:seed:demo --confirm-demo
Remove-Item Env:ALLOW_DEMO_SEED
Remove-Item Env:NODE_ENV
```

On Ubuntu, the equivalent one-command opt-in is:

```sh
NODE_ENV=development ALLOW_DEMO_SEED=true pnpm db:seed:demo --confirm-demo
```

The command requires all three confirmations and refuses a database containing
work items, checklist steps, or ID counters. Its emptiness check and inserts run
under one transaction with table locks. A failed run leaves no partial demo data.
This is a safeguard against mistakes, not a way to identify whether a connection
points to production: verify the database name before opting in.

## What changed internally

- `db/postgres.ts` owns the lazy connection pool, bounded to five connections by
  default (`DATABASE_POOL_MAX` can change this). Transactions use one checked-out
  connection and always release it; failures roll back.
- `db/work-items.ts` implements the existing list/get/create/patch contract through
  a small SQL interface. There are no Cloudflare imports in the active data layer.
- `db/migrations/` is the authoritative PostgreSQL schema. The migration command
  applies pending files in one transaction, with an advisory lock and checksums.
  Add a new numbered migration instead of editing an applied file.
- Creating a card, allocating its ID, and inserting its steps are atomic. Team
  prefixes remain the same, and counters allocate unique IDs across connections.
  Numeric imported IDs, including values above 999, are respected automatically.
  Import only while application writes are stopped.
- Updates lock the parent card before changing steps or progress. Concurrent
  partial edits preserve each other's fields. Reads use a consistent snapshot.
- Dates and timestamps remain text to preserve the original API strings and
  timezone behavior. Optional fields remain null; checklist order and progress
  rules are unchanged. Only `checklist-count` currently computes progress from
  steps; the other modes retain their previous behavior.
- `lib/work-items-api.ts` contains the unchanged HTTP behavior in a testable
  factory. The route remains dynamic and explicitly selects the Node.js runtime.

## Tests

`pnpm check` runs lint, TypeScript, tests, and the production build.

`pnpm test` uses PGlite, an embedded PostgreSQL engine, in disposable memory.
It runs actual SQL for migrations, CRUD, constraints, rollback, ID allocation,
progress, safe seeding, and HTTP response contracts. No existing database is used.
It also checks pool cleanup and migration failure recovery.

For the same contract tests against a native PostgreSQL server, set
`TEST_DATABASE_URL` to a **dedicated test database** and run `pnpm test:postgres`.
Each run creates a randomly named schema and removes only that schema afterward.
The pool uses multiple connections to exercise real concurrent writers. This
suite skips explicitly if `TEST_DATABASE_URL` is absent. It never falls back to
`DATABASE_URL`. The test user needs permission to create schemas.

## Existing D1 data: separate cutover still required

No existing database was exported, imported, reset, or deleted. The `.wrangler`
directory and hosted D1 records are not part of the PostgreSQL migrations.
The old D1 implementation is preserved under `archive/d1`; its old migration
remains under `drizzle`. Those files must not be applied to PostgreSQL.

Before moving real work:

1. Identify the authoritative D1 database and stop writes for the final export.
   The dummy database ID in the old Vite configuration is not a hosted database ID.
   Establish whether local `.wrangler` data, hosted D1 data, or both need review.
2. Back up the source and export `work_items` and `checklist_steps`. Retain the
   untouched export for rollback. Classify demo versus real records with the user;
   titles, dates, or seeded IDs alone are not a safe basis for deleting records.
3. Test a conversion/import into a new PostgreSQL staging database. Preserve all
   IDs, references, optional values, positions, timestamps, and date strings. Map
   both tables' columns explicitly and use one transaction, with parents first.
   A SQLite SQL dump may contain `PRAGMA` and other incompatible statements; it
   cannot simply be run against PostgreSQL. No D1 import utility is included yet.
4. Compare row counts and records, check orphan steps and progress values, and
   review all three app surfaces before selecting the new database for real use.
   Resolve any legacy values rejected by PostgreSQL without silently discarding
   rows. The next ID allocator accounts for the imported numeric ID suffixes.
5. Keep the old service read-only during validation. If writes resume in the new
   system, switching back requires reconciling those new writes, not just changing
   a connection string.

An actual D1 export and a decision about which data is authoritative remain
blockers to a verified data cutover.

## Cloudflare/Sites boundary and Docker preparation

The previous Vite setup used vinext inside a Cloudflare Worker with a D1 binding.
The new normal commands use Next.js on Node, whose PostgreSQL driver opens server
connections. A database URL alone does not make the old Worker/Sites deployment
compatible. The old hosting metadata and dependencies remain for reference;
`vite.config.ts` refuses this unsupported build path with an explanation.
No Sites deployment was performed. Its existing hosted version is unchanged.

Step 2 adds a [Raspberry Pi Docker Compose guide](pi-deployment.md) and
definitions for the Node app and PostgreSQL. It runs migrations as an explicit
deployment step, binds the app to the Pi's loopback address, and keeps
PostgreSQL private. ARM64 image execution, backup restores, and a decision
about any reverse proxy still require Pi-side work. The placeholders under
`apps/api` are not an implemented NestJS backend.

The app still has its existing fixed engineer identity and no authentication
system. Authentication, access control, and HTTPS are separate deployment work;
phone PWA installation/service-worker behavior also needs a secure browser origin.
This task does not expose the app to a network or claim it is production-ready.

## Verification on 17 September 2026

- ESLint and strict TypeScript checks passed.
- The Next.js production build passed without a configured application database.
- All 19 isolated tests passed.
- All 15 native PostgreSQL contract tests passed on PostgreSQL 18.4 for Windows,
  including multi-connection creation and updates. A portable test server was
  used in the ignored `data/` directory, bound only to `127.0.0.1:55439`.
- The production app was tested at `127.0.0.1:5175` against a separate test
  database. Browser checks created cards through engineering and mobile,
  completed an assigned checklist action, and verified the shared totals and
  cards in management's Kanban and Gantt views. A mobile page reload retained
  the saved cards and progress.

The temporary app and database servers were stopped after verification. No
application `.env.local` was created, no D1 data was modified, and no Pi or
Linux/ARM64 execution was tested. The ignored verification data is not a
production database or an imported copy of user records.

Implementation references: [node-postgres transactions](https://node-postgres.com/features/transactions),
[Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting), and
[PGlite API](https://pglite.dev/docs/api).
