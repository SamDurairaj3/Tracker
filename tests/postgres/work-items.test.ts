import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { createPostgresDatabase } from '../../db/postgres';
import { databaseContract } from '../helpers/contract';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  test('native PostgreSQL contract', { skip: 'Set TEST_DATABASE_URL to a dedicated test database.' }, () => {});
} else {
  databaseContract('Work-item contract on native PostgreSQL with multiple connections', async () => {
    // Only this newly created random schema is ever changed or dropped.
    const schema = `tracker_test_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const pool = new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
    return {
      db: createPostgresDatabase(pool),
      async close() {
        await pool.end();
        try { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
        finally { await admin.end(); }
      },
    };
  });
}
