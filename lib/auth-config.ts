import { readFileSync } from 'node:fs';

export const AUTH_ROLES = ['admin', 'engineer'] as const;
export type AuthRole = (typeof AUTH_ROLES)[number];

export type AuthIdentity = {
  id: string;
  name: string;
  email: string;
  role: AuthRole;
};

export const AUTH_ALLOWED_HOSTS = [
  'localhost:*',
  '127.0.0.1:*',
  '*.trycloudflare.com',
] as const;

export function readAuthSecret(
  environment: Record<string, string | undefined> = process.env,
) {
  if (environment.BETTER_AUTH_SECRET) {
    throw new Error(
      'BETTER_AUTH_SECRET must not be placed in the environment; use BETTER_AUTH_SECRET_FILE.',
    );
  }
  const path = environment.BETTER_AUTH_SECRET_FILE;
  if (!path) {
    throw new Error('BETTER_AUTH_SECRET_FILE is required.');
  }
  const raw = readFileSync(path, 'utf8');
  const secret = raw.replace(/\r?\n$/, '');
  if (!secret || /[\r\n]/.test(secret)) {
    throw new Error('BETTER_AUTH_SECRET_FILE must contain exactly one nonempty line.');
  }
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('BETTER_AUTH_SECRET_FILE must contain at least 32 bytes of high-entropy data.');
  }
  return secret;
}

export function parseAuthRole(role: unknown): AuthRole | null {
  if (typeof role !== 'string') return null;
  const roles = role.split(',').map((entry) => entry.trim());
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('engineer')) return 'engineer';
  return null;
}

export function isAdmin(identity: Pick<AuthIdentity, 'role'>) {
  return identity.role === 'admin';
}

export function safeNextPath(value: string | null | undefined, role: AuthRole) {
  const fallback = role === 'admin' ? '/management' : '/engineering';
  return value === '/management' || value === '/engineering' || value === '/mobile'
    ? value
    : fallback;
}
