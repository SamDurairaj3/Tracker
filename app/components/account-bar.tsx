'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '../../lib/auth-client';
import type { AuthIdentity } from '../../lib/auth-config';
import styles from './account-bar.module.css';

export default function AccountBar({ identity }: { identity: AuthIdentity }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <aside className={styles.account} aria-label="Signed-in account">
      <span className={styles.avatar} aria-hidden="true">
        {identity.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
      </span>
      <span className={styles.copy}>
        <strong>{identity.name}</strong>
        <small>{identity.role === 'admin' ? 'Administrator' : 'Engineer'}</small>
      </span>
      <button type="button" onClick={() => void signOut()} disabled={signingOut}>
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </aside>
  );
}
