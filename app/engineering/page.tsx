import type { Metadata } from 'next';
import { listActiveUserNames } from '../../db/auth-users';
import { requireIdentity } from '../../lib/auth-session';
import EngineeringWorkspace from './engineering-workspace';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Engineering',
  description: 'Create work items, own results, and complete assigned actions.',
};

export default async function EngineeringPage() {
  const identity = await requireIdentity('/engineering');
  const activeUserNames = await listActiveUserNames();
  return <EngineeringWorkspace currentUserName={identity.name} activeUserNames={activeUserNames} canManage={identity.role === 'admin'} />;
}
