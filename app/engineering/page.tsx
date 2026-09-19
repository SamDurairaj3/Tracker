import type { Metadata } from 'next';
import AccountBar from '../components/account-bar';
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
  return <><AccountBar identity={identity} /><EngineeringWorkspace currentUserName={identity.name} canManage={identity.role === 'admin'} /></>;
}
