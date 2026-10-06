'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ManagedTeam } from '../../../db/team-settings';
import SignOutButton from '../../components/sign-out-button';
import styles from './settings.module.css';

type Feedback = { tone: 'success' | 'error'; text: string } | null;

async function teamRequest<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
  const response = await fetch('/api/admin/teams', {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Team settings are temporarily unavailable.');
  return payload;
}

function sortTeams(teams: ManagedTeam[]) {
  return [...teams].sort((left, right) => (
    Number(right.active) - Number(left.active)
    || left.position - right.position
    || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  ));
}

export default function TeamSettings({ currentUserName }: { currentUserName: string }) {
  const [teams, setTeams] = useState<ManagedTeam[]>([]);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const activeCount = useMemo(() => teams.filter((team) => team.active).length, [teams]);

  useEffect(() => {
    let active = true;
    void teamRequest<{ teams: ManagedTeam[] }>('GET')
      .then(({ teams: result }) => {
        if (!active) return;
        setTeams(sortTeams(result));
        setDraftNames(Object.fromEntries(result.map((team) => [team.id, team.name])));
      })
      .catch((error: unknown) => {
        if (active) setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Teams could not be loaded.' });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  function applyTeam(team: ManagedTeam) {
    setTeams((current) => sortTeams([...current.filter((candidate) => candidate.id !== team.id), team]));
    setDraftNames((current) => ({ ...current, [team.id]: team.name }));
  }

  async function createTeam(event: React.FormEvent) {
    event.preventDefault();
    try {
      setSaving('create');
      setFeedback(null);
      const result = await teamRequest<{ team: ManagedTeam }>('POST', { name: newName });
      applyTeam(result.team);
      setNewName('');
      setFeedback({ tone: 'success', text: `${result.team.name} was added to work-card dropdowns.` });
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'The team could not be added.' });
    } finally {
      setSaving('');
    }
  }

  async function updateTeam(team: ManagedTeam, mutation: { name?: string; active?: boolean }) {
    try {
      setSaving(team.id);
      setFeedback(null);
      const result = await teamRequest<{ team: ManagedTeam }>('PATCH', { id: team.id, ...mutation });
      applyTeam(result.team);
      setFeedback({ tone: 'success', text: `${result.team.name} was updated.` });
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'The team could not be updated.' });
    } finally {
      setSaving('');
    }
  }

  async function deleteTeam(team: ManagedTeam) {
    if (!window.confirm(`Delete “${team.name}” from the team dropdown?`)) return;
    try {
      setSaving(team.id);
      setFeedback(null);
      await teamRequest<{ deleted: { id: string } }>('DELETE', { id: team.id });
      setTeams((current) => current.filter((candidate) => candidate.id !== team.id));
      setDraftNames((current) => {
        const next = { ...current };
        delete next[team.id];
        return next;
      });
      setFeedback({ tone: 'success', text: `${team.name} was deleted.` });
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'The team could not be deleted.' });
    } finally {
      setSaving('');
    }
  }

  const initials = currentUserName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerNav}>
            <Link href="/management" className={styles.backLink}>← Delivery overview</Link>
            <div className={styles.account}><span>{initials}</span><strong>{currentUserName}</strong><SignOutButton className={styles.signOut} /></div>
          </div>
          <p className={styles.eyebrow}>Administration / Controlled lists</p>
          <h1>Dropdown settings</h1>
          <p>Keep work-card options accurate without changing application code.</p>
        </div>
      </header>

      <div className={styles.content}>
        {feedback ? <p className={`${styles.feedback} ${styles[feedback.tone]}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.text}</p> : null}

        <section className={styles.summary} aria-label="Team settings summary">
          <div><span>Configured teams</span><strong>{teams.length}</strong></div>
          <div><span>Active in dropdowns</span><strong>{activeCount}</strong></div>
          <p>Disabling a team removes it from new selections while preserving historical cards. Renaming updates existing cards automatically.</p>
        </section>

        <section className={styles.panel} aria-labelledby="teams-settings-title">
          <header>
            <div><p className={styles.eyebrow}>Work-card dropdown</p><h2 id="teams-settings-title">Engineering teams</h2></div>
            <form onSubmit={(event) => void createTeam(event)}>
              <label><span className={styles.srOnly}>New team name</span><input maxLength={80} required placeholder="New team name" value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
              <button type="submit" disabled={Boolean(saving)}>{saving === 'create' ? 'Adding…' : '＋ Add team'}</button>
            </form>
          </header>

          {loading ? <p className={styles.empty}>Loading team options…</p> : null}
          {!loading && teams.length === 0 ? <p className={styles.empty}>No teams have been configured.</p> : null}
          <div className={styles.teamList}>
            {teams.map((team) => {
              const name = draftNames[team.id] ?? team.name;
              const changed = name.trim().replace(/\s+/g, ' ') !== team.name;
              return (
                <article key={team.id} className={!team.active ? styles.inactive : undefined}>
                  <span className={styles.statusDot} aria-hidden="true" />
                  <label><span>Team name</span><input maxLength={80} value={name} onChange={(event) => setDraftNames((current) => ({ ...current, [team.id]: event.target.value }))} /></label>
                  <div className={styles.usage}><strong>{team.usageCount}</strong><span>work card{team.usageCount === 1 ? '' : 's'}</span></div>
                  <span className={styles.state}>{team.active ? 'Active' : 'Disabled'}</span>
                  <div className={styles.actions}>
                    <button type="button" onClick={() => void updateTeam(team, { name })} disabled={!changed || Boolean(saving)}>Save name</button>
                    <button type="button" onClick={() => void updateTeam(team, { active: !team.active })} disabled={Boolean(saving)}>{team.active ? 'Disable' : 'Enable'}</button>
                    {team.usageCount === 0 ? <button className={styles.delete} type="button" onClick={() => void deleteTeam(team)} disabled={Boolean(saving)}>Delete</button> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
