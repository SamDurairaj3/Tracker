import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from './auth';
import {
  isAdmin,
  parseAuthRole,
  type AuthIdentity,
} from './auth-config';

export async function identityFromHeaders(requestHeaders: Headers) {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const role = parseAuthRole(session.user.role);
  if (!role) return null;
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role,
  } satisfies AuthIdentity;
}

export async function currentIdentity() {
  return identityFromHeaders(await headers());
}

export async function requireIdentity(path: string) {
  const identity = await currentIdentity();
  if (!identity) redirect(`/login?next=${encodeURIComponent(path)}`);
  return identity;
}

export async function requireAdmin(path: string) {
  const identity = await requireIdentity(path);
  if (!isAdmin(identity)) redirect('/engineering');
  return identity;
}
