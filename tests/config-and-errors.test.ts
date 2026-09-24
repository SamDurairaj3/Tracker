import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { postgresConfig, createPostgresDatabase } from '../db/postgres';
import { createWorkItemHandlers } from '../lib/work-items-api';
import { migrate } from '../db/migrate';
import { memoryPostgres } from './helpers/pglite';
import { input } from './helpers/contract';

test('database configuration fails clearly without credentials and bounds the pool', () => {
  assert.throws(() => postgresConfig({}), /DATABASE_URL or DATABASE_PASSWORD_FILE is required/);
  assert.equal(postgresConfig({ DATABASE_URL: 'postgresql://localhost/test' }).max, 5);
  for (const value of ['0', '-1', '1.5', 'bad', '101']) {
    assert.throws(() => postgresConfig({ DATABASE_URL: 'postgresql://localhost/test', DATABASE_POOL_MAX: value }), /DATABASE_POOL_MAX/);
  }
});

test('container database credentials come from a secret file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tracker-db-config-'));
  const file = join(directory, 'password');
  try {
    writeFileSync(file, 'test-secret\n');
    const env = {
      DATABASE_HOST: 'postgres', DATABASE_PORT: '5432',
      DATABASE_NAME: 'tracker', DATABASE_USER: 'tracker', DATABASE_PASSWORD_FILE: file,
    };
    const config = postgresConfig(env);
    assert.equal(config.password, 'test-secret');
    assert.equal(config.host, 'postgres');
    assert.equal(config.database, 'tracker');
    assert.equal(config.port, 5432);
    assert.equal(config.connectionString, undefined);
    assert.throws(() => postgresConfig({ ...env, DATABASE_URL: 'postgresql://localhost/tracker' }), /not both/);
    assert.throws(() => postgresConfig({ ...env, DATABASE_PORT: '0' }), /DATABASE_PORT/);
    writeFileSync(file, '\n');
    assert.throws(() => postgresConfig(env), /one nonempty password line/);
  } finally {
    unlinkSync(file);
    rmdirSync(directory);
  }
});

test('pool releases its client after commit and rolls back after failure', async () => {
  const calls: string[] = [];
  const client = {
    async query(sql: string) { calls.push(sql); return { rows: [] }; },
    release(discard: boolean) { calls.push(`release:${discard}`); },
  };
  const db = createPostgresDatabase({ connect: async () => client } as unknown as Pool);
  await db.transaction(async (tx) => { await tx.query('SELECT 1'); }, { readOnly: true });
  assert.deepEqual(calls, ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'SELECT 1', 'COMMIT', 'release:false']);
  calls.length = 0;
  await assert.rejects(db.transaction(async () => { throw new Error('failure'); }), /failure/);
  assert.deepEqual(calls, ['BEGIN', 'ROLLBACK', 'release:false']);
  calls.length = 0;
  client.query = async (sql) => { calls.push(sql); if (sql === 'ROLLBACK') throw new Error('disconnected'); return { rows: [] }; };
  await assert.rejects(db.transaction(async () => { throw new Error('original failure'); }), /original failure/);
  assert.deepEqual(calls, ['BEGIN', 'ROLLBACK', 'release:true']);
});

test('failed migration rolls back schema and migration history together', async () => {
  const { db, close } = memoryPostgres();
  try {
    await assert.rejects(migrate(db, new URL('./fixtures/invalid-migrations/', import.meta.url)));
    const { rows } = await db.query<{ created: string | null; history: string | null }>(
      "SELECT to_regclass('should_rollback')::text AS created, to_regclass('tracker_schema_migrations')::text AS history",
    );
    assert.deepEqual(rows, [{ created: null, history: null }]);
    assert.deepEqual(await migrate(db), ['0001_work_items.sql', '0002_better_auth.sql', '0003_work_item_lifecycle.sql']);
  } finally { await close(); }
});

test('API storage failures retain generic error bodies and 500 statuses', async (context) => {
  context.mock.method(console, 'error', () => {});
  const fail = async (): Promise<never> => { throw new Error('private database diagnostic'); };
  const api = createWorkItemHandlers(
    { listWorkItems: fail, getWorkItem: fail, insertWorkItem: fail, patchWorkItem: fail },
    async () => ({ id: null, name: 'Authenticated Engineer', role: 'engineer' }),
  );
  for (const [response, message] of [
    [await api.GET(new Request('http://localhost/api/work-items')), 'Work items could not be loaded.'],
    [await api.POST(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' }, body: JSON.stringify(input) })), 'The work item could not be created.'],
    [await api.PATCH(new Request('http://localhost', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' }, body: JSON.stringify({ id: 'PROP-001', status: 'active' }) })), 'The work item could not be updated.'],
  ] as const) {
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: message });
  }
});
