'use client';

import Link from 'next/link';
import WorkItemDetail from '../components/work-item-detail';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ENGINEERS,
  PROGRESS_METHOD_LABELS,
  STATUS_LABELS,
  TEAMS,
  type ChecklistStatus,
  type CreateWorkItemInput,
  type ProgressMethod,
  type WorkItem,
  type WorkItemPatch,
  type WorkItemType,
  type WorkPriority,
  type WorkStatus,
} from '../../lib/work-items';
import { defaultWorkDates, dueCopy, formatLiveDateTime, greetingForHour, localDateKey } from '../../lib/local-time';
import { useLiveNow } from '../../lib/use-live-now';
import {
  createWorkItem,
  fetchWorkItems,
  updateWorkItem,
} from '../../lib/work-items-client';
import styles from './engineering.module.css';

type ChecklistDraft = { title: string; assignee: string };

type WorkItemForm = {
  title: string;
  type: WorkItemType;
  team: string;
  owner: string;
  priority: WorkPriority;
  purpose: string;
  expectedResult: string;
  linkedGoal: string;
  start: string;
  due: string;
  progressMethod: ProgressMethod;
  checklist: ChecklistDraft[];
};

function createEmptyForm(currentUserName: string, now = new Date()): WorkItemForm {
  const dates = defaultWorkDates(now);
  return {
    title: '',
    type: 'Task',
    team: 'Propulsion',
    owner: currentUserName,
    priority: 'High',
    purpose: '',
    expectedResult: '',
    linkedGoal: 'Flight readiness baseline',
    ...dates,
    progressMethod: 'checklist-count',
    checklist: [
      { title: '', assignee: currentUserName },
      { title: '', assignee: currentUserName },
    ],
  };
}

const nextStatus: Partial<Record<WorkStatus, WorkStatus>> = {
  captured: 'ready',
  ready: 'active',
  active: 'review',
  review: 'done',
};

const nextStatusLabels: Partial<Record<WorkStatus, string>> = {
  captured: 'Mark ready',
  ready: 'Start work',
  active: 'Send to review',
  review: 'Complete',
};

const checklistStatusLabels: Record<ChecklistStatus, string> = {
  open: 'Open',
  'in-progress': 'In progress',
  done: 'Done',
  blocked: 'Blocked',
};

function dueTone(item: WorkItem, today: string) {
  if (item.health === 'blocked') return 'Blocked';
  return dueCopy(item.due, today);
}

export default function EngineeringWorkspace({
  currentUserName,
  canManage,
}: {
  currentUserName: string;
  canManage: boolean;
}) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<WorkItemForm>(() => createEmptyForm(currentUserName));
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const now = useLiveNow();
  const people = useMemo(
    () => [currentUserName, ...ENGINEERS.filter((name) => name !== currentUserName)],
    [currentUserName],
  );
  const initials = currentUserName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const firstName = currentUserName.split(/\s+/)[0];
  const today = now ? localDateKey(now) : '';
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const closeDetail = useCallback(() => setSelectedItemId(''), []);
  const openFromKeyboard = (event: React.KeyboardEvent, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelectedItemId(id);
    }
  };

  useEffect(() => {
    let active = true;
    void fetchWorkItems()
      .then((workItems) => {
        if (!active) return;
        setItems(workItems);
        setLoadError('');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : 'Work could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!showCreate) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setShowCreate(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [saving, showCreate]);

  const ownedWork = useMemo(
    () => items.filter((item) => item.owner === currentUserName),
    [currentUserName, items],
  );

  const assignedActions = useMemo(
    () =>
      items.flatMap((item) =>
        item.checklist
          .filter(
            (step) => step.assignee === currentUserName && step.status !== 'done',
          )
          .map((step) => ({ item, step })),
      ),
    [currentUserName, items],
  );

  const blockedCount = ownedWork.filter((item) => item.health === 'blocked').length;
  const reviewCount = ownedWork.filter((item) => item.status === 'review').length;

  function openCreateDialog() {
    setForm(createEmptyForm(currentUserName, new Date()));
    setFormError('');
    setNotice('');
    setShowCreate(true);
  }

  function updateChecklistDraft(
    index: number,
    field: keyof ChecklistDraft,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      checklist: current.checklist.map((step, stepIndex) =>
        stepIndex === index ? { ...step, [field]: value } : step,
      ),
    }));
  }

  async function submitWorkItem(
    event: { preventDefault(): void },
    status: 'captured' | 'ready',
  ) {
    event.preventDefault();
    setFormError('');

    if (!form.title.trim() || !form.purpose.trim() || !form.expectedResult.trim()) {
      setFormError('Add a title, purpose, and expected result before creating work.');
      return;
    }
    if (form.due < form.start) {
      setFormError('The due date must be on or after the start date.');
      return;
    }

    const input: CreateWorkItemInput = {
      ...form,
      status,
      createdBy: currentUserName,
      checklist: form.checklist.filter((step) => step.title.trim()),
    };

    try {
      setSaving(true);
      const item = await createWorkItem(input);
      setItems((current) => [item, ...current]);
      setShowCreate(false);
      setNotice(`${item.id} was created and is now visible to management.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The work item could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function advanceWork(item: WorkItem) {
    const status = nextStatus[item.status];
    if (!status) return;
    try {
      setUpdatingId(item.id);
      const updated = await updateWorkItem({ id: item.id, status });
      setItems((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      setNotice(`${item.id} moved to ${STATUS_LABELS[status]}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The update could not be saved.');
    } finally {
      setUpdatingId('');
    }
  }

  async function saveDetailUpdate(patch: WorkItemPatch) {
    const updated = await updateWorkItem(patch);
    setItems((current) =>
      current.map((candidate) => candidate.id === updated.id ? updated : candidate),
    );
    setNotice(`${updated.id} was updated.`);
    return updated;
  }

  async function toggleChecklistStep(
    itemId: string,
    stepId: string,
    currentStatus: ChecklistStatus,
  ) {
    try {
      setUpdatingId(stepId);
      const updated = await updateWorkItem({
        id: itemId,
        checklistStep: {
          id: stepId,
          status: currentStatus === 'done' ? 'open' : 'done',
        },
      });
      setItems((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      setNotice('Checklist progress was updated.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The action could not be updated.');
    } finally {
      setUpdatingId('');
    }
  }

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Engineering navigation">
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">V</span>
          <span>
            <strong>Cosmicport</strong>
            <small>Engineering workspace</small>
          </span>
        </div>

        <nav className={styles.nav}>
          <span className={styles.navLabel}>My workspace</span>
          <a className={styles.navActive} href="#overview" aria-current="page">
            <span aria-hidden="true">◆</span> Today
          </a>
          <a href="#my-work"><span aria-hidden="true">▦</span> My work <b>{ownedWork.length}</b></a>
          <a href="#my-actions"><span aria-hidden="true">✓</span> My actions <b>{assignedActions.length}</b></a>
          <a href="#blocked"><span aria-hidden="true">△</span> Blocked <b>{blockedCount}</b></a>

          <span className={styles.navLabel}>Create</span>
          <button type="button" onClick={openCreateDialog}>
            <span aria-hidden="true">＋</span> New work item
          </button>
          <Link href="/mobile">
            <span aria-hidden="true">▣</span> Mobile companion
          </Link>
        </nav>

        <div className={styles.roleSwitch}>
          <span className={styles.avatar}>{initials}</span>
          <span>
            <strong>{currentUserName}</strong>
            <small>Authenticated engineer</small>
            {canManage ? <Link href="/management">Open management workspace</Link> : null}
          </span>
        </div>
      </aside>

      <section className={styles.workspace} id="overview">
        <header className={styles.topbar}>
          <div>
            <span className={styles.breadcrumb}>Work tracking / Engineering</span>
            <h1>My engineering workspace</h1>
          </div>
          <button className={styles.primaryButton} type="button" onClick={openCreateDialog}>
            <span aria-hidden="true">＋</span> Create work item
          </button>
        </header>

        <div className={styles.content}>
          <section className={styles.hero}>
            <div>
              <span className={styles.eyebrow}>{now ? formatLiveDateTime(now) : 'Local time'}</span>
              <h2>{now ? greetingForHour(now.getHours()) : 'Welcome'}, {firstName}.</h2>
              <p>Own the result, coordinate the actions, and keep delivery visible.</p>
            </div>
            <div className={styles.syncState}>
              <i aria-hidden="true" /> {loadError || 'Shared with management'}
            </div>
          </section>

          {notice ? (
            <div className={styles.notice} role="status">
              <span aria-hidden="true">✓</span> {notice}
              <button type="button" onClick={() => setNotice('')} aria-label="Dismiss message">×</button>
            </div>
          ) : null}

          <section className={styles.metrics} aria-label="Personal work summary">
            <article>
              <span>Owned work</span>
              <strong>{ownedWork.length}</strong>
              <small>Results you are accountable for</small>
            </article>
            <article>
              <span>Assigned actions</span>
              <strong>{assignedActions.length}</strong>
              <small>Across your work and other teams</small>
            </article>
            <article className={blockedCount ? styles.metricWarning : undefined}>
              <span>Blocked</span>
              <strong>{blockedCount}</strong>
              <small>{blockedCount ? 'Needs resolution or escalation' : 'No owned work blocked'}</small>
            </article>
            <article>
              <span>Awaiting review</span>
              <strong>{reviewCount}</strong>
              <small>Results pending closure</small>
            </article>
          </section>

          <div className={styles.mainGrid}>
            <section className={styles.panel} id="my-work" aria-labelledby="my-work-title">
              <header className={styles.panelHeader}>
                <div>
                  <span className={styles.eyebrow}>Accountability</span>
                  <h3 id="my-work-title">My owned work</h3>
                </div>
                <button type="button" onClick={openCreateDialog}>Create new</button>
              </header>

              <div className={styles.workList}>
                {loading ? <p className={styles.emptyState}>Loading your work…</p> : null}
                {!loading && ownedWork.length === 0 ? (
                  <p className={styles.emptyState}>No owned work yet. Create the first work item.</p>
                ) : null}
                {ownedWork.map((item) => {
                  const completedSteps = item.checklist.filter((step) => step.status === 'done').length;
                  return (
                    <article className={styles.workCard} key={item.id} id={item.health === 'blocked' ? 'blocked' : undefined}>
                      <div
                        className={styles.workCardOpen}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open ${item.id}: ${item.title}`}
                        onClick={() => setSelectedItemId(item.id)}
                        onKeyDown={(event) => openFromKeyboard(event, item.id)}
                      >
                        <div className={styles.workMeta}>
                        <span>{item.id}</span>
                        <span className={`${styles.status} ${styles[item.status]}`}>
                          <i aria-hidden="true" /> {STATUS_LABELS[item.status]}
                        </span>
                        <span className={`${styles.due} ${item.health !== 'on-track' ? styles.attention : ''}`}>
                          {dueTone(item, today)}
                        </span>
                      </div>
                      <h4>{item.title}</h4>
                      <p>{item.expectedResult}</p>
                      {item.blocker ? <div className={styles.blocker}><strong>Blocked:</strong> {item.blocker}</div> : null}
                      <div className={styles.progressRow}>
                        <span><i style={{ width: `${item.progress}%` }} /></span>
                        <b>{item.progress}%</b>
                        <small>
                          {item.checklist.length
                            ? `${completedSteps}/${item.checklist.length} actions done`
                            : PROGRESS_METHOD_LABELS[item.progressMethod]}
                        </small>
                      </div>
                      </div>
                      <footer>
                        <span>{item.team} · {item.priority}</span>
                        {nextStatusLabels[item.status] ? (
                          <button
                            type="button"
                            disabled={updatingId === item.id}
                            onClick={() => void advanceWork(item)}
                          >
                            {updatingId === item.id ? 'Saving…' : nextStatusLabels[item.status]}
                            <span aria-hidden="true">→</span>
                          </button>
                        ) : <strong>Completed</strong>}
                      </footer>
                    </article>
                  );
                })}
              </div>
            </section>

            <aside className={styles.actionsPanel} id="my-actions" aria-labelledby="my-actions-title">
              <header className={styles.panelHeader}>
                <div>
                  <span className={styles.eyebrow}>Contribution</span>
                  <h3 id="my-actions-title">My assigned actions</h3>
                </div>
                <span className={styles.actionCount}>{assignedActions.length}</span>
              </header>
              <p className={styles.panelIntro}>
                Checklist actions assigned to you, including work owned by other engineers.
              </p>
              <div className={styles.actionList}>
                {assignedActions.map(({ item, step }) => (
                  <article key={step.id}>
                    <button
                      type="button"
                      className={styles.checkButton}
                      disabled={updatingId === step.id}
                      onClick={() => void toggleChecklistStep(item.id, step.id, step.status)}
                      aria-label={`Mark ${step.title} done`}
                    >
                      {updatingId === step.id ? '…' : ''}
                    </button>
                    <div
                      className={styles.actionOpen}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${item.id}: ${item.title}`}
                      onClick={() => setSelectedItemId(item.id)}
                      onKeyDown={(event) => openFromKeyboard(event, item.id)}
                    >
                      <h4>{step.title}</h4>
                      <p>{item.id} · {item.title}</p>
                      <footer>
                        <span className={`${styles.stepStatus} ${styles[step.status]}`}>
                          {checklistStatusLabels[step.status]}
                        </span>
                        <span>Owner: {item.owner}</span>
                      </footer>
                    </div>
                  </article>
                ))}
                {!loading && assignedActions.length === 0 ? (
                  <p className={styles.emptyState}>You have no open assigned actions.</p>
                ) : null}
              </div>
            </aside>
          </div>
        </div>
      </section>

      {showCreate ? (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setShowCreate(false);
        }}>
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="create-title">
            <header className={styles.dialogHeader}>
              <div>
                <span className={styles.eyebrow}>New engineering result</span>
                <h2 id="create-title">Create work item</h2>
                <p>Define the result first. Add assignable actions only where coordination is needed.</p>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} disabled={saving} aria-label="Close create work item">×</button>
            </header>

            <form className={styles.form} onSubmit={(event) => void submitWorkItem(event, 'ready')}>
              <div className={styles.formSection}>
                <div className={styles.sectionHeading}>
                  <span>1</span>
                  <div><strong>Result</strong><small>What must exist when this is done?</small></div>
                </div>
                <label className={styles.fullField}>
                  <span>Work item title <b>*</b></span>
                  <input autoFocus value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Use a clear, outcome-based title" />
                </label>
                <div className={styles.fieldGrid}>
                  <label>
                    <span>Type</span>
                    <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as WorkItemType }))}>
                      {(['Task', 'Experiment', 'Investigation', 'Review'] as WorkItemType[]).map((type) => <option key={type}>{type}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Priority</span>
                    <select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as WorkPriority }))}>
                      {(['Critical', 'High', 'Medium'] as WorkPriority[]).map((priority) => <option key={priority}>{priority}</option>)}
                    </select>
                  </label>
                </div>
                <label className={styles.fullField}>
                  <span>Purpose — why now? <b>*</b></span>
                  <textarea rows={2} value={form.purpose} onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value }))} placeholder="Explain the decision, risk, or need this work supports" />
                </label>
                <label className={styles.fullField}>
                  <span>Expected result / definition of done <b>*</b></span>
                  <textarea rows={2} value={form.expectedResult} onChange={(event) => setForm((current) => ({ ...current, expectedResult: event.target.value }))} placeholder="Describe the reviewed, verifiable result" />
                </label>
              </div>

              <div className={styles.formSection}>
                <div className={styles.sectionHeading}>
                  <span>2</span>
                  <div><strong>Ownership and schedule</strong><small>One accountable owner, with clear dates.</small></div>
                </div>
                <div className={styles.fieldGrid}>
                  <label>
                    <span>Team</span>
                    <select value={form.team} onChange={(event) => setForm((current) => ({ ...current, team: event.target.value }))}>
                      {TEAMS.map((team) => <option key={team}>{team}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Accountable owner</span>
                    <select value={form.owner} onChange={(event) => setForm((current) => ({ ...current, owner: event.target.value }))}>
                      {people.map((engineer) => <option key={engineer}>{engineer}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Start date</span>
                    <input type="date" value={form.start} onChange={(event) => setForm((current) => ({ ...current, start: event.target.value }))} />
                  </label>
                  <label>
                    <span>Due date</span>
                    <input type="date" value={form.due} onChange={(event) => setForm((current) => ({ ...current, due: event.target.value }))} />
                  </label>
                </div>
                <label className={styles.fullField}>
                  <span>Linked goal</span>
                  <input value={form.linkedGoal} onChange={(event) => setForm((current) => ({ ...current, linkedGoal: event.target.value }))} placeholder="Optional program, milestone, or objective" />
                </label>
              </div>

              <div className={styles.formSection}>
                <div className={styles.sectionHeading}>
                  <span>3</span>
                  <div><strong>Progress and actions</strong><small>Choose how progress is earned and who contributes.</small></div>
                </div>
                <label className={styles.fullField}>
                  <span>Progress method</span>
                  <select value={form.progressMethod} onChange={(event) => setForm((current) => ({ ...current, progressMethod: event.target.value as ProgressMethod }))}>
                    {(Object.entries(PROGRESS_METHOD_LABELS) as Array<[ProgressMethod, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <small className={styles.fieldHint}>Management sees this basis alongside the reported percentage.</small>
                </label>
                <div className={styles.checklistEditor}>
                  <div className={styles.checklistHeader}>
                    <span>Checklist actions</span>
                    <button type="button" onClick={() => setForm((current) => ({ ...current, checklist: [...current.checklist, { title: '', assignee: currentUserName }] }))}>＋ Add action</button>
                  </div>
                  {form.checklist.map((step, index) => (
                    <div className={styles.checklistRow} key={index}>
                      <span>{index + 1}</span>
                      <input value={step.title} onChange={(event) => updateChecklistDraft(index, 'title', event.target.value)} placeholder="Action or handoff" aria-label={`Checklist action ${index + 1}`} />
                      <select value={step.assignee} onChange={(event) => updateChecklistDraft(index, 'assignee', event.target.value)} aria-label={`Assignee for action ${index + 1}`}>
                        {people.map((engineer) => <option key={engineer}>{engineer}</option>)}
                      </select>
                      <button type="button" aria-label={`Remove checklist action ${index + 1}`} onClick={() => setForm((current) => ({ ...current, checklist: current.checklist.filter((_, stepIndex) => stepIndex !== index) }))}>×</button>
                    </div>
                  ))}
                </div>
              </div>

              {formError ? <p className={styles.formError} role="alert">{formError}</p> : null}

              <footer className={styles.dialogFooter}>
                <button className={styles.cancelButton} type="button" onClick={() => setShowCreate(false)} disabled={saving}>Cancel</button>
                <button className={styles.draftButton} type="button" disabled={saving} onClick={(event) => void submitWorkItem(event, 'captured')}>Save as captured</button>
                <button className={styles.createButton} type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create ready item'} <span aria-hidden="true">→</span></button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
      <WorkItemDetail
        key={selectedItem?.id ?? 'closed'}
        item={selectedItem}
        onClose={closeDetail}
        onUpdate={saveDetailUpdate}
        canUpdateStatus={Boolean(selectedItem && (canManage || selectedItem.owner === currentUserName))}
        canUpdateChecklist={(step) => canManage || step.assignee === currentUserName}
        allowAllChecklistStatuses={canManage}
      />
    </main>
  );
}
