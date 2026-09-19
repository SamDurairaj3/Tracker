import type { Metadata } from 'next';
import AccountBar from '../components/account-bar';
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
  return <><AccountBar identity={identity} /><ManagementDashboard /></>;
}
