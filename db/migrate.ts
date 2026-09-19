import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Database } from './database';

const defaultDirectory = new URL('./migrations/', import.meta.url);

export async function migrate(db: Database, directory = defaultDirectory) {
  const files = (await readdir(directory)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
  return db.transaction(async (client) => {
    // Serializes concurrent migration commands, including first-time setup.
    await client.query('SELECT pg_advisory_xact_lock(74231901)');
    await client.query(`CREATE TABLE IF NOT EXISTS tracker_schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM tracker_schema_migrations',
    );
    const applied = new Map(rows.map((row) => [row.name, row.checksum]));
    for (const name of applied.keys()) {
      if (!files.includes(name)) throw new Error(`Applied migration is missing: ${name}`);
    }
    const completed: string[] = [];
    for (const name of files) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      // The same migration may be checked out with CRLF on Windows and LF on Pi.
      const checksum = createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex');
      if (applied.has(name)) {
        if (applied.get(name) !== checksum) throw new Error(`Applied migration was changed: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO tracker_schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
      completed.push(name);
    }
    return completed;
  });
}
