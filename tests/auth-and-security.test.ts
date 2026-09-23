import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ACCESS_DENIED,
  AUTHENTICATION_REQUIRED,
  createWorkItemHandlers,
} from '../lib/work-items-api';
import {
  parseAuthRole,
  readAuthSecret,
  safeNextPath,
} from '../lib/auth-config';
import { parseAuthAdminArgs } from '../scripts/auth-admin';
import { migrate } from '../db/migrate';
import { memoryPostgres } from './helpers/pglite';
import { input } from './helpers/contract';
import type { WorkItem } from '../lib/work-items';

function request(method = 'GET', body?: unknown) {
  return new Request('http://localhost/api/work-items', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function stubItem(createdBy: string): WorkItem {
  return {
    id: 'PROP-001',
    title: 'Test pressure model',
    team: 'Propulsion',
    owner: 'Arjun Menon',
    status: 'captured',
    health: 'on-track',
    priority: 'High',
    progress: 0,
    start: '2026-09-17',
    due: '2026-09-21',
    dueLabel: '21 Sept',
    createdBy,
    type: 'Task',
    purpose: 'Test evidence',
    expectedResult: 'Reviewed result',
    linkedGoal: null,
    progressMethod: 'checklist-count',
    blocker: null,
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z',
    archivedAt: null,
    archivedByName: null,
    activityCount: 1,
    latestActivityAt: '2026-09-19T00:00:00.000Z',
    checklist: [],
  };
}

test('auth secret must come from a valid high-entropy secret file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tracker-auth-config-'));
  const file = join(directory, 'secret');
  try {
    assert.throws(() => readAuthSecret({}), /BETTER_AUTH_SECRET_FILE is required/);
    assert.throws(
      () => readAuthSecret({ BETTER_AUTH_SECRET: 'x'.repeat(64), BETTER_AUTH_SECRET_FILE: file }),
      /must not be placed in the environment/,
    );
    writeFileSync(file, 'too-short\n');
    assert.throws(() => readAuthSecret({ BETTER_AUTH_SECRET_FILE: file }), /at least 32 bytes/);
    writeFileSync(file, `${'a'.repeat(32)}\nsecond-line\n`);
    assert.throws(() => readAuthSecret({ BETTER_AUTH_SECRET_FILE: file }), /exactly one/);
    writeFileSync(file, `${'A7!'.repeat(16)}\n`);
    assert.equal(readAuthSecret({ BETTER_AUTH_SECRET_FILE: file }), 'A7!'.repeat(16));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('role parsing and post-login destinations fail closed', () => {
  assert.equal(parseAuthRole('engineer'), 'engineer');
  assert.equal(parseAuthRole('engineer,admin'), 'admin');
  assert.equal(parseAuthRole('viewer'), null);
  assert.equal(safeNextPath('https://example.com', 'engineer'), '/engineering');
  assert.equal(safeNextPath('/management', 'admin'), '/management');
  assert.equal(safeNextPath('/management/users', 'admin'), '/management/users');
});

test('work-item API rejects anonymous and unauthorized callers before storage', async () => {
  let calls = 0;
  const repository = {
    async listWorkItems() { calls += 1; return []; },
    async getWorkItem() { calls += 1; return null; },
    async insertWorkItem() { calls += 1; return stubItem('unused'); },
    async patchWorkItem() { calls += 1; return null; },
  };
  const anonymous = createWorkItemHandlers(repository, async () => null);
  const unauthenticated = await anonymous.GET(request());
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), { error: AUTHENTICATION_REQUIRED });
  assert.equal(calls, 0);

  const unknownRole = createWorkItemHandlers(
    repository,
    async () => ({ id: null, name: 'Visitor', role: 'viewer' }),
  );
  const forbidden = await unknownRole.PATCH(request('PATCH', { id: 'PROP-001' }));
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { error: ACCESS_DENIED });
  assert.equal(calls, 0);
});

test('work-item creation always uses the authenticated display name', async () => {
  let recorded = '';
  const api = createWorkItemHandlers({
    async listWorkItems() { return []; },
    async getWorkItem() { return null; },
    async insertWorkItem(value, actor) {
      recorded = actor?.name ?? '';
      return stubItem(actor?.name ?? '');
    },
    async patchWorkItem() { return null; },
  }, async () => ({ id: null, name: 'Signed In Engineer', role: 'engineer' }));
  const response = await api.POST(request('POST', { ...input, createdBy: 'Spoofed Name' }));
  assert.equal(response.status, 201);
  assert.equal(recorded, 'Signed In Engineer');
  assert.equal((await response.json() as { item: WorkItem }).item.createdBy, 'Signed In Engineer');
});

test('auth migration is explicit and creates every Better Auth table', async () => {
  const { db, close } = memoryPostgres();
  try {
    assert.deepEqual(await migrate(db), ['0001_work_items.sql', '0002_better_auth.sql', '0003_work_item_lifecycle.sql']);
    const { rows } = await db.query<{ name: string | null }>(`
      SELECT to_regclass(name)::text AS name
      FROM unnest(ARRAY[
        'auth_users', 'auth_sessions', 'auth_accounts',
        'auth_verifications', 'auth_rate_limits'
      ]) AS name
    `);
    assert.deepEqual(rows.map((row) => row.name).sort(), [
      'auth_accounts',
      'auth_rate_limits',
      'auth_sessions',
      'auth_users',
      'auth_verifications',
    ]);
  } finally {
    await close();
  }
});

test('provisioning CLI refuses password arguments and validates roles', () => {
  assert.throws(
    () => parseAuthAdminArgs(['create', '--email', 'a@example.com', '--name', 'A', '--role', 'admin', '--password', 'secret']),
    /stdin/,
  );
  assert.throws(
    () => parseAuthAdminArgs(['create', '--email', 'a@example.com', '--name', 'A', '--role', 'viewer']),
    /admin or engineer/,
  );
  assert.deepEqual(parseAuthAdminArgs(['disable', '--email', 'A@Example.com']), {
    command: 'disable',
    email: 'a@example.com',
  });
  assert.deepEqual(
    parseAuthAdminArgs(['create', '--email', 'A@Example.com', '--name', '  Asha   Nair  ', '--role', 'engineer']),
    { command: 'create', email: 'a@example.com', name: 'Asha Nair', role: 'engineer' },
  );
});

test('service worker never caches protected HTML or API responses', () => {
  const source = readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /['"]\/mobile['"]/);
  assert.match(source, /request\.mode === 'navigate'/);
  assert.match(source, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.doesNotMatch(source, /caches\.match\('\/mobile'\)/);
});
