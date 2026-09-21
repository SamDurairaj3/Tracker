import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { Database, Queryable } from './database';
import { database } from './postgres';
import { AUTH_ROLES, parseAuthRole, type AuthRole } from '../lib/auth-config';

export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: AuthRole | null;
  disabled: boolean;
  createdAt: string;
};

export type CreateManagedUserInput = {
  name: string;
  email: string;
  role: AuthRole;
  password: string;
};

export type ManagedUserMutation =
  | { action: 'profile'; id: string; name: string; email: string; role: AuthRole }
  | { action: 'password'; id: string; password: string }
  | { action: 'status'; id: string; disabled: boolean };

export type ManagedUserMutationResult = {
  user: ManagedUser;
  signOutCurrent: boolean;
};

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  banned: boolean | null;
  created_at: Date | string;
};

type ServiceDependencies = {
  hashPassword: (password: string) => Promise<string>;
  randomUUID: () => string;
};

export class UserManagementError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'UserManagementError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function invalid(message: string): never {
  throw new UserManagementError(message, 400);
}

function conflict(message: string): never {
  throw new UserManagementError(message, 409);
}

function record(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('A valid JSON object is required.');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    invalid('The request contains unsupported fields.');
  }
}

export function normalizeManagedEmail(value: unknown) {
  if (typeof value !== 'string') invalid('A valid email address is required.');
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    invalid('A valid email address is required.');
  }
  return email;
}

export function normalizeManagedName(value: unknown) {
  if (typeof value !== 'string') invalid('A display name is required.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 120) {
    invalid('Display name must be between 1 and 120 characters.');
  }
  return name;
}

function managedRole(value: unknown) {
  if (typeof value !== 'string' || !AUTH_ROLES.includes(value as AuthRole)) {
    invalid('Role must be admin or engineer.');
  }
  return value as AuthRole;
}

function managedPassword(password: unknown, confirmation: unknown) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    invalid('Password must be between 12 and 128 characters.');
  }
  if (password !== confirmation) invalid('Password confirmation does not match.');
  return password;
}

function managedId(value: unknown) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalid('A valid user ID is required.');
  return value;
}

export function parseCreateManagedUser(value: unknown): CreateManagedUserInput {
  const input = record(value);
  exactKeys(input, ['name', 'email', 'role', 'password', 'passwordConfirmation']);
  return {
    name: normalizeManagedName(input.name),
    email: normalizeManagedEmail(input.email),
    role: managedRole(input.role),
    password: managedPassword(input.password, input.passwordConfirmation),
  };
}

export function parseManagedUserMutation(value: unknown): ManagedUserMutation {
  const input = record(value);
  if (input.action === 'profile') {
    exactKeys(input, ['action', 'id', 'name', 'email', 'role']);
    return {
      action: 'profile',
      id: managedId(input.id),
      name: normalizeManagedName(input.name),
      email: normalizeManagedEmail(input.email),
      role: managedRole(input.role),
    };
  }
  if (input.action === 'password') {
    exactKeys(input, ['action', 'id', 'password', 'passwordConfirmation']);
    return {
      action: 'password',
      id: managedId(input.id),
      password: managedPassword(input.password, input.passwordConfirmation),
    };
  }
  if (input.action === 'status') {
    exactKeys(input, ['action', 'id', 'disabled']);
    if (typeof input.disabled !== 'boolean') invalid('Account status must be enabled or disabled.');
    return { action: 'status', id: managedId(input.id), disabled: input.disabled };
  }
  invalid('A supported user-management action is required.');
}

function safeUser(row: UserRow): ManagedUser {
  const createdAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: parseAuthRole(row.role),
    disabled: row.banned === true,
    createdAt: Number.isNaN(createdAt.valueOf()) ? String(row.created_at) : createdAt.toISOString(),
  };
}

async function lockUsers(client: Queryable) {
  await client.query('LOCK TABLE auth_users IN SHARE ROW EXCLUSIVE MODE');
}

async function readUser(client: Queryable, id: string) {
  const { rows } = await client.query<UserRow>(
    `SELECT id, name, email, role, banned, created_at
       FROM auth_users WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!rows[0]) throw new UserManagementError('User account not found.', 404);
  return rows[0];
}

async function assertUniqueIdentity(
  client: Queryable,
  email: string,
  name: string,
  excludedId: string | null = null,
) {
  const emailMatch = await client.query<{ id: string }>(
    `SELECT id FROM auth_users
      WHERE lower(email) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid)
      LIMIT 1`,
    [email, excludedId],
  );
  if (emailMatch.rows[0]) conflict('An account with that email address already exists.');
  const nameMatch = await client.query<{ id: string }>(
    `SELECT id FROM auth_users
      WHERE lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) = lower($1)
        AND ($2::uuid IS NULL OR id <> $2::uuid)
      LIMIT 1`,
    [name, excludedId],
  );
  if (nameMatch.rows[0]) conflict('An account with that display name already exists.');
}

async function activeAdminCount(client: Queryable) {
  const { rows } = await client.query<{ role: string | null }>(
    'SELECT role FROM auth_users WHERE banned IS NOT TRUE',
  );
  return rows.filter((row) => parseAuthRole(row.role) === 'admin').length;
}

function translateUniqueViolation(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
    conflict('An account with that email address already exists.');
  }
  throw error;
}

export function createUserManagementService(
  db: Database,
  dependencies: ServiceDependencies = { hashPassword, randomUUID },
) {
  return {
    async listUsers() {
      return db.transaction(async (client) => {
        const { rows } = await client.query<UserRow>(
          `SELECT id, name, email, role, banned, created_at
             FROM auth_users ORDER BY lower(name), lower(email), id`,
        );
        return rows.map(safeUser);
      }, { readOnly: true });
    },

    async createUser(input: CreateManagedUserInput) {
      const passwordHash = await dependencies.hashPassword(input.password);
      try {
        return await db.transaction(async (client) => {
          await lockUsers(client);
          await assertUniqueIdentity(client, input.email, input.name);
          const id = dependencies.randomUUID();
          const accountId = dependencies.randomUUID();
          const { rows } = await client.query<UserRow>(
            `INSERT INTO auth_users
              (id, name, email, email_verified, created_at, updated_at, role, banned)
             VALUES ($1, $2, $3, false, now(), now(), $4, false)
             RETURNING id, name, email, role, banned, created_at`,
            [id, input.name, input.email, input.role],
          );
          await client.query(
            `INSERT INTO auth_accounts
              (id, account_id, provider_id, user_id, password, created_at, updated_at)
             VALUES ($1, $2, 'credential', $3, $4, now(), now())`,
            [accountId, id, id, passwordHash],
          );
          return safeUser(rows[0]);
        });
      } catch (error) {
        return translateUniqueViolation(error);
      }
    },

    async updateProfile(
      input: Extract<ManagedUserMutation, { action: 'profile' }>,
      actorId: string,
    ): Promise<ManagedUserMutationResult> {
      try {
        return await db.transaction(async (client) => {
          await lockUsers(client);
          const current = await readUser(client, input.id);
          await assertUniqueIdentity(client, input.email, input.name, input.id);
          const currentRole = parseAuthRole(current.role);
          if (
            current.banned !== true &&
            currentRole === 'admin' &&
            input.role !== 'admin' &&
            await activeAdminCount(client) <= 1
          ) {
            conflict('The last active administrator cannot be demoted.');
          }
          const changed = current.name !== input.name || current.email !== input.email || currentRole !== input.role;
          if (!changed) return { user: safeUser(current), signOutCurrent: false };
          const { rows } = await client.query<UserRow>(
            `UPDATE auth_users
                SET name = $1, email = $2, role = $3, updated_at = now()
              WHERE id = $4
              RETURNING id, name, email, role, banned, created_at`,
            [input.name, input.email, input.role, input.id],
          );
          if (current.name !== input.name) {
            await client.query('UPDATE work_items SET owner = $1 WHERE owner = $2', [input.name, current.name]);
            await client.query('UPDATE work_items SET created_by = $1 WHERE created_by = $2', [input.name, current.name]);
            await client.query('UPDATE checklist_steps SET assignee = $1 WHERE assignee = $2', [input.name, current.name]);
          }
          await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [input.id]);
          return { user: safeUser(rows[0]), signOutCurrent: input.id === actorId };
        });
      } catch (error) {
        return translateUniqueViolation(error);
      }
    },

    async resetPassword(
      input: Extract<ManagedUserMutation, { action: 'password' }>,
      actorId: string,
    ): Promise<ManagedUserMutationResult> {
      const passwordHash = await dependencies.hashPassword(input.password);
      return db.transaction(async (client) => {
        await lockUsers(client);
        const current = await readUser(client, input.id);
        const credential = await client.query<{ id: string }>(
          "SELECT id FROM auth_accounts WHERE user_id = $1 AND provider_id = 'credential' LIMIT 1 FOR UPDATE",
          [input.id],
        );
        if (credential.rows[0]) {
          await client.query(
            'UPDATE auth_accounts SET password = $1, updated_at = now() WHERE id = $2',
            [passwordHash, credential.rows[0].id],
          );
        } else {
          await client.query(
            `INSERT INTO auth_accounts
              (id, account_id, provider_id, user_id, password, created_at, updated_at)
             VALUES ($1, $2, 'credential', $3, $4, now(), now())`,
            [dependencies.randomUUID(), input.id, input.id, passwordHash],
          );
        }
        await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [input.id]);
        return { user: safeUser(current), signOutCurrent: input.id === actorId };
      });
    },

    async setDisabled(
      input: Extract<ManagedUserMutation, { action: 'status' }>,
      actorId: string,
    ): Promise<ManagedUserMutationResult> {
      return db.transaction(async (client) => {
        await lockUsers(client);
        const current = await readUser(client, input.id);
        if (input.disabled && input.id === actorId) conflict('You cannot disable your own account.');
        if (
          input.disabled &&
          current.banned !== true &&
          parseAuthRole(current.role) === 'admin' &&
          await activeAdminCount(client) <= 1
        ) {
          conflict('The last active administrator cannot be disabled.');
        }
        const { rows } = await client.query<UserRow>(
          `UPDATE auth_users
              SET banned = $1, ban_reason = $2, ban_expires = NULL, updated_at = now()
            WHERE id = $3
            RETURNING id, name, email, role, banned, created_at`,
          [input.disabled, input.disabled ? 'Disabled through user management' : null, input.id],
        );
        if (input.disabled) {
          await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [input.id]);
        }
        return { user: safeUser(rows[0]), signOutCurrent: false };
      });
    },
  };
}

function service() {
  return createUserManagementService(database());
}

export const userManagementService = {
  listUsers: () => service().listUsers(),
  createUser: (input: CreateManagedUserInput) => service().createUser(input),
  updateProfile: (input: Extract<ManagedUserMutation, { action: 'profile' }>, actorId: string) => service().updateProfile(input, actorId),
  resetPassword: (input: Extract<ManagedUserMutation, { action: 'password' }>, actorId: string) => service().resetPassword(input, actorId),
  setDisabled: (input: Extract<ManagedUserMutation, { action: 'status' }>, actorId: string) => service().setDisabled(input, actorId),
};
