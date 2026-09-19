# Preserved D1 implementation

These files are a historical copy of the work-item persistence implementation
before the PostgreSQL change. They are excluded from compilation and linting and
are not used by the app. Their original relative imports are historical only.

The legacy SQLite migration remains at `drizzle/0000_work_items.sql`. Existing
`.wrangler` state, `.openai` hosting metadata, and earlier build outputs are left
in place. Nothing here is an export or a backup of the hosted D1 database.

The active schema is `db/migrations/0001_work_items.sql` and active persistence is
`db/work-items.ts` with `db/postgres.ts`.
