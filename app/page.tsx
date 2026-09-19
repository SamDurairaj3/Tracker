import { redirect } from 'next/navigation';
import { currentIdentity } from '../lib/auth-session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function Home() {
  const identity = await currentIdentity();
  if (!identity) redirect('/login');
  redirect(identity.role === 'admin' ? '/management' : '/engineering');
}
