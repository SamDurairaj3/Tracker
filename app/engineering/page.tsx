import type { Metadata } from 'next';
import { listActiveUserNames } from '../../db/auth-users';
import { listActiveTeamNames } from '../../db/team-settings';
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
  const [activeUserNames, teamNames] = await Promise.all([
    listActiveUserNames(),
    listActiveTeamNames(),
  ]);
  return <EngineeringWorkspace currentUserName={identity.name} activeUserNames={activeUserNames} teamNames={teamNames} canManage={identity.role === 'admin'} />;
}
