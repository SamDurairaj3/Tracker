import { database } from '../../../db/postgres';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    // A successful connection alone is not enough: the schema must be ready.
    await database().query('SELECT 1 FROM tracker_schema_migrations LIMIT 1');
    return Response.json({ status: 'ok' });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
