import type { Metadata } from 'next';
import { listActiveUserNames } from '../../db/auth-users';
import { listActiveTeamNames } from '../../db/team-settings';
import { requireAdmin } from '../../lib/auth-session';
import ManagementDashboard from './management-dashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Management',
  description:
    'Organization-wide work visibility, Kanban flow, and delivery scheduling.',
};

export default async function ManagementPage() {
  const identity = await requireAdmin('/management');
  const [activeUserNames, teamNames] = await Promise.all([
    listActiveUserNames(),
    listActiveTeamNames(),
  ]);
  return <ManagementDashboard currentUserName={identity.name} activeUserNames={activeUserNames} teamNames={teamNames} />;
}
