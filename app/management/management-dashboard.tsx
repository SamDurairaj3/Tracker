'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import WorkItemDetail from '../components/work-item-detail';
import WorkItemCreateDialog from '../components/work-item-create-dialog';
import PushNotificationControl from '../components/push-notification-control';
import SignOutButton from '../components/sign-out-button';
import { formatDateTime } from '../../lib/local-time';
import { buildTimeline, timelinePosition } from '../../lib/work-schedule';
import { useLiveNow } from '../../lib/use-live-now';
import {
  deleteWorkItem,
  editWorkItem,
  fetchManagementNotifications,
  fetchWorkItems,
  setWorkItemArchived,
  updateWorkItem,
} from '../../lib/work-items-client';
import type { WorkHealth, WorkItem, WorkItemEditInput, WorkItemPatch, WorkStatus } from '../../lib/work-items';
import type { ManagementNotification } from '../../lib/management-notifications';
import styles from './management.module.css';

type ViewMode = 'kanban' | 'gantt';

const columns: Array<{ status: WorkStatus; label: string; description: string }> = [
  { status: 'captured', label: 'Captured', description: 'Needs triage' },
  { status: 'ready', label: 'Ready', description: 'Clear to begin' },
  { status: 'active', label: 'Active', description: 'In execution' },
  { status: 'review', label: 'Review', description: 'Awaiting closure' },
  { status: 'done', label: 'Done', description: 'Completed' },
];

const healthLabels: Record<WorkHealth, string> = {
  'on-track': 'On track',
  'at-risk': 'At risk',
  blocked: 'Blocked',
};

const notificationLabels: Record<ManagementNotification['type'], string> = {
  comment: 'Comment', created: 'Created', edited: 'Edited', workflow: 'Workflow',
  checklist: 'Checklist', archived: 'Archived', restored: 'Restored',
};

export default function ManagementDashboard({
  currentUserName,
  activeUserNames,
  teamNames,
}: {
  currentUserName: string;
  activeUserNames: string[];
  teamNames: string[];
}) {
  const [view, setView] = useState<ViewMode>('kanban');
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState('All teams');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [loadError, setLoadError] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [notifications, setNotifications] = useState<ManagementNotification[]>([]);
  const [notificationError, setNotificationError] = useState('');
  const now = useLiveNow();

  const refreshWorkItems = useCallback(async () => {
    try {
      setWorkItems(await fetchWorkItems(showArchived));
      setLoadError('');
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Work items could not be loaded.',
      );
    }
  }, [showArchived]);

  const refreshNotifications = useCallback(async () => {
    try {
      setNotifications(await fetchManagementNotifications(20));
      setNotificationError('');
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : 'Notifications could not be loaded.');
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchWorkItems(showArchived)
      .then((items) => {
        if (!active) return;
        setWorkItems(items);
        setLoadError('');
        const requested = new URLSearchParams(window.location.search).get('workItem');
        if (requested && items.some((item) => item.id === requested)) {
          setSelectedItemId(requested);
          window.history.replaceState({}, '', '/management');
        } else if (requested && !showArchived) {
          setShowArchived(true);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(
          error instanceof Error ? error.message : 'Work items could not be loaded.',
        );
      });
    const refresh = () => {
      void refreshWorkItems();
      void refreshNotifications();
    };
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [refreshNotifications, refreshWorkItems, showArchived]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshNotifications(), 0);
    const timer = window.setInterval(() => void refreshNotifications(), 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refreshNotifications]);

  const teams = useMemo(
    () => ['All teams', ...Array.from(new Set([...teamNames, ...workItems.map((item) => item.team)]))],
    [teamNames, workItems],
  );

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return workItems.filter((item) => {
      const matchesTeam = team === 'All teams' || item.team === team;
      const matchesAttention = !attentionOnly || item.needsAttention || item.health !== 'on-track';
      const matchesQuery =
        !normalizedQuery ||
        [item.id, item.title, item.owner, item.team].some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        );

      return matchesTeam && matchesAttention && matchesQuery;
    });
  }, [attentionOnly, query, team, workItems]);

  const currentItems = workItems.filter((item) => !item.archivedAt);
  const activeCount = currentItems.filter((item) => item.status === 'active').length;
  const blockedCount = currentItems.filter((item) => item.health === 'blocked').length;
  const reviewCount = currentItems.filter((item) => item.status === 'review').length;
  const atRiskCount = currentItems.filter((item) => item.health === 'at-risk').length;
  const attentionCount = currentItems.filter((item) => item.needsAttention || item.health !== 'on-track').length;
  const selectedItem = workItems.find((item) => item.id === selectedItemId) ?? null;
  const timeline = useMemo(
    () => now ? buildTimeline(filteredItems, now) : null,
    [filteredItems, now],
  );
  const closeDetail = useCallback(() => setSelectedItemId(''), []);
  const closeCreate = useCallback(() => setShowCreate(false), []);
  const saveUpdate = useCallback(async (patch: WorkItemPatch) => {
    const updated = await updateWorkItem(patch);
    setWorkItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    return updated;
  }, []);
  const saveEdit = useCallback(async (input: WorkItemEditInput) => {
    const updated = await editWorkItem(input);
    setWorkItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    return updated;
  }, []);
  const changeArchive = useCallback(async (archived: boolean) => {
    if (!selectedItemId) throw new Error('No work item is selected.');
    const updated = await setWorkItemArchived(selectedItemId, archived);
    setWorkItems((current) => showArchived
      ? current.map((item) => item.id === updated.id ? updated : item)
      : current.filter((item) => item.id !== updated.id));
    if (archived && !showArchived) setSelectedItemId('');
    return updated;
  }, [selectedItemId, showArchived]);
  const removeSelected = useCallback(async (confirmation: string) => {
    if (!selectedItemId) return;
    await deleteWorkItem(selectedItemId, confirmation);
    setWorkItems((current) => current.filter((item) => item.id !== selectedItemId));
    setSelectedItemId('');
  }, [selectedItemId]);
  const openFromKeyboard = (event: React.KeyboardEvent, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelectedItemId(id);
    }
  };

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Management navigation">
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            V
          </span>
          <span>
            <strong>Cosmicport</strong>
            <small>Management command center</small>
          </span>
        </div>

        <nav className={styles.nav}>
          <span className={styles.navLabel}>Workspace</span>
          <a className={styles.navActive} href="#delivery" aria-current="page">
            <span aria-hidden="true">◆</span> Delivery overview
          </a>
          <Link href="/management/users">
            <span aria-hidden="true">+</span> User management
          </Link>
          <a href="#all-work">
            <span aria-hidden="true">▦</span> All work
          </a>
          <a href="#attention">
            <span aria-hidden="true">△</span> Attention
            <b>{attentionCount}</b>
          </a>
          <a href="#notifications">
            <span aria-hidden="true">◉</span> Notifications
          </a>
          <Link href="/management/users">
            <span aria-hidden="true">◎</span> Teams
          </Link>
          <Link href="/management/settings">
            <span aria-hidden="true">⚙</span> Dropdown settings
          </Link>

          <span className={styles.navLabel}>Views</span>
          <Link href="/management/weekly-review">
            <span aria-hidden="true">◫</span> Weekly review
          </Link>
          <a href="#board">
            <span aria-hidden="true">▥</span> Kanban
          </a>
          <a href="#schedule">
            <span aria-hidden="true">▰</span> Gantt schedule
          </a>
        </nav>

        <div className={styles.roleSwitch}>
          <span className={styles.avatar}>
            {currentUserName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
          </span>
          <span className={styles.profileCopy}>
            <strong>{currentUserName}</strong>
            <small>Administrator</small>
            <Link href="/engineering">Open engineering workspace</Link>
          </span>
          <SignOutButton className={styles.signOutButton} />
        </div>
      </aside>

      <section className={styles.workspace} id="delivery">
        <header className={styles.topbar}>
          <div>
            <span className={styles.breadcrumb}>Work tracking / Management</span>
            <h1>Engineering delivery</h1>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.secondaryButton} href="/management/weekly-review">
              Weekly integration review
            </Link>
            <button className={styles.primaryButton} type="button" onClick={() => setShowCreate(true)}>
              Create work card <span aria-hidden="true">＋</span>
            </button>
          </div>
        </header>

        <div className={styles.content}>
          <section className={styles.hero} aria-labelledby="management-title">
            <div>
              <span className={styles.eyebrow}>Organization-wide execution</span>
              <h2 id="management-title">Every team. One delivery picture.</h2>
              <p>
                Work created and owned by engineers, consolidated for management
                review.
              </p>
            </div>
            <div className={styles.snapshot}>
              <span />
              {loadError || 'Live work-item data'}
            </div>
          </section>

          <section className={styles.metrics} aria-label="Delivery summary">
            <article>
              <span>Total work items</span>
              <strong>{currentItems.length}</strong>
              <small>Across {new Set(currentItems.map((item) => item.team)).size} engineering teams</small>
            </article>
            <article>
              <span>Active execution</span>
              <strong>{activeCount}</strong>
              <small>Currently being worked</small>
            </article>
            <article className={styles.metricWarning}>
              <span>Schedule attention</span>
              <strong>{attentionCount}</strong>
              <small>{blockedCount} blocked · {atRiskCount} at risk · manually flagged included</small>
            </article>
            <article>
              <span>Awaiting review</span>
              <strong>{reviewCount}</strong>
              <small>Needs technical closure</small>
            </article>
          </section>

          <section className={styles.notificationsPanel} id="notifications" aria-labelledby="management-notifications-title">
            <header>
              <div><span className={styles.eyebrow}>Organization activity</span><h3 id="management-notifications-title">Management notifications</h3><p>Recent card activity and discussion across every team.</p></div>
              <PushNotificationControl />
            </header>
            {notificationError ? <p className={styles.notificationState} role="alert">{notificationError}</p> : null}
            {!notificationError && notifications.length === 0 ? <p className={styles.notificationState}>No activity has been recorded yet.</p> : null}
            {notifications.length ? (
              <ol className={styles.notificationFeed}>
                {notifications.slice(0, 10).map((notification) => (
                  <li key={notification.id}>
                    <button type="button" onClick={() => {
                      if (!workItems.some((item) => item.id === notification.workItemId)) setShowArchived(true);
                      setSelectedItemId(notification.workItemId);
                    }}>
                      <span className={styles.notificationAvatar}>{notification.authorName.slice(0, 1).toUpperCase()}</span>
                      <span><strong>{notification.workItemId} · {notification.workItemTitle}</strong><small>{notification.authorName} · {notificationLabels[notification.type]} · {formatDateTime(notification.createdAt)}</small><em>{notification.body}</em></span>
                      <b aria-hidden="true">→</b>
                    </button>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>

          <section className={styles.boardPanel} id="all-work" aria-labelledby="all-work-title">
            <div className={styles.boardToolbar}>
              <div>
                <span className={styles.eyebrow}>Execution flow</span>
                <h3 id="all-work-title">All engineering work</h3>
              </div>

              <div className={styles.viewSwitch} aria-label="Work visualization">
                <button
                  className={view === 'kanban' ? styles.viewActive : undefined}
                  type="button"
                  aria-pressed={view === 'kanban'}
                  onClick={() => setView('kanban')}
                >
                  Kanban
                </button>
                <button
                  className={view === 'gantt' ? styles.viewActive : undefined}
                  type="button"
                  aria-pressed={view === 'gantt'}
                  onClick={() => setView('gantt')}
                >
                  Gantt
                </button>
              </div>
            </div>

            <div className={styles.filters}>
              <label className={styles.search}>
                <span className={styles.srOnly}>Search all work</span>
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  placeholder="Search ID, title, owner or team"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>

              <label className={styles.selectLabel}>
                <span className={styles.srOnly}>Filter by team</span>
                <select value={team} onChange={(event) => setTeam(event.target.value)}>
                  {teams.map((teamName) => (
                    <option key={teamName}>{teamName}</option>
                  ))}
                </select>
              </label>

              <label className={styles.attentionToggle}>
                <input
                  type="checkbox"
                  checked={attentionOnly}
                  onChange={(event) => setAttentionOnly(event.target.checked)}
                />
                <span aria-hidden="true" />
                Attention only
              </label>

              <label className={styles.attentionToggle}>
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                />
                <span aria-hidden="true" />
                Show archived
              </label>

              <span className={styles.resultCount}>{filteredItems.length} items shown</span>
            </div>

            {view === 'kanban' ? (
              <div className={styles.kanban} id="board">
                {columns.map((column) => {
                  const columnItems = filteredItems.filter(
                    (item) => item.status === column.status,
                  );

                  return (
                    <section className={styles.column} key={column.status}>
                      <header>
                        <span className={`${styles.columnDot} ${styles[column.status]}`} />
                        <div>
                          <h4>{column.label}</h4>
                          <small>{column.description}</small>
                        </div>
                        <strong>{columnItems.length}</strong>
                      </header>

                      <div className={styles.cardList}>
                        {columnItems.map((item) => (
                          <article
                            className={`${item.archivedAt ? styles.archivedCard : styles.workCard} ${item.needsAttention ? styles.needsAttentionCard : ''}`}
                            key={item.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`Open ${item.id}: ${item.title}`}
                            onClick={() => setSelectedItemId(item.id)}
                            onKeyDown={(event) => openFromKeyboard(event, item.id)}
                          >
                            <div className={styles.cardTopline}>
                              <span className={item.needsAttention ? styles.attentionText : undefined}>{item.id}{item.archivedAt ? ' · Archived' : ''}{item.needsAttention ? ' · Needs attention' : ''}</span>
                              <span className={`${styles.health} ${styles[item.health]}`}>
                                <i aria-hidden="true" /> {healthLabels[item.health]}
                              </span>
                            </div>
                            <h5>{item.title}</h5>
                            <div className={styles.ownerLine}>
                              <span>{item.owner.slice(0, 1)}</span>
                              <p>
                                <strong>{item.owner}</strong>
                                <small>{item.team}</small>
                              </p>
                            </div>
                            <div className={styles.progressLine}>
                              <span>
                                <i style={{ width: `${item.progress}%` }} />
                              </span>
                              <small>{item.progress}%</small>
                            </div>
                            <footer>
                              <span className={styles.priority}>{item.priority}</span>
                              <time dateTime={item.due}>Due {item.dueLabel}</time>
                            </footer>
                          </article>
                        ))}

                        {columnItems.length === 0 ? (
                          <p className={styles.emptyColumn}>No matching work</p>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <section className={styles.gantt} id="schedule" aria-label="Engineering schedule">
                {timeline ? (
                  <>
                    <div className={styles.ganttLegend}>
                      <span><i className={styles.legendTrack} /> On track</span>
                      <span><i className={styles.legendRisk} /> At risk</span>
                      <span><i className={styles.legendBlocked} /> Blocked</span>
                      <b>{timeline.rangeLabel}</b>
                    </div>

                    <div className={styles.ganttScroll}>
                      <div className={styles.ganttTable} style={{ minWidth: `${310 + timeline.days * 30}px` }}>
                        <div className={styles.ganttHead}>
                          <div className={styles.workHead}>
                            <span>Work item</span>
                            <small>Owner and team</small>
                          </div>
                          <div
                            className={styles.timelineHead}
                            style={{ gridTemplateColumns: `repeat(${timeline.days}, minmax(30px, 1fr))` }}
                          >
                            {timeline.weeks.map((week) => (
                              <span
                                key={week.key}
                                style={{ gridColumn: `${week.startIndex + 1} / span ${week.span}` }}
                              >
                                <strong>{week.label}</strong>
                                <small>{week.sublabel}</small>
                              </span>
                            ))}
                          </div>
                        </div>

                        <div
                          className={styles.todayLabel}
                          style={{ left: `calc(310px + (100% - 310px) * ${(timeline.todayIndex + 0.5) / timeline.days})` }}
                        >
                          Today · {new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(now!)}
                        </div>

                        {filteredItems
                          .slice()
                          .sort((first, second) => first.due.localeCompare(second.due))
                          .map((item) => {
                            const position = timelinePosition(item, timeline);
                            return (
                              <article
                                className={styles.ganttRow}
                                key={item.id}
                                role="button"
                                tabIndex={0}
                                aria-label={`Open ${item.id}: ${item.title}`}
                                onClick={() => setSelectedItemId(item.id)}
                                onKeyDown={(event) => openFromKeyboard(event, item.id)}
                              >
                                <div className={styles.ganttWork}>
                                  <div>
                                    <span className={item.needsAttention ? styles.attentionText : undefined}>{item.id}{item.archivedAt ? ' · Archived' : ''}{item.needsAttention ? ' · Needs attention' : ''}</span>
                                    <h4>{item.title}</h4>
                                  </div>
                                  <p>
                                    <strong>{item.owner}</strong>
                                    <small>{item.team}</small>
                                  </p>
                                </div>
                                <div
                                  className={styles.ganttTrack}
                                  style={{
                                    gridTemplateColumns: `repeat(${timeline.days}, minmax(30px, 1fr))`,
                                    backgroundSize: `${100 / timeline.days}% 100%`,
                                  }}
                                >
                                  <span
                                    className={styles.todayLine}
                                    style={{ left: `${(timeline.todayIndex + 0.5) / timeline.days * 100}%` }}
                                    aria-hidden="true"
                                  />
                                  {position ? (
                                    <div
                                      className={`${styles.ganttBar} ${styles[item.health]}`}
                                      style={{ gridColumn: position.gridColumn }}
                                      title={`${item.id}: ${item.start} to ${item.due}`}
                                    >
                                      <i style={{ width: `${item.progress}%` }} />
                                      <b>{item.id}</b>
                                      <small>{item.progress}%</small>
                                    </div>
                                  ) : (
                                    <span className={styles.scheduleUnavailable}>Dates unavailable</span>
                                  )}
                                </div>
                              </article>
                            );
                          })}

                        {filteredItems.length === 0 ? (
                          <p className={styles.ganttEmpty}>No work matches these filters.</p>
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : <p className={styles.ganttEmpty}>Preparing the current schedule…</p>}
              </section>
            )}
          </section>
        </div>
      </section>
      {showCreate ? (
        <WorkItemCreateDialog
          creatorName={currentUserName}
          people={activeUserNames}
          teams={teamNames}
          onClose={closeCreate}
          onCreated={(item) => {
            setWorkItems((current) => [item, ...current]);
            setShowCreate(false);
            setSelectedItemId(item.id);
          }}
        />
      ) : null}
      <WorkItemDetail
        key={selectedItem?.id ?? 'closed'}
        item={selectedItem}
        people={activeUserNames}
        teams={teamNames}
        onClose={closeDetail}
        onUpdate={saveUpdate}
        onEdit={saveEdit}
        onArchive={changeArchive}
        onDelete={removeSelected}
        canUpdateStatus={Boolean(selectedItem && !selectedItem.archivedAt)}
        canUpdateChecklist={() => Boolean(selectedItem && !selectedItem.archivedAt)}
        canEdit={Boolean(selectedItem && !selectedItem.archivedAt)}
        canArchive={Boolean(selectedItem)}
        canDelete={Boolean(selectedItem?.archivedAt)}
        allowAllChecklistStatuses
      />
    </main>
  );
}
