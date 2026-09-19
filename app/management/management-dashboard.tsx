'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import WorkItemDetail from '../components/work-item-detail';
import { buildTimeline, timelinePosition } from '../../lib/work-schedule';
import { useLiveNow } from '../../lib/use-live-now';
import { fetchWorkItems, updateWorkItem } from '../../lib/work-items-client';
import type { WorkHealth, WorkItem, WorkItemPatch, WorkStatus } from '../../lib/work-items';
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

export default function ManagementDashboard() {
  const [view, setView] = useState<ViewMode>('kanban');
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState('All teams');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [loadError, setLoadError] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const now = useLiveNow();

  const refreshWorkItems = useCallback(async () => {
    try {
      setWorkItems(await fetchWorkItems());
      setLoadError('');
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Work items could not be loaded.',
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchWorkItems()
      .then((items) => {
        if (!active) return;
        setWorkItems(items);
        setLoadError('');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(
          error instanceof Error ? error.message : 'Work items could not be loaded.',
        );
      });
    const refresh = () => void refreshWorkItems();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [refreshWorkItems]);

  const teams = useMemo(
    () => ['All teams', ...Array.from(new Set(workItems.map((item) => item.team)))],
    [workItems],
  );

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return workItems.filter((item) => {
      const matchesTeam = team === 'All teams' || item.team === team;
      const matchesAttention = !attentionOnly || item.health !== 'on-track';
      const matchesQuery =
        !normalizedQuery ||
        [item.id, item.title, item.owner, item.team].some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        );

      return matchesTeam && matchesAttention && matchesQuery;
    });
  }, [attentionOnly, query, team, workItems]);

  const activeCount = workItems.filter((item) => item.status === 'active').length;
  const blockedCount = workItems.filter((item) => item.health === 'blocked').length;
  const reviewCount = workItems.filter((item) => item.status === 'review').length;
  const atRiskCount = workItems.filter((item) => item.health === 'at-risk').length;
  const selectedItem = workItems.find((item) => item.id === selectedItemId) ?? null;
  const timeline = useMemo(
    () => now ? buildTimeline(filteredItems, now) : null,
    [filteredItems, now],
  );
  const closeDetail = useCallback(() => setSelectedItemId(''), []);
  const saveUpdate = useCallback(async (patch: WorkItemPatch) => {
    const updated = await updateWorkItem(patch);
    setWorkItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    return updated;
  }, []);
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
          <a href="#all-work">
            <span aria-hidden="true">▦</span> All work
          </a>
          <a href="#attention">
            <span aria-hidden="true">△</span> Attention
            <b>{blockedCount + atRiskCount}</b>
          </a>
          <a href="#teams">
            <span aria-hidden="true">◎</span> Teams
          </a>

          <span className={styles.navLabel}>Views</span>
          <a href="#board">
            <span aria-hidden="true">▥</span> Kanban
          </a>
          <a href="#schedule">
            <span aria-hidden="true">▰</span> Gantt schedule
          </a>
        </nav>

        <div className={styles.roleSwitch}>
          <span className={styles.avatar}>MG</span>
          <span>
            <strong>Management workspace</strong>
            <small>Organization-wide view</small>
            <Link href="/engineering">Open engineering workspace</Link>
          </span>
        </div>
      </aside>

      <section className={styles.workspace} id="delivery">
        <header className={styles.topbar}>
          <div>
            <span className={styles.breadcrumb}>Work tracking / Management</span>
            <h1>Engineering delivery</h1>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.secondaryButton} type="button">
              Export review
            </button>
            <button className={styles.primaryButton} type="button">
              Weekly integration review <span aria-hidden="true">→</span>
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
              <strong>{workItems.length}</strong>
              <small>Across {teams.length - 1} engineering teams</small>
            </article>
            <article>
              <span>Active execution</span>
              <strong>{activeCount}</strong>
              <small>Currently being worked</small>
            </article>
            <article className={styles.metricWarning}>
              <span>Schedule attention</span>
              <strong>{blockedCount + atRiskCount}</strong>
              <small>{blockedCount} blocked · {atRiskCount} at risk</small>
            </article>
            <article>
              <span>Awaiting review</span>
              <strong>{reviewCount}</strong>
              <small>Needs technical closure</small>
            </article>
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
                            className={styles.workCard}
                            key={item.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`Open ${item.id}: ${item.title}`}
                            onClick={() => setSelectedItemId(item.id)}
                            onKeyDown={(event) => openFromKeyboard(event, item.id)}
                          >
                            <div className={styles.cardTopline}>
                              <span>{item.id}</span>
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
                                    <span>{item.id}</span>
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
      <WorkItemDetail
        key={selectedItem?.id ?? 'closed'}
        item={selectedItem}
        onClose={closeDetail}
        onUpdate={saveUpdate}
        canUpdateStatus
        canUpdateChecklist={() => true}
        allowAllChecklistStatuses
      />
    </main>
  );
}
