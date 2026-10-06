import type { Metadata, Viewport } from 'next';
import { listActiveUserNames } from '../../db/auth-users';
import { listActiveTeamNames } from '../../db/team-settings';
import { requireIdentity } from '../../lib/auth-session';
import MobileWorkspace from './mobile-workspace';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Mobile engineering',
  description: 'Create and track engineering work from the field.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#071713',
};

export default async function MobilePage() {
  const identity = await requireIdentity('/mobile');
  const [activeUserNames, teamNames] = await Promise.all([
    listActiveUserNames(),
    listActiveTeamNames(),
  ]);
  return <MobileWorkspace currentUserName={identity.name} activeUserNames={activeUserNames} teamNames={teamNames} canManage={identity.role === 'admin'} />;
}
