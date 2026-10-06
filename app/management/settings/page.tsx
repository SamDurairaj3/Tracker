import type { Metadata } from 'next';
import { requireAdmin } from '../../../lib/auth-session';
import TeamSettings from './team-settings';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Dropdown settings',
  description: 'Manage the controlled lists used by Tracker work cards.',
};

export default async function SettingsPage() {
  const identity = await requireAdmin('/management/settings');
  return <TeamSettings currentUserName={identity.name} />;
}
