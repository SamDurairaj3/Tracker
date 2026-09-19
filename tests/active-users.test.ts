import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listActiveUserNames } from '../db/auth-users';
import type { Queryable } from '../db/database';

test('active user names include only usable invited admins and engineers', async () => {
  let statement = '';
  const rows = [
    { name: 'Vikram Rao', role: 'engineer', banned: false },
    { name: '  Asha   Nair  ', role: 'admin', banned: null },
    { name: 'Banned Engineer', role: 'engineer', banned: true },
    { name: 'Unassigned User', role: 'viewer', banned: false },
    { name: 'asha nair', role: 'engineer', banned: false },
    { name: 'Engineer 10', role: 'engineer,admin', banned: false },
    { name: 'Engineer 2', role: 'engineer', banned: false },
    { name: '   ', role: 'engineer', banned: false },
  ];
  const queryable: Queryable = {
    async query<Row extends object>(sql: string) {
      statement = sql;
      return { rows: rows as unknown as Row[] };
    },
  };

  assert.deepEqual(await listActiveUserNames(queryable), [
    'Asha Nair',
    'Engineer 2',
    'Engineer 10',
    'Vikram Rao',
  ]);
  assert.match(statement, /SELECT name, role, banned\s+FROM auth_users/i);
  assert.match(statement, /WHERE banned IS NOT TRUE/i);
  assert.doesNotMatch(statement, /email|password|session/i);
});
