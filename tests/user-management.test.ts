import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { verifyPassword } from 'better-auth/crypto';
import { migrate } from '../db/migrate';
import type { Database } from '../db/database';
import { createWorkItemRepository } from '../db/work-items';
import {
  UserManagementError,
  createUserManagementService,
} from '../db/user-management';
import {
  USER_MANAGEMENT_ACCESS_DENIED,
  USER_MANAGEMENT_AUTH_REQUIRED,
  createUserManagementHandlers,
} from '../lib/user-management-api';
import { memoryPostgres } from './helpers/pglite';
import { input } from './helpers/contract';

const adminId = '10000000-0000-4000-8000-000000000001';
const engineerId = '20000000-0000-4000-8000-000000000002';
const secondAdminId = '70000000-0000-4000-8000-000000000007';

type Operations = Parameters<typeof createUserManagementHandlers>[0];

function request(method = 'GET', body?: unknown, origin = 'http://localhost') {
  return new Request('http://localhost/api/admin/users', {
    method,
    headers: {
      Host: 'localhost',
      Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function addUser(
  db: Database,
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    disabled?: boolean;
    password?: string;
  },
) {
  await db.query(
    `INSERT INTO auth_users
      (id, name, email, email_verified, created_at, updated_at, role, banned)
     VALUES ($1, $2, $3, false, now(), now(), $4, $5)`,
    [user.id, user.name, user.email, user.role, user.disabled ?? false],
  );
  if (user.password !== undefined) {
    await db.query(
      `INSERT INTO auth_accounts
        (id, account_id, provider_id, user_id, password, created_at, updated_at)
       VALUES ($1, $2, 'credential', $3, $4, now(), now())`,
      [randomUUID(), user.id, user.id, user.password],
    );
  }
}

async function addSession(db: Database, userId: string) {
  await db.query(
    `INSERT INTO auth_sessions
      (id, expires_at, token, created_at, updated_at, user_id)
     VALUES ($1, now() + interval '1 hour', $2, now(), now(), $3)`,
    [randomUUID(), randomUUID(), userId],
  );
}

function deterministicService(db: Database) {
  const ids = [
    '30000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000004',
    '50000000-0000-4000-8000-000000000005',
    '60000000-0000-4000-8000-000000000006',
  ];
  return createUserManagementService(db, {
    hashPassword: async (password) => `test-hash:${password}`,
    randomUUID: () => ids.shift() ?? randomUUID(),
  });
}

test('user-management API rejects anonymous and engineer requests before storage', async () => {
  let calls = 0;
  const operations: Operations = {
    async listUsers() { calls += 1; return []; },
    async createUser() { calls += 1; throw new Error('not expected'); },
    async updateProfile() { calls += 1; throw new Error('not expected'); },
    async resetPassword() { calls += 1; throw new Error('not expected'); },
    async setDisabled() { calls += 1; throw new Error('not expected'); },
  };
  const anonymous = createUserManagementHandlers(operations, async () => null);
  const unauthenticated = await anonymous.GET(request());
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), { error: USER_MANAGEMENT_AUTH_REQUIRED });

  const engineer = createUserManagementHandlers(
    operations,
    async () => ({ id: engineerId, role: 'engineer' }),
  );
  const forbidden = await engineer.POST(request('POST', {}));
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { error: USER_MANAGEMENT_ACCESS_DENIED });
  assert.equal(calls, 0);
});

test('user-management API returns safe no-store summaries and validates create requests', async () => {
  const safeUser = {
    id: adminId,
    name: 'Admin Person',
    email: 'admin@example.test',
    role: 'admin' as const,
    disabled: false,
    createdAt: '2026-09-21T00:00:00.000Z',
  };
  let creates = 0;
  const operations: Operations = {
    async listUsers() { return [safeUser]; },
    async createUser() { creates += 1; return safeUser; },
    async updateProfile() { return { user: safeUser, signOutCurrent: false }; },
    async resetPassword() { return { user: safeUser, signOutCurrent: false }; },
    async setDisabled() { return { user: safeUser, signOutCurrent: false }; },
  };
  const api = createUserManagementHandlers(
    operations,
    async () => ({ id: adminId, role: 'admin' }),
  );
  const listed = await api.GET(request());
  assert.equal(listed.status, 200);
  assert.match(listed.headers.get('cache-control') ?? '', /private, no-store/);
  const listBody = await listed.json() as { users: Array<Record<string, unknown>> };
  assert.deepEqual(Object.keys(listBody.users[0]).sort(), ['createdAt', 'disabled', 'email', 'id', 'name', 'role']);
  assert.doesNotMatch(JSON.stringify(listBody), /password|token|session/i);

  const invalid = await api.POST(request('POST', {
    name: 'Test User', email: 'not-an-email', role: 'owner',
    password: 'short', passwordConfirmation: 'different',
  }));
  assert.equal(invalid.status, 400);
  assert.equal(creates, 0);
  const crossOrigin = await api.POST(request('POST', {}, 'https://attacker.example'));
  assert.equal(crossOrigin.status, 403);
  const nonJson = await api.POST(new Request('http://localhost/api/admin/users', {
    method: 'POST',
    headers: { Host: 'localhost', Origin: 'http://localhost', 'Content-Type': 'text/plain' },
    body: '{}',
  }));
  assert.equal(nonJson.status, 415);
  const invalidId = await api.PATCH(request('PATCH', {
    action: 'status', id: 'not-a-uuid', disabled: true,
  }));
  assert.equal(invalidId.status, 400);
});

test('user service rejects duplicate normalized email and display names', async () => {
  const { db, close } = memoryPostgres();
  try {
    await migrate(db);
    const service = deterministicService(db);
    await service.createUser({
      name: 'Asha Nair', email: 'asha@example.test', role: 'engineer', password: 'LongPassword12!',
    });
    const summaries = await service.listUsers();
    assert.deepEqual(Object.keys(summaries[0]).sort(), ['createdAt', 'disabled', 'email', 'id', 'name', 'role']);
    assert.doesNotMatch(JSON.stringify(summaries), /password|token|session/i);
    await assert.rejects(
      service.createUser({ name: 'Different Name', email: 'ASHA@example.test', role: 'engineer', password: 'LongPassword12!' }),
      (error: unknown) => error instanceof UserManagementError && error.status === 409 && /email/.test(error.message),
    );
    await assert.rejects(
      service.createUser({ name: 'asha nair', email: 'other@example.test', role: 'admin', password: 'LongPassword12!' }),
      (error: unknown) => error instanceof UserManagementError && error.status === 409 && /display name/.test(error.message),
    );
  } finally {
    await close();
  }
});

test('profile rename atomically migrates exact work references and revokes sessions', async () => {
  const { db, close } = memoryPostgres();
  try {
    await migrate(db);
    await addUser(db, { id: engineerId, name: 'Old Name', email: 'old@example.test', role: 'engineer' });
    await addUser(db, { id: adminId, name: 'Admin Person', email: 'admin@example.test', role: 'admin' });
    await addSession(db, engineerId);
    const repository = createWorkItemRepository(db);
    const item = await repository.insertWorkItem({
      ...input,
      owner: 'Old Name',
      createdBy: 'Old Name',
      purpose: 'Old Name remains in descriptive text.',
      checklist: [
        { title: 'Owned action', assignee: 'Old Name' },
        { title: 'Unrelated action', assignee: 'Old Name Extended' },
      ],
    });
    const service = deterministicService(db);
    const result = await service.updateProfile({
      action: 'profile', id: engineerId, name: 'New Name', email: 'new@example.test', role: 'engineer',
    }, adminId);
    assert.equal(result.signOutCurrent, false);
    const renamed = await repository.getWorkItem(item.id);
    assert.equal(renamed?.owner, 'New Name');
    assert.equal(renamed?.createdBy, 'New Name');
    assert.equal(renamed?.checklist[0].assignee, 'New Name');
    assert.equal(renamed?.checklist[1].assignee, 'Old Name Extended');
    assert.equal(renamed?.purpose, 'Old Name remains in descriptive text.');
    assert.equal((await db.query('SELECT id FROM auth_sessions WHERE user_id = $1', [engineerId])).rows.length, 0);
  } finally {
    await close();
  }
});

test('password reset stores a Better Auth scrypt hash, reveals none, and revokes sessions', async () => {
  const { db, close } = memoryPostgres();
  try {
    await migrate(db);
    const service = createUserManagementService(db);
    const initialPassword = 'Initial secure password 19!';
    const created = await service.createUser({
      name: 'Admin Person', email: 'admin@example.test', role: 'admin', password: initialPassword,
    });
    const initialAccount = await db.query<{ password: string; account_id: string }>(
      "SELECT password, account_id FROM auth_accounts WHERE user_id = $1 AND provider_id = 'credential'",
      [created.id],
    );
    assert.equal(initialAccount.rows[0].account_id, created.id);
    assert.equal(await verifyPassword({ hash: initialAccount.rows[0].password, password: initialPassword }), true);

    await addSession(db, created.id);
    const password = 'New secure password 42!';
    const result = await service.resetPassword({ action: 'password', id: created.id, password }, created.id);
    assert.equal(result.signOutCurrent, true);
    assert.doesNotMatch(JSON.stringify(result), /password|placeholder|secure password/i);
    const account = await db.query<{ password: string }>(
      "SELECT password FROM auth_accounts WHERE user_id = $1 AND provider_id = 'credential'",
      [created.id],
    );
    assert.notEqual(account.rows[0].password, password);
    assert.equal(await verifyPassword({ hash: account.rows[0].password, password }), true);
    assert.equal((await db.query('SELECT id FROM auth_sessions WHERE user_id = $1', [created.id])).rows.length, 0);
  } finally {
    await close();
  }
});

test('self-disable and last-active-admin protections fail closed while ordinary disable revokes sessions', async () => {
  const { db, close } = memoryPostgres();
  try {
    await migrate(db);
    await addUser(db, { id: adminId, name: 'Only Admin', email: 'admin@example.test', role: 'admin' });
    await addUser(db, { id: engineerId, name: 'Engineer Person', email: 'engineer@example.test', role: 'engineer' });
    await addSession(db, engineerId);
    const service = deterministicService(db);
    await assert.rejects(
      service.setDisabled({ action: 'status', id: adminId, disabled: true }, adminId),
      /cannot disable your own account/i,
    );
    await assert.rejects(
      service.setDisabled({ action: 'status', id: adminId, disabled: true }, engineerId),
      /last active administrator/i,
    );
    await assert.rejects(
      service.updateProfile({ action: 'profile', id: adminId, name: 'Only Admin', email: 'admin@example.test', role: 'engineer' }, adminId),
      /last active administrator/i,
    );
    const disabled = await service.setDisabled({ action: 'status', id: engineerId, disabled: true }, adminId);
    assert.equal(disabled.user.disabled, true);
    assert.equal((await db.query('SELECT id FROM auth_sessions WHERE user_id = $1', [engineerId])).rows.length, 0);
    const enabled = await service.setDisabled({ action: 'status', id: engineerId, disabled: false }, adminId);
    assert.equal(enabled.user.disabled, false);
    assert.equal((await db.query('SELECT id FROM auth_sessions WHERE user_id = $1', [engineerId])).rows.length, 0);

    await addUser(db, { id: secondAdminId, name: 'Second Admin', email: 'second@example.test', role: 'admin' });
    await addSession(db, adminId);
    const demoted = await service.updateProfile({
      action: 'profile', id: adminId, name: 'Only Admin', email: 'admin@example.test', role: 'engineer',
    }, adminId);
    assert.equal(demoted.signOutCurrent, true);
    assert.equal(demoted.user.role, 'engineer');
    assert.equal((await db.query('SELECT id FROM auth_sessions WHERE user_id = $1', [adminId])).rows.length, 0);
  } finally {
    await close();
  }
});
