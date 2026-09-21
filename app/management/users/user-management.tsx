'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { ManagedUser } from '../../../db/user-management';
import type { AuthRole } from '../../../lib/auth-config';
import styles from './users.module.css';

type Feedback = { tone: 'success' | 'error'; text: string } | null;
type Panel = { kind: 'edit' | 'password' | 'status'; user: ManagedUser } | null;
type MutationResponse = { user: ManagedUser; signOutCurrent: boolean };

const blankCreate = {
  name: '',
  email: '',
  role: 'engineer' as AuthRole,
  password: '',
  passwordConfirmation: '',
};

function sortUsers(users: ManagedUser[]) {
  return [...users].sort((left, right) => (
    left.name.localeCompare(right.name, 'en', { sensitivity: 'base', numeric: true }) ||
    left.email.localeCompare(right.email, 'en', { sensitivity: 'base' })
  ));
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function createdDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? 'Unknown'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

async function apiRequest<T>(method: 'GET' | 'POST' | 'PATCH', body?: unknown) {
  const response = await fetch('/api/admin/users', {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || 'User management is temporarily unavailable.');
  return payload;
}

export default function UserManagement({ currentUserId }: { currentUserId: string }) {
  const router = useRouter();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(blankCreate);
  const [panel, setPanel] = useState<Panel>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', role: 'engineer' as AuthRole });
  const [passwordForm, setPasswordForm] = useState({ password: '', passwordConfirmation: '' });
  const [saving, setSaving] = useState('');

  useEffect(() => {
    let active = true;
    void apiRequest<{ users: ManagedUser[] }>('GET')
      .then((result) => {
        if (!active) return;
        setUsers(sortUsers(result.users));
        setFeedback(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Accounts could not be loaded.' });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!panel) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setPanel(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [panel, saving]);

  const activeCount = users.filter((user) => !user.disabled).length;
  const disabledCount = users.length - activeCount;
  const activeAdminCount = users.filter((user) => !user.disabled && user.role === 'admin').length;
  const visibleUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return users.filter((user) => {
      const statusMatches = statusFilter === 'all' ||
        (statusFilter === 'active' ? !user.disabled : user.disabled);
      const queryMatches = !normalized || [user.name, user.email, user.role ?? 'invalid role']
        .some((value) => value.toLowerCase().includes(normalized));
      return statusMatches && queryMatches;
    });
  }, [query, statusFilter, users]);

  function applyUser(user: ManagedUser) {
    setUsers((current) => sortUsers([
      ...current.filter((candidate) => candidate.id !== user.id),
      user,
    ]));
  }

  function completeMutation(result: MutationResponse, message: string) {
    applyUser(result.user);
    if (result.signOutCurrent) {
      setPanel(null);
      setFeedback({ tone: 'success', text: 'Your account changed. Signing you out so you can authenticate again…' });
      window.setTimeout(() => {
        router.replace('/login?reason=account-updated');
        router.refresh();
      }, 1200);
      return;
    }
    setFeedback({ tone: 'success', text: message });
    setPanel(null);
  }

  async function createAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving('create');
    setFeedback(null);
    try {
      const result = await apiRequest<MutationResponse>('POST', createForm);
      applyUser(result.user);
      setCreateForm(blankCreate);
      setShowCreate(false);
      setFeedback({ tone: 'success', text: `${result.user.name} can now sign in as ${result.user.role}.` });
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'The account could not be created.' });
    } finally {
      setSaving('');
    }
  }

  function openPanel(kind: NonNullable<Panel>['kind'], user: ManagedUser) {
    setFeedback(null);
    setPanel({ kind, user });
    if (kind === 'edit') {
      setEditForm({ name: user.name, email: user.email, role: user.role ?? 'engineer' });
    }
    if (kind === 'password') setPasswordForm({ password: '', passwordConfirmation: '' });
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!panel || panel.kind !== 'edit') return;
    setSaving('profile');
    setFeedback(null);
    try {
      const result = await apiRequest<MutationResponse>('PATCH', {
        action: 'profile', id: panel.user.id, ...editForm,
      });
      completeMutation(result, `${result.user.name}'s profile was updated and existing sessions were revoked.`);
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'The profile could not be updated.' });
    } finally {
      setSaving('');
    }
  }

  async function savePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!panel || panel.kind !== 'password') return;
    setSaving('password');
    setFeedback(null);
    try {
      const result = await apiRequest<MutationResponse>('PATCH', {
        action: 'password', id: panel.user.id, ...passwordForm,
      });
      setPasswordForm({ password: '', passwordConfirmation: '' });
      completeMutation(result, `A new password was set for ${result.user.name}; existing sessions were revoked.`);
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'The password could not be updated.' });
    } finally {
      setSaving('');
    }
  }

  async function saveStatus() {
    if (!panel || panel.kind !== 'status') return;
    const disabled = !panel.user.disabled;
    setSaving('status');
    setFeedback(null);
    try {
      const result = await apiRequest<MutationResponse>('PATCH', {
        action: 'status', id: panel.user.id, disabled,
      });
      completeMutation(
        result,
        disabled
          ? `${result.user.name} was disabled and all sessions were revoked.`
          : `${result.user.name} was re-enabled and can sign in with the current password.`,
      );
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'The account status could not be updated.' });
    } finally {
      setSaving('');
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/management" className={styles.backLink}>← Delivery overview</Link>
          <p className={styles.eyebrow}>Administration / Access control</p>
          <div className={styles.titleRow}>
            <div>
              <h1>User management</h1>
              <p>Invite people, maintain their identity, and control workspace access.</p>
            </div>
            <button type="button" className={styles.primaryButton} onClick={() => setShowCreate((open) => !open)}>
              {showCreate ? 'Close form' : '+ Create account'}
            </button>
          </div>
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.metrics} aria-label="Account summary">
          <article><span>Total accounts</span><strong>{users.length}</strong><small>All invited identities</small></article>
          <article><span>Active</span><strong>{activeCount}</strong><small>Can authenticate</small></article>
          <article><span>Administrators</span><strong>{activeAdminCount}</strong><small>Active admin coverage</small></article>
          <article><span>Disabled</span><strong>{disabledCount}</strong><small>History retained</small></article>
        </section>

        {feedback ? (
          <p className={`${styles.feedback} ${styles[feedback.tone]}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
            {feedback.text}
          </p>
        ) : null}

        {showCreate ? (
          <section className={styles.createCard} aria-labelledby="create-account-title">
            <div className={styles.sectionIntro}>
              <div>
                <p className={styles.eyebrow}>Invite only</p>
                <h2 id="create-account-title">Create an account</h2>
              </div>
              <p>The initial password is transmitted only in this request and is never shown again.</p>
            </div>
            <form className={styles.formGrid} onSubmit={createAccount}>
              <label><span>Display name</span><input required maxLength={120} autoComplete="name" value={createForm.name} onChange={(event) => setCreateForm((form) => ({ ...form, name: event.target.value }))} /></label>
              <label><span>Email address</span><input required type="email" autoComplete="email" value={createForm.email} onChange={(event) => setCreateForm((form) => ({ ...form, email: event.target.value }))} /></label>
              <label><span>Role</span><select value={createForm.role} onChange={(event) => setCreateForm((form) => ({ ...form, role: event.target.value as AuthRole }))}><option value="engineer">Engineer</option><option value="admin">Administrator</option></select></label>
              <label><span>Initial password</span><input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={createForm.password} onChange={(event) => setCreateForm((form) => ({ ...form, password: event.target.value }))} /></label>
              <label><span>Confirm password</span><input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={createForm.passwordConfirmation} onChange={(event) => setCreateForm((form) => ({ ...form, passwordConfirmation: event.target.value }))} /></label>
              <div className={styles.formAction}><button type="submit" disabled={Boolean(saving)}>{saving === 'create' ? 'Creating…' : 'Create invited account'}</button><small>12–128 characters. Share credentials outside Tracker.</small></div>
            </form>
          </section>
        ) : null}

        <section className={styles.directory} aria-labelledby="directory-title">
          <div className={styles.directoryHeader}>
            <div><p className={styles.eyebrow}>Account directory</p><h2 id="directory-title">Invited users</h2></div>
            <div className={styles.filters}>
              <label><span className={styles.srOnly}>Search users</span><input type="search" placeholder="Search name, email, or role" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
              <label><span className={styles.srOnly}>Filter by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">All statuses</option><option value="active">Active</option><option value="disabled">Disabled</option></select></label>
            </div>
          </div>

          {loading ? <p className={styles.empty}>Loading invited accounts…</p> : visibleUsers.length ? (
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Created</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead>
                <tbody>
                  {visibleUsers.map((user) => {
                    const isCurrent = user.id === currentUserId;
                    const lastAdmin = !user.disabled && user.role === 'admin' && activeAdminCount <= 1;
                    return (
                      <tr key={user.id} className={user.disabled ? styles.disabledRow : undefined}>
                        <td><div className={styles.person}><span className={styles.personAvatar}>{initials(user.name)}</span><span><strong>{user.name} {isCurrent ? <em>Current account</em> : null}</strong><small>{user.email}</small></span></div></td>
                        <td><span className={`${styles.role} ${user.role ? styles[user.role] : styles.invalid}`}>{user.role === 'admin' ? 'Administrator' : user.role === 'engineer' ? 'Engineer' : 'Invalid role'}</span></td>
                        <td><span className={`${styles.status} ${user.disabled ? styles.statusDisabled : styles.statusActive}`}><i />{user.disabled ? 'Disabled' : 'Active'}</span></td>
                        <td><time dateTime={user.createdAt}>{createdDate(user.createdAt)}</time></td>
                        <td><div className={styles.actions}><button type="button" onClick={() => openPanel('edit', user)}>Edit</button><button type="button" onClick={() => openPanel('password', user)}>Set password</button><button type="button" className={user.disabled ? styles.enableButton : styles.disableButton} disabled={isCurrent || lastAdmin} title={isCurrent ? 'You cannot disable your own account.' : lastAdmin ? 'The last active administrator cannot be disabled.' : undefined} onClick={() => openPanel('status', user)}>{user.disabled ? 'Re-enable' : 'Disable'}</button></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className={styles.empty}>No accounts match the current filters.</p>}
        </section>
      </div>

      {panel ? (
        <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setPanel(null); }}>
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="user-dialog-title">
            <header><div><p className={styles.eyebrow}>{panel.user.email}</p><h2 id="user-dialog-title">{panel.kind === 'edit' ? 'Edit account' : panel.kind === 'password' ? 'Set a new password' : panel.user.disabled ? 'Re-enable account' : 'Disable account'}</h2></div><button type="button" aria-label="Close dialog" disabled={Boolean(saving)} onClick={() => setPanel(null)}>×</button></header>
            {feedback?.tone === 'error' ? (
              <p className={styles.dialogFeedback + ' ' + styles.error} role="alert">{feedback.text}</p>
            ) : null}
            {panel.kind === 'edit' ? (
              <form className={styles.dialogForm} onSubmit={saveProfile}>
                <label><span>Display name</span><input required maxLength={120} value={editForm.name} onChange={(event) => setEditForm((form) => ({ ...form, name: event.target.value }))} /></label>
                <label><span>Email address</span><input required type="email" value={editForm.email} onChange={(event) => setEditForm((form) => ({ ...form, email: event.target.value }))} /></label>
                <label><span>Role</span><select value={editForm.role} onChange={(event) => setEditForm((form) => ({ ...form, role: event.target.value as AuthRole }))}><option value="engineer">Engineer</option><option value="admin">Administrator</option></select></label>
                <p>Saving revokes every session for this account. Renaming also updates exact owner, creator, and checklist assignments.</p>
                <div className={styles.dialogActions}><button type="button" onClick={() => setPanel(null)} disabled={Boolean(saving)}>Cancel</button><button type="submit" disabled={Boolean(saving)}>{saving === 'profile' ? 'Saving…' : 'Save changes'}</button></div>
              </form>
            ) : panel.kind === 'password' ? (
              <form className={styles.dialogForm} onSubmit={savePassword}>
                <label><span>New password</span><input required autoFocus type="password" minLength={12} maxLength={128} autoComplete="new-password" value={passwordForm.password} onChange={(event) => setPasswordForm((form) => ({ ...form, password: event.target.value }))} /></label>
                <label><span>Confirm new password</span><input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={passwordForm.passwordConfirmation} onChange={(event) => setPasswordForm((form) => ({ ...form, passwordConfirmation: event.target.value }))} /></label>
                <p>The existing password is never retrieved. Saving stores a new scrypt hash and revokes every session.</p>
                <div className={styles.dialogActions}><button type="button" onClick={() => setPanel(null)} disabled={Boolean(saving)}>Cancel</button><button type="submit" disabled={Boolean(saving)}>{saving === 'password' ? 'Setting password…' : 'Set new password'}</button></div>
              </form>
            ) : (
              <div className={styles.confirmation}>
                <div className={styles.confirmPerson}><span className={styles.personAvatar}>{initials(panel.user.name)}</span><span><strong>{panel.user.name}</strong><small>{panel.user.email}</small></span></div>
                <p>{panel.user.disabled ? 'This account will be able to sign in again with its current password. Old sessions stay revoked.' : 'This account will lose access immediately and all existing sessions will be revoked. Work history remains intact.'}</p>
                <div className={styles.dialogActions}><button type="button" onClick={() => setPanel(null)} disabled={Boolean(saving)}>Cancel</button><button type="button" className={panel.user.disabled ? styles.confirmEnable : styles.confirmDisable} disabled={Boolean(saving)} onClick={() => void saveStatus()}>{saving === 'status' ? 'Saving…' : panel.user.disabled ? 'Re-enable account' : 'Disable account'}</button></div>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
