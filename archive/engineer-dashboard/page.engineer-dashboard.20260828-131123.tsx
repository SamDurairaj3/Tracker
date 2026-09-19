/**
 * Archived engineer-dashboard prototype.
 *
 * This file originally rendered the root engineer workspace with personal work
 * summaries, priority items, and attention indicators. It is retained only as
 * a historical design reference and is no longer part of the active routes.
 */
import Link from 'next/link';

const summary = [
  { label: 'Active work', value: '24', note: 'Across 5 teams' },
  { label: 'Needs attention', value: '7', note: '3 blocked · 4 overdue' },
  { label: 'In review', value: '6', note: '2 awaiting your input' },
  { label: 'Completed this week', value: '18', note: 'Up 12% from last week' },
];

const workItems = [
  {
    id: 'PROP-142',
    title: 'Validate injector pressure-drop model',
    owner: 'A. Menon',
    team: 'Propulsion',
    status: 'Active',
    tone: 'active',
  },
  {
    id: 'STR-087',
    title: 'Close interstage load-case review',
    owner: 'N. Iyer',
    team: 'Structures',
    status: 'Review',
    tone: 'review',
  },
  {
    id: 'AVN-063',
    title: 'Resolve flight-computer harness routing',
    owner: 'R. Das',
    team: 'Avionics',
    status: 'Blocked',
    tone: 'blocked',
  },
];

const attentionItems = [
  { count: 3, label: 'Blocked items', detail: 'Waiting on a decision or input' },
  { count: 4, label: 'Overdue items', detail: 'Past their target completion date' },
  { count: 5, label: 'Stale updates', detail: 'No progress update in seven days' },
];

export default function Home() {
  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            V
          </span>
          <span>
            <strong>Vector Work</strong>
            <small>Engineering operations</small>
          </span>
        </div>

        <nav className="nav-list">
          <a className="nav-item active" href="#overview" aria-current="page">
            <span className="nav-dot" aria-hidden="true" />
            Overview
          </a>
          <a className="nav-item" href="#work">
            <span className="nav-dot" aria-hidden="true" />
            Work items
          </a>
          <a className="nav-item" href="#attention">
            <span className="nav-dot" aria-hidden="true" />
            Attention
          </a>
          <span className="nav-section">Planning</span>
          <a className="nav-item" href="#teams">
            <span className="nav-dot" aria-hidden="true" />
            Teams
          </a>
          <a className="nav-item" href="#schedule">
            <span className="nav-dot" aria-hidden="true" />
            Schedule
          </a>
          <span className="nav-section">Switch workspace</span>
          <Link className="nav-item" href="/management">
            <span className="nav-dot" aria-hidden="true" />
            Management
          </Link>
        </nav>

        <div className="sidebar-footer">
          <span className="environment-dot" aria-hidden="true" />
          Local development
        </div>
      </aside>

      <section className="workspace" id="overview">
        <header className="topbar">
          <div>
            <span className="eyebrow">Friday, 28 August</span>
            <h1>Operations overview</h1>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <span className="sr-only">Search work</span>
              <span aria-hidden="true">⌕</span>
              <input type="search" placeholder="Search work" />
              <kbd>⌘ K</kbd>
            </label>
            <button className="primary-button" type="button">
              <span aria-hidden="true">＋</span>
              New work item
            </button>
            <button className="avatar" type="button" aria-label="Open user menu">
              SM
            </button>
          </div>
        </header>

        <div className="content">
          <section className="intro-row" aria-labelledby="welcome-title">
            <div>
              <p className="eyebrow accent">Management command center</p>
              <h2 id="welcome-title">Good morning.</h2>
              <p>Here is where engineering work needs attention today.</p>
            </div>
            <div className="sync-status">
              <span aria-hidden="true" />
              Updated just now
            </div>
          </section>

          <section className="summary-grid" aria-label="Work summary">
            {summary.map((item) => (
              <article className="summary-card" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.note}</small>
              </article>
            ))}
          </section>

          <div className="dashboard-grid">
            <section className="panel work-panel" id="work" aria-labelledby="work-title">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Current execution</p>
                  <h3 id="work-title">Priority work</h3>
                </div>
                <a href="#all-work">View all work</a>
              </div>

              <div className="work-list" role="list">
                {workItems.map((item) => (
                  <article className="work-row" key={item.id} role="listitem">
                    <div className="work-main">
                      <span className="work-id">{item.id}</span>
                      <h4>{item.title}</h4>
                      <p>
                        {item.team} <span aria-hidden="true">·</span> {item.owner}
                      </p>
                    </div>
                    <span className={`status status-${item.tone}`}>{item.status}</span>
                    <button type="button" aria-label={`Open ${item.title}`}>
                      →
                    </button>
                  </article>
                ))}
              </div>
            </section>

            <aside className="panel attention-panel" id="attention" aria-labelledby="attention-title">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Exceptions</p>
                  <h3 id="attention-title">Needs attention</h3>
                </div>
              </div>

              <div className="attention-list">
                {attentionItems.map((item) => (
                  <a href="#attention-detail" key={item.label}>
                    <strong>{item.count}</strong>
                    <span>
                      <b>{item.label}</b>
                      <small>{item.detail}</small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </a>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
