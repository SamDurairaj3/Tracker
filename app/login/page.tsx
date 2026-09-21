import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentIdentity } from '../../lib/auth-session';
import { safeNextPath } from '../../lib/auth-config';
import LoginForm from './login-form';
import styles from './login.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to the invite-only Vector Work workspace.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;
  const identity = await currentIdentity();
  if (identity) redirect(safeNextPath(next, identity.role));

  return (
    <main className={styles.page}>
      <section className={styles.story}>
        <span className={styles.mark}>V</span>
        <p className={styles.eyebrow}>Vector Work · Cosmicport</p>
        <h1>Engineering work, aligned.</h1>
        <p>
          One shared view for accountable outcomes, coordinated actions, and
          delivery decisions.
        </p>
        <div className={styles.signal}><i /> Private pilot workspace</div>
      </section>
      <section className={styles.panel} aria-labelledby="login-title">
        <div>
          <p className={styles.eyebrow}>Invite only</p>
          <h2 id="login-title">Welcome back</h2>
          <p>Use the account provided by your Tracker administrator.</p>
        </div>
        {reason === 'account-updated' ? (
          <p className={styles.notice} role="status">
            Your account was updated and its sessions were revoked. Sign in again with the current credentials.
          </p>
        ) : null}
        <LoginForm nextPath={next === '/mobile' || next === '/management' ||
          next === '/management/users' || next === '/engineering' ? next : '/'} />
        <p className={styles.help}>
          Need access or a password reset? Contact an administrator. Email recovery
          is not enabled for this pilot.
        </p>
      </section>
    </main>
  );
}
