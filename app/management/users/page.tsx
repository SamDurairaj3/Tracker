import type { Metadata } from 'next';
import { requireAdmin } from '../../../lib/auth-session';
import UserManagement from './user-management';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'User management',
  description: 'Manage invited Tracker administrators and engineers.',
};

export default async function UserManagementPage() {
  const identity = await requireAdmin('/management/users');
  return <UserManagement currentUserId={identity.id} currentUserName={identity.name} />;
}
