'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '../../lib/auth-client';

export default function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    try {
      setSigningOut(true);
      await authClient.signOut();
      router.replace('/login');
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <button
      className={className}
      type="button"
      aria-label="Sign out of Tracker"
      aria-busy={signingOut}
      disabled={signingOut}
      onClick={() => void signOut()}
    >
      {signingOut ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
