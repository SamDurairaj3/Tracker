'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import SignOutButton from '../../components/sign-out-button';
import { localDateKey } from '../../../lib/local-time';
import {
  classifyWeeklyReviewEvent,
  formatIsoWeekRange,
  isoWeekForDate,
  shiftIsoWeek,
  type WeeklyReviewCategory,
  type WeeklyReviewEvent,
  type WeeklyReviewSnapshot,
} from '../../../lib/weekly-review';
import type { WorkPriority } from '../../../lib/work-items';
import styles from './weekly-review.module.css';

type CategoryFilter = 'all' | WeeklyReviewCategory;

const categories: Array<{
  value: CategoryFilter;
  label: string;
  shortLabel: string;
}> = [
  { value: 'all', label: 'All activity', shortLabel: 'All' },
  { value: 'created', label: 'Cards created', shortLabel: 'Created' },
  { value: 'completion', label: 'Checklist completions', shortLabel: 'Completed' },
  { value: 'workflow', label: 'Workflow changes', shortLabel: 'Workflow' },
  { value: 'comment', label: 'Comments', shortLabel: 'Comments' },
  { value: 'edited', label: 'Card edits', shortLabel: 'Edits' },
  { value: 'lifecycle', label: 'Archive activity', shortLabel: 'Lifecycle' },
];

const categoryPresentation: Record<WeeklyReviewCategory, {
  icon: string;
  title: string;
}> = {
  created: { icon: '+', title: 'New card created' },
  completion: { icon: '✓', title: 'Checklist completed' },
  workflow: { icon: '↗', title: 'Workflow changed' },
  comment: { icon: '“', title: 'Comment added' },
  edited: { icon: '✎', title: 'Card updated' },
  lifecycle: { icon: '↺', title: 'Card lifecycle changed' },
};

const priorities: WorkPriority[] = ['Critical', 'High', 'Medium'];

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function eventDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function formatDay(value: string) {
  const date = eventDate(value);
  return date
    ? new Intl.DateTimeFormat(undefined, {
      weekday: 'long', day: 'numeric', month: 'long',
    }).format(date)
    : value;
}

function formatTime(value: string) {
  const date = eventDate(value);
  return date
    ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
    : '';
}

function dayKey(value: string) {
  const date = eventDate(value);
  return date ? localDateKey(date) : value.slice(0, 10);
}

async function loadWeeklyReview(week: string) {
  const offset = new Date().getTimezoneOffset();
  const response = await fetch(
    `/api/admin/weekly-review?week=${encodeURIComponent(week)}&offset=${offset}`,
    { cache: 'no-store', credentials: 'same-origin' },
  );
  const payload = await response.json().catch(() => ({})) as {
    review?: WeeklyReviewSnapshot;
    error?: string;
  };
  if (!response.ok || !payload.review) {
    throw new Error(payload.error || 'The weekly review could not be loaded.');
  }
  return payload.review;
}

export default function WeeklyIntegrationReview({
  currentUserName,
  engineerNames,
  teamNames,
  initialWeek,
}: {
  currentUserName: string;
  engineerNames: string[];
  teamNames: string[];
  initialWeek: string;
}) {
  const [week, setWeek] = useState(initialWeek);
  const [snapshot, setSnapshot] = useState<WeeklyReviewSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [engineer, setEngineer] = useState('all');
  const [team, setTeam] = useState('all');
  const [priority, setPriority] = useState<'all' | WorkPriority>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const currentWeek = isoWeekForDate(new Date());

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setSnapshot(null);
      setSnapshot(await loadWeeklyReview(week));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The weekly review could not be loaded.');
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [week]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initial);
  }, [refresh]);

  const events = useMemo(() => snapshot?.events ?? [], [snapshot]);
  const engineers = useMemo(() => Array.from(new Set([
    ...engineerNames,
    ...events.map((event) => event.authorName),
  ])).sort((left, right) => left.localeCompare(right)), [engineerNames, events]);
  const teams = useMemo(() => Array.from(new Set([
    ...teamNames,
    ...events.map((event) => event.team),
  ])).sort((left, right) => left.localeCompare(right)), [events, teamNames]);

  const baseFilteredEvents = useMemo(() => events.filter((event) => (
    (engineer === 'all' || event.authorName === engineer)
    && (team === 'all' || event.team === team)
    && (priority === 'all' || event.priority === priority)
  )), [engineer, events, priority, team]);

  const filteredEvents = useMemo(() => baseFilteredEvents.filter((event) => (
    category === 'all' || classifyWeeklyReviewEvent(event) === category
  )), [baseFilteredEvents, category]);

  const categoryCounts = useMemo(() => {
    const counts = Object.fromEntries(categories.map(({ value }) => [value, 0])) as Record<CategoryFilter, number>;
    counts.all = baseFilteredEvents.length;
    for (const event of baseFilteredEvents) counts[classifyWeeklyReviewEvent(event)] += 1;
    return counts;
  }, [baseFilteredEvents]);

  const dayGroups = useMemo(() => {
    const groups = new Map<string, WeeklyReviewEvent[]>();
    for (const event of filteredEvents) {
      const key = dayKey(event.createdAt);
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    return [...groups.entries()];
  }, [filteredEvents]);

  const contributorCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of filteredEvents) counts.set(event.authorName, (counts.get(event.authorName) ?? 0) + 1);
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  }, [filteredEvents]);

  const teamCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of filteredEvents) counts.set(event.team, (counts.get(event.team) ?? 0) + 1);
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  }, [filteredEvents]);
  const maximumTeamCount = Math.max(1, ...teamCounts.map(([, count]) => count));
  const cardCount = new Set(filteredEvents.map((event) => event.workItemId)).size;
  const completionCount = filteredEvents.filter((event) => classifyWeeklyReviewEvent(event) === 'completion').length;
  const commentCount = filteredEvents.filter((event) => event.type === 'comment').length;
  const hasFilters = engineer !== 'all' || team !== 'all' || priority !== 'all' || category !== 'all';

  function resetFilters() {
    setEngineer('all');
    setTeam('all');
    setPriority('all');
    setCategory('all');
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <nav className={styles.topNav} aria-label="Weekly review navigation">
            <Link href="/management">← Delivery overview</Link>
            <div className={styles.account}>
              <span>{initials(currentUserName)}</span>
              <strong>{currentUserName}</strong>
              <SignOutButton className={styles.signOut} />
            </div>
          </nav>
          <div className={styles.heroCopy}>
            <div>
              <p className={styles.eyebrow}>Management / Integration cadence</p>
              <h1>Weekly integration review</h1>
              <p>A meeting-ready view of what moved, who contributed, and where the engineering effort went.</p>
            </div>
            <section className={styles.weekPicker} aria-label="Review week">
              <div className={styles.weekPickerTop}>
                <button type="button" onClick={() => setWeek((value) => shiftIsoWeek(value, -1))} aria-label="Previous week">←</button>
                <label>
                  <span>Review week</span>
                  <input type="week" value={week} onChange={(event) => event.target.value && setWeek(event.target.value)} />
                </label>
                <button type="button" onClick={() => setWeek((value) => shiftIsoWeek(value, 1))} aria-label="Next week">→</button>
              </div>
              <div className={styles.weekCaption}>
                <strong>Week {week.split('-W')[1]}</strong>
                <span>{formatIsoWeekRange(week)}</span>
                {week !== currentWeek ? <button type="button" onClick={() => setWeek(currentWeek)}>Jump to this week</button> : <em>Current week</em>}
              </div>
            </section>
          </div>
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.scoreboard} aria-label="Weekly activity summary">
          <article><span>Recorded updates</span><strong>{filteredEvents.length}</strong><small>Across the selected view</small></article>
          <article><span>Engineers active</span><strong>{contributorCounts.length}</strong><small>People who recorded activity</small></article>
          <article><span>Cards touched</span><strong>{cardCount}</strong><small>Distinct work items</small></article>
          <article className={styles.completionMetric}><span>Actions completed</span><strong>{completionCount}</strong><small>{commentCount} comment{commentCount === 1 ? '' : 's'} captured</small></article>
        </section>

        <section className={styles.filterPanel} aria-label="Weekly review filters">
          <div className={styles.filterHeading}>
            <div><span className={styles.eyebrow}>Focus the conversation</span><h2>Review filters</h2></div>
            {hasFilters ? <button type="button" onClick={resetFilters}>Reset all</button> : <span>{events.length} total event{events.length === 1 ? '' : 's'} this week</span>}
          </div>
          <div className={styles.selectFilters}>
            <label><span>Engineer</span><select value={engineer} onChange={(event) => setEngineer(event.target.value)}><option value="all">All engineers</option>{engineers.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label><span>Team</span><select value={team} onChange={(event) => setTeam(event.target.value)}><option value="all">All teams</option>{teams.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value as 'all' | WorkPriority)}><option value="all">All priorities</option>{priorities.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          </div>
          <div className={styles.categoryFilters} aria-label="Activity type">
            {categories.map((option) => (
              <button
                key={option.value}
                className={category === option.value ? styles.categoryActive : undefined}
                type="button"
                onClick={() => setCategory(option.value)}
                title={option.label}
              >
                <span>{option.shortLabel}</span><b>{categoryCounts[option.value]}</b>
              </button>
            ))}
          </div>
        </section>

        {snapshot?.truncated ? <p className={styles.warning}>This week contains more than 2,000 events. Narrow the meeting view with filters.</p> : null}
        {error ? <div className={styles.error} role="alert"><strong>Could not load this week</strong><p>{error}</p><button type="button" onClick={() => void refresh()}>Try again</button></div> : null}
        {loading ? <div className={styles.loading} role="status"><span /><p>Building the weekly picture…</p></div> : null}

        {!loading && !error ? (
          <div className={styles.reviewGrid}>
            <section className={styles.timeline} aria-labelledby="activity-timeline-title">
              <header className={styles.sectionHeader}>
                <div><span className={styles.eyebrow}>Monday to Sunday</span><h2 id="activity-timeline-title">Integration timeline</h2></div>
                <p>{filteredEvents.length} visible update{filteredEvents.length === 1 ? '' : 's'}</p>
              </header>

              {dayGroups.length === 0 ? (
                <div className={styles.emptyState}>
                  <span aria-hidden="true">○</span>
                  <h3>No matching updates</h3>
                  <p>{events.length ? 'Adjust the filters to widen the review.' : 'No activity was recorded during this week.'}</p>
                  {hasFilters ? <button type="button" onClick={resetFilters}>Clear filters</button> : null}
                </div>
              ) : dayGroups.map(([date, dayEvents]) => (
                <section className={styles.dayGroup} key={date}>
                  <header>
                    <time dateTime={date}>{formatDay(dayEvents[0].createdAt)}</time>
                    <span>{dayEvents.length} update{dayEvents.length === 1 ? '' : 's'}</span>
                  </header>
                  <div className={styles.eventList}>
                    {dayEvents.map((event) => {
                      const eventCategory = classifyWeeklyReviewEvent(event);
                      const presentation = categoryPresentation[eventCategory];
                      return (
                        <article className={`${styles.eventCard} ${styles[eventCategory]}`} key={event.id}>
                          <div className={styles.eventMarker} aria-hidden="true">{presentation.icon}</div>
                          <div className={styles.eventBody}>
                            <div className={styles.eventTopline}>
                              <span className={styles.eventKind}>{presentation.title}</span>
                              <time dateTime={event.createdAt}>{formatTime(event.createdAt)}</time>
                            </div>
                            <div className={styles.eventIdentity}>
                              <span className={styles.personAvatar}>{initials(event.authorName)}</span>
                              <strong>{event.authorName}</strong>
                              <span>in {event.team}</span>
                            </div>
                            <p className={styles.eventCopy}>{event.body}</p>
                            {event.checklistTitle ? <p className={styles.checklistReference}><span>Checklist</span>{event.checklistTitle}</p> : null}
                            <footer>
                              <Link href={`/management?workItem=${encodeURIComponent(event.workItemId)}`}>
                                <strong>{event.workItemId}</strong><span>{event.workItemTitle}</span>
                              </Link>
                              <div><span className={`${styles.priority} ${styles[event.priority.toLowerCase()]}`}>{event.priority}</span>{event.archivedAt ? <span className={styles.archived}>Archived</span> : null}</div>
                            </footer>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </section>

            <aside className={styles.insights} aria-label="Weekly participation insights">
              <section>
                <header><span className={styles.eyebrow}>Distribution</span><h2>Team pulse</h2></header>
                {teamCounts.length ? <ol className={styles.teamPulse}>{teamCounts.map(([name, count]) => <li key={name}><div><strong>{name}</strong><span>{count}</span></div><i><b style={{ width: `${Math.max(8, count / maximumTeamCount * 100)}%` }} /></i></li>)}</ol> : <p className={styles.insightEmpty}>No team activity in this view.</p>}
              </section>
              <section>
                <header><span className={styles.eyebrow}>Participation</span><h2>Contributors</h2></header>
                {contributorCounts.length ? <ol className={styles.contributors}>{contributorCounts.map(([name, count]) => <li key={name}><span>{initials(name)}</span><div><strong>{name}</strong><small>{count} update{count === 1 ? '' : 's'}</small></div></li>)}</ol> : <p className={styles.insightEmpty}>No contributors in this view.</p>}
              </section>
              <section className={styles.meetingPrompt}>
                <span aria-hidden="true">◇</span>
                <h2>Use this view in the room</h2>
                <p>Start with completions, scan workflow changes, then use comments and edits to surface decisions or blockers.</p>
              </section>
            </aside>
          </div>
        ) : null}
      </div>
    </main>
  );
}
