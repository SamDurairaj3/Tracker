import type { Queryable } from './database';
import { database } from './postgres';
import { parseAuthRole } from '../lib/auth-config';

type ActiveUserRow = {
  name: unknown;
  role: unknown;
  banned: unknown;
};

const personNameSort = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});

export async function listActiveUserNames(client: Queryable = database()) {
  const { rows } = await client.query<ActiveUserRow>(
    `SELECT name, role, banned
       FROM auth_users
      WHERE banned IS NOT TRUE`,
  );
  const names = new Map<string, string>();

  for (const row of rows) {
    if (row.banned === true || !parseAuthRole(row.role) || typeof row.name !== 'string') continue;
    const name = row.name.trim().replace(/\s+/g, ' ');
    const key = name.toLocaleLowerCase('en-US');
    if (name && !names.has(key)) names.set(key, name);
  }

  return [...names.values()].sort((left, right) => (
    personNameSort.compare(left, right) || left.localeCompare(right, 'en')
  ));
}
