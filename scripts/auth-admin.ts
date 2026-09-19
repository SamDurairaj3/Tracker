import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { hashPassword } from 'better-auth/crypto';
import type { Queryable } from '../db/database';
import { closeDatabase, database } from '../db/postgres';
import { createProvisioningAuth, getAuth } from '../lib/auth';
import { AUTH_ROLES, type AuthRole } from '../lib/auth-config';

type Command = 'create' | 'list' | 'disable' | 'enable' | 'reset-password' | 'verify-login';
type Parsed = {
  command: Command;
  email?: string;
  name?: string;
  role?: AuthRole;
};

const usage = `Usage:
  pnpm auth:admin -- create --email ADDRESS --name NAME --role admin|engineer
  pnpm auth:admin -- list
  pnpm auth:admin -- disable --email ADDRESS
  pnpm auth:admin -- enable --email ADDRESS
  pnpm auth:admin -- reset-password --email ADDRESS
  pnpm auth:admin -- verify-login --email ADDRESS

create and reset-password read the password twice from stdin.
verify-login reads it once. Password command-line arguments are refused.`;

export function parseAuthAdminArgs(args: string[]): Parsed {
  if (args.some((value) => value === '--password' || value.startsWith('--password='))) {
    throw new Error('Passwords must be supplied through stdin, never command-line arguments.');
  }
  const command = args[0] as Command | undefined;
  if (!command || !['create', 'list', 'disable', 'enable', 'reset-password', 'verify-login'].includes(command)) {
    throw new Error(usage);
  }
  const options = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error(usage);
    if (!['--email', '--name', '--role'].includes(key) || options.has(key)) throw new Error(usage);
    options.set(key, value);
  }
  if (command === 'list') {
    if (options.size) throw new Error(usage);
    return { command };
  }
  const email = options.get('--email')?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid --email address is required.');
  }
  if (command === 'create') {
    const name = options.get('--name')?.trim();
    const role = options.get('--role') as AuthRole | undefined;
    if (!name || name.length > 120) throw new Error('A display name between 1 and 120 characters is required.');
    if (!role || !AUTH_ROLES.includes(role)) throw new Error('--role must be admin or engineer.');
    if (options.size !== 3) throw new Error(usage);
    return { command, email, name, role };
  }
  if (options.size !== 1) throw new Error(usage);
  return { command, email };
}

function validatePassword(password: string) {
  if (password.length < 12 || password.length > 128) {
    throw new Error('Password must be between 12 and 128 characters.');
  }
}

async function readHiddenLine(prompt: string) {
  const input = process.stdin;
  const output = process.stderr;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('Interactive password input requires a TTY.');
  }
  output.write(prompt);
  input.setEncoding('utf8');
  input.setRawMode(true);
  input.resume();
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const finish = () => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
    };
    const onData = (chunk: string | Buffer) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') {
          finish();
          reject(new Error('Password input cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };
    input.on('data', onData);
  });
}

async function readPassword(confirm: boolean) {
  let values: string[];
  if (process.stdin.isTTY) {
    values = [await readHiddenLine('Password: ')];
    if (confirm) values.push(await readHiddenLine('Confirm password: '));
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8').replaceAll('\r', '');
    values = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  }
  const expected = confirm ? 2 : 1;
  if (values.length !== expected || values.some((value) => !value)) {
    throw new Error(`Expected exactly ${expected} nonempty password line${expected === 1 ? '' : 's'} on stdin.`);
  }
  if (confirm && values[0] !== values[1]) throw new Error('Password confirmation does not match.');
  validatePassword(values[0]);
  return values[0];
}

async function findUser(email: string, client: Queryable = database()) {
  const result = await client.query<{
    id: string;
    email: string;
    name: string;
    role: string | null;
    banned: boolean | null;
  }>(
    'SELECT id, email, name, role, banned FROM auth_users WHERE lower(email) = lower($1)',
    [email],
  );
  if (!result.rows[0]) throw new Error('No user exists with that email address.');
  return result.rows[0];
}

async function createUser(parsed: Parsed) {
  const password = await readPassword(true);
  const result = await createProvisioningAuth().api.createUser({
    body: {
      email: parsed.email!,
      password,
      name: parsed.name!,
      role: parsed.role!,
    },
  });
  process.stdout.write(`Created ${result.user.email} as ${result.user.role}.\n`);
}

async function listUsers() {
  const { rows } = await database().query<{
    id: string;
    email: string;
    name: string;
    role: string | null;
    banned: boolean | null;
  }>('SELECT id, email, name, role, banned FROM auth_users ORDER BY email');
  if (!rows.length) {
    process.stdout.write('No users found.\n');
    return;
  }
  console.table(rows.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role ?? 'engineer',
    status: user.banned ? 'disabled' : 'active',
  })));
}

async function setDisabled(email: string, disabled: boolean) {
  await database().transaction(async (client) => {
    const user = await findUser(email, client);
    if (disabled && user.role?.split(',').includes('admin')) {
      const { rows } = await client.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM auth_users WHERE role LIKE '%admin%' AND banned IS NOT TRUE",
      );
      if (rows[0].count <= 1) throw new Error('Refusing to disable the last active administrator.');
    }
    await client.query(
      `UPDATE auth_users
       SET banned = $1, ban_reason = $2, ban_expires = NULL, updated_at = now()
       WHERE id = $3`,
      [disabled, disabled ? 'Disabled by local provisioning CLI' : null, user.id],
    );
    if (disabled) await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [user.id]);
  });
  process.stdout.write(`${disabled ? 'Disabled' : 'Enabled'} ${email}.\n`);
}

async function resetPassword(email: string) {
  const password = await readPassword(true);
  const passwordHash = await hashPassword(password);
  await database().transaction(async (client) => {
    const user = await findUser(email, client);
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM auth_accounts WHERE user_id = $1 AND provider_id = 'credential' LIMIT 1 FOR UPDATE",
      [user.id],
    );
    if (rows[0]) {
      await client.query(
        'UPDATE auth_accounts SET password = $1, updated_at = now() WHERE id = $2',
        [passwordHash, rows[0].id],
      );
    } else {
      await client.query(
        `INSERT INTO auth_accounts
          (id, account_id, provider_id, user_id, password, created_at, updated_at)
         VALUES ($1, $2, 'credential', $2, $3, now(), now())`,
        [randomUUID(), user.id, passwordHash],
      );
    }
    await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [user.id]);
  });
  process.stdout.write(`Reset password and revoked sessions for ${email}.\n`);
}

function cookieHeader(response: Response) {
  const values = response.headers.getSetCookie();
  return values.map((value) => value.split(';', 1)[0]).join('; ');
}

async function verifyLogin(email: string) {
  const password = await readPassword(false);
  const requestHeaders = {
    'Content-Type': 'application/json',
    Origin: 'http://localhost:5173',
    Host: 'localhost:5173',
    'cf-connecting-ip': '127.0.0.1',
  };
  const response = await getAuth().handler(new Request(
    'http://localhost:5173/api/auth/sign-in/email',
    { method: 'POST', headers: requestHeaders, body: JSON.stringify({ email, password }) },
  ));
  if (!response.ok) throw new Error('Login verification failed.');
  const cookie = cookieHeader(response);
  if (!cookie) throw new Error('Login verification did not issue a session cookie.');
  const sessionResponse = await getAuth().handler(new Request(
    'http://localhost:5173/api/auth/get-session',
    { headers: { ...requestHeaders, Cookie: cookie } },
  ));
  const session = await sessionResponse.json() as { user?: { email?: string } } | null;
  if (!sessionResponse.ok || session?.user?.email?.toLowerCase() !== email) {
    throw new Error('Login verification did not resolve the expected session.');
  }
  await getAuth().handler(new Request(
    'http://localhost:5173/api/auth/sign-out',
    { method: 'POST', headers: { ...requestHeaders, Cookie: cookie } },
  ));
  process.stdout.write(`Login and session verification passed for ${email}.\n`);
}

export async function runAuthAdmin(args = process.argv.slice(2)) {
  const parsed = parseAuthAdminArgs(args);
  switch (parsed.command) {
    case 'create': await createUser(parsed); break;
    case 'list': await listUsers(); break;
    case 'disable': await setDisabled(parsed.email!, true); break;
    case 'enable': await setDisabled(parsed.email!, false); break;
    case 'reset-password': await resetPassword(parsed.email!); break;
    case 'verify-login': await verifyLogin(parsed.email!); break;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAuthAdmin()
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'Auth administration failed.'}\n`);
      process.exitCode = 1;
    })
    .finally(() => closeDatabase());
}
