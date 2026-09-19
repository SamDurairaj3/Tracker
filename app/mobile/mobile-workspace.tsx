'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import WorkItemDetail from '../components/work-item-detail';
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
} from '../../lib/work-items';
import { calendarDayDifference, defaultWorkDates, formatLiveDateTime, greetingForHour, localDateKey } from '../../lib/local-time';
import { useLiveNow } from '../../lib/use-live-now';
import { createWorkItem, fetchWorkItems, updateWorkItem } from '../../lib/work-items-client';
import styles from './mobile.module.css';

type HomeView = 'home' | 'work' | 'actions' | 'notifications';
type ChecklistDraft = { id: string; title: string; assignee: string };
type MobileDraft = {
  title: string;
  type: WorkItemType;
  purpose: string;
  expectedResult: string;
  team: string;
  owner: string;
  priority: WorkPriority;
  start: string;
  due: string;
  linkedGoal: string;
  progressMethod: ProgressMethod;
  checklist: ChecklistDraft[];
};

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DRAFT_KEY = 'vector-work.mobile.work-card-draft.v1';
let fallbackIdSequence = 0;

/**
 * Generates a non-authoritative client key for checklist draft rows. Older
 * phones and non-secure local network origins may expose Web Crypto without
 * randomUUID, so progressively fall back without changing server IDs.
 */
function createClientDraftId() {
  const browserCrypto = globalThis.crypto;

  if (typeof browserCrypto?.randomUUID === 'function') {
    return browserCrypto.randomUUID();
  }

  if (typeof browserCrypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    browserCrypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
    return `draft-${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }

  fallbackIdSequence += 1;
  return `draft-${Date.now().toString(36)}-${fallbackIdSequence.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function newChecklistStep(currentUserName: string): ChecklistDraft {
  return { id: createClientDraftId(), title: '', assignee: currentUserName };
}

function createEmptyDraft(currentUserName: string, now = new Date()): MobileDraft {
  const dates = defaultWorkDates(now);
  return {
    title: '',
    type: 'Task',
    purpose: '',
    expectedResult: '',
    team: 'Propulsion',
    owner: currentUserName,
    priority: 'High',
    ...dates,
    linkedGoal: 'Flight readiness baseline',
    progressMethod: 'checklist-count',
    checklist: [newChecklistStep(currentUserName)],
  };
}

function hasDraftContent(draft: MobileDraft) {
  return Boolean(
    draft.title.trim() ||
      draft.purpose.trim() ||
      draft.expectedResult.trim() ||
      draft.checklist.some((action) => action.title.trim()),
  );
}

function progressCopy(item: WorkItem) {
  if (item.health === 'blocked') return item.blocker || 'Resolution needed';
  if (item.status === 'review') return 'Awaiting technical closure';
  return `${item.progress}% complete`;
}

export default function MobileWorkspace({ currentUserName }: { currentUserName: string }) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<HomeView>('home');
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<MobileDraft>(() => createEmptyDraft(currentUserName));
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [createdItem, setCreatedItem] = useState<WorkItem | null>(null);
  const [online, setOnline] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [updatingActionId, setUpdatingActionId] = useState('');
  const [actionError, setActionError] = useState('');
  const now = useLiveNow();
  const draftHydrated = useRef(false);
  const people = useMemo(
    () => [currentUserName, ...ENGINEERS.filter((name) => name !== currentUserName)],
    [currentUserName],
  );
  const initials = currentUserName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const firstName = currentUserName.split(/\s+/)[0];

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
  }, [currentUserName]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOnline(navigator.onLine);
      setInstalled(window.matchMedia('(display-mode: standalone)').matches);
      try {
        const savedDraft = window.localStorage.getItem(DRAFT_KEY);
        setDraft(savedDraft
          ? JSON.parse(savedDraft) as MobileDraft
          : createEmptyDraft(currentUserName, new Date()));
      } catch {
        window.localStorage.removeItem(DRAFT_KEY);
      }
      draftHydrated.current = true;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentUserName]);

  useEffect(() => {
    if (!draftHydrated.current) return;
    if (hasDraftContent(draft)) {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } else {
      window.localStorage.removeItem(DRAFT_KEY);
    }
  }, [draft]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, [currentUserName]);

  const ownedWork = useMemo(
    () => items.filter((item) => item.owner === currentUserName && item.status !== 'done'),
    [currentUserName, items],
  );

  const assignedActions = useMemo(
    () => items.flatMap((item) => item.checklist
      .filter((action) => action.assignee === currentUserName)
      .map((action) => ({ item, action }))),
    [currentUserName, items],
  );
  const openAssignedActions = useMemo(
    () => assignedActions.filter(({ action }) => action.status !== 'done'),
    [assignedActions],
  );
  const blockedCount = ownedWork.filter((item) => item.health === 'blocked').length;
  const draftAvailable = hasDraftContent(draft);
  const today = now ? localDateKey(now) : '';
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const closeDetail = useCallback(() => setSelectedItemId(''), []);
  const notifications = useMemo(() => {
    if (!today) return [];
    const signals: Array<{
      key: string;
      item: WorkItem;
      title: string;
      detail: string;
      tone: 'urgent' | 'attention' | 'normal';
    }> = [];

    for (const { item, action } of openAssignedActions) {
      signals.push({
        key: `action:${action.id}`,
        item,
        title: action.status === 'blocked' ? 'Assigned action is blocked' : 'Assigned action is open',
        detail: `${action.title} · ${item.id}`,
        tone: action.status === 'blocked' ? 'urgent' : 'normal',
      });
    }

    for (const item of ownedWork) {
      const days = calendarDayDifference(today, item.due);
      if (item.health === 'blocked') {
        signals.push({ key: `work:${item.id}`, item, title: 'Owned work is blocked', detail: `${item.id} · ${item.title}`, tone: 'urgent' });
      } else if (days !== null && days < 0) {
        signals.push({ key: `work:${item.id}`, item, title: 'Owned work is overdue', detail: `${item.id} · ${item.title}`, tone: 'urgent' });
      } else if (item.health === 'at-risk') {
        signals.push({ key: `work:${item.id}`, item, title: 'Owned work is at risk', detail: `${item.id} · ${item.title}`, tone: 'attention' });
      } else if (item.status === 'review') {
        signals.push({ key: `work:${item.id}`, item, title: 'Ready for your review follow-through', detail: `${item.id} · ${item.title}`, tone: 'attention' });
      } else if (days !== null && days <= 2) {
        signals.push({ key: `work:${item.id}`, item, title: days === 0 ? 'Owned work is due today' : 'Owned work is due soon', detail: `${item.id} · ${item.title}`, tone: 'attention' });
      }
    }

    const rank = { urgent: 0, attention: 1, normal: 2 } as const;
    return signals.sort((first, second) => rank[first.tone] - rank[second.tone]);
  }, [openAssignedActions, ownedWork, today]);

  function startCreate() {
    if (!hasDraftContent(draft)) setDraft(createEmptyDraft(currentUserName, new Date()));
    setView('home');
    setStep(1);
    setCreatedItem(null);
    setFormError('');
    setCreating(true);
  }

  function updateDraft<K extends keyof MobileDraft>(key: K, value: MobileDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateAction(id: string, field: 'title' | 'assignee', value: string) {
    setDraft((current) => ({
      ...current,
      checklist: current.checklist.map((action) =>
        action.id === id ? { ...action, [field]: value } : action,
      ),
    }));
  }

  const saveMobileUpdate = useCallback(async (patch: WorkItemPatch) => {
    const updated = await updateWorkItem(patch);
    setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    return updated;
  }, []);

  async function toggleAssignedAction(itemId: string, stepId: string, status: ChecklistStatus) {
    try {
      setUpdatingActionId(stepId);
      setActionError('');
      await saveMobileUpdate({
        id: itemId,
        checklistStep: { id: stepId, status: status === 'done' ? 'open' : 'done' },
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The action could not be updated.');
    } finally {
      setUpdatingActionId('');
    }
  }

  function openFromKeyboard(event: React.KeyboardEvent, itemId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelectedItemId(itemId);
    }
  }

  function validateStep(currentStep: number) {
    if (
      currentStep === 1 &&
      (!draft.title.trim() || !draft.purpose.trim() || !draft.expectedResult.trim())
    ) {
      return 'Add an outcome title, why it matters, and the expected result.';
    }
    if (currentStep === 2 && draft.due < draft.start) {
      return 'The due date must be on or after the start date.';
    }
    if (
      currentStep === 3 &&
      ['checklist-count', 'weighted-checklist'].includes(draft.progressMethod) &&
      !draft.checklist.some((action) => action.title.trim())
    ) {
      return 'Add at least one action for checklist-based progress.';
    }
    return '';
  }

  function continueCreate() {
    const error = validateStep(step);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError('');
    setStep((current) => Math.min(4, current + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submitWorkItem(status: 'captured' | 'ready') {
    const validationError = validateStep(1) || validateStep(2) || validateStep(3);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    if (!online) {
      setFormError('You are offline. Your draft is safe on this device; reconnect to create it.');
      return;
    }

    const input: CreateWorkItemInput = {
      title: draft.title,
      type: draft.type,
      purpose: draft.purpose,
      expectedResult: draft.expectedResult,
      team: draft.team,
      owner: draft.owner,
      priority: draft.priority,
      start: draft.start,
      due: draft.due,
      linkedGoal: draft.linkedGoal,
      progressMethod: draft.progressMethod,
      checklist: draft.checklist
        .filter((action) => action.title.trim())
        .map(({ title, assignee }) => ({ title, assignee })),
      status,
      createdBy: currentUserName,
    };

    try {
      setSaving(true);
      setFormError('');
      const item = await createWorkItem(input);
      setItems((current) => [item, ...current]);
      setCreatedItem(item);
      window.localStorage.removeItem(DRAFT_KEY);
      setDraft(createEmptyDraft(currentUserName, new Date()));
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'The work card could not be created. Your draft is still saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setInstallPrompt(null);
  }

  if (creating) {
    return (
      <main className={styles.mobileShell}>
        <section className={styles.createFlow}>
          {createdItem ? (
            <SuccessState
              item={createdItem}
              onDone={() => {
                setCreating(false);
                setView('work');
              }}
              onCreateAnother={() => {
                setCreatedItem(null);
                setStep(1);
              }}
            />
          ) : (
            <>
              <header className={styles.flowHeader}>
                <button type="button" onClick={() => setCreating(false)} aria-label="Close and keep draft">×</button>
                <div>
                  <span>Step {step} of 4</span>
                  <strong>{['Outcome', 'Ownership', 'Actions', 'Review'][step - 1]}</strong>
                </div>
                <span className={`${styles.connectionBadge} ${online ? '' : styles.offline}`}>
                  <i /> {online ? 'Online' : 'Offline'}
                </span>
              </header>
              <div className={styles.stepProgress} aria-label={`Step ${step} of 4`}>
                <i style={{ width: `${step * 25}%` }} />
              </div>

              <div className={styles.formBody}>
                {step === 1 ? <OutcomeStep draft={draft} updateDraft={updateDraft} /> : null}
                {step === 2 ? <OwnershipStep draft={draft} updateDraft={updateDraft} people={people} /> : null}
                {step === 3 ? (
                  <ActionsStep draft={draft} updateDraft={updateDraft} updateAction={updateAction} people={people} currentUserName={currentUserName} />
                ) : null}
                {step === 4 ? <ReviewStep draft={draft} /> : null}

                {formError ? <p className={styles.formError} role="alert">{formError}</p> : null}
                <p className={styles.draftStatus}>✓ Draft saved on this device</p>
              </div>

              <footer className={styles.flowFooter}>
                {step > 1 ? (
                  <button className={styles.backButton} type="button" onClick={() => {
                    setFormError('');
                    setStep((current) => current - 1);
                  }}>Back</button>
                ) : (
                  <button className={styles.backButton} type="button" onClick={() => setCreating(false)}>Close</button>
                )}
                {step < 4 ? (
                  <button className={styles.continueButton} type="button" onClick={continueCreate}>
                    Continue <span aria-hidden="true">→</span>
                  </button>
                ) : (
                  <div className={styles.submitButtons}>
                    <button type="button" disabled={saving || !online} onClick={() => void submitWorkItem('captured')}>Save captured</button>
                    <button type="button" disabled={saving || !online} onClick={() => void submitWorkItem('ready')}>
                      {saving ? 'Creating…' : 'Create ready'} <span aria-hidden="true">→</span>
                    </button>
                  </div>
                )}
              </footer>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className={styles.mobileShell} id="home">
      <header className={styles.appHeader}>
        <div className={styles.brandMark}>V</div>
        <div className={styles.brandCopy}>
          <strong>Vector Work</strong>
          <span>Cosmicport · Engineering</span>
        </div>
        <div className={styles.avatar}>{initials}</div>
      </header>

      {!online ? (
        <div className={styles.offlineBanner} role="status">
          <span>Offline</span> This open screen and your device draft remain available. Live work and creating require a connection.
        </div>
      ) : null}

      <section className={styles.home}>
        {view === 'home' ? (
          <>
            <div className={styles.greeting}>
              <span>{now ? formatLiveDateTime(now) : 'Local time'}</span>
              <h1>{now ? greetingForHour(now.getHours()) : 'Welcome'}, {firstName}.</h1>
            </div>

            <button className={styles.createButton} type="button" onClick={startCreate}>
              <span>＋</span>
              <div>
                <strong>{draftAvailable ? 'Continue work card' : 'Create work card'}</strong>
                <small>{draftAvailable ? 'Your device draft is waiting' : 'Capture an outcome while it is fresh'}</small>
              </div>
              <b>›</b>
            </button>

            {installPrompt && !installed ? (
              <button className={styles.installCard} type="button" onClick={() => void installApp()}>
                <span aria-hidden="true">⇩</span>
                <div><strong>Install on this device</strong><small>Open Vector Work like an app, even with a weak connection.</small></div>
                <b>Install</b>
              </button>
            ) : null}

            <div className={styles.summaryRow}>
              <article><strong>{ownedWork.length}</strong><span>Owned work</span></article>
              <article><strong>{openAssignedActions.length}</strong><span>Open actions</span></article>
              <article><strong>{blockedCount}</strong><span>Blocked</span></article>
            </div>

            <WorkList items={ownedWork.slice(0, 3)} loading={loading} error={loadError} title="My work" suffix={`${ownedWork.length} active`} onOpen={setSelectedItemId} />
          </>
        ) : null}

        {view === 'work' ? (
          <>
            <ScreenHeading eyebrow="Accountability" title="My owned work" description="Results you are accountable for delivering." />
            <WorkList items={ownedWork} loading={loading} error={loadError} onOpen={setSelectedItemId} />
          </>
        ) : null}

        {view === 'actions' ? (
          <>
            <ScreenHeading eyebrow="Contribution" title="My assigned actions" description="Complete or reopen actions assigned to you across every team." />
            {actionError ? <p className={styles.actionError} role="alert">{actionError}</p> : null}
            <section className={styles.actionList} id="actions">
              {assignedActions.map(({ item, action }) => (
                <article key={action.id} className={action.status === 'done' ? styles.actionDone : undefined}>
                  <button
                    type="button"
                    className={styles.actionToggle}
                    disabled={updatingActionId === action.id}
                    aria-pressed={action.status === 'done'}
                    aria-label={`${action.status === 'done' ? 'Reopen' : 'Complete'} ${action.title}`}
                    onClick={() => void toggleAssignedAction(item.id, action.id, action.status)}
                  >
                    {updatingActionId === action.id ? '…' : action.status === 'done' ? '✓' : ''}
                  </button>
                  <div
                    className={styles.actionOpen}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${item.id}: ${item.title}`}
                    onClick={() => setSelectedItemId(item.id)}
                    onKeyDown={(event) => openFromKeyboard(event, item.id)}
                  >
                    <h2>{action.title}</h2>
                    <p>{item.id} · {item.title}</p>
                    <footer><span>{action.status.replace('-', ' ')}</span><span>Owner · {item.owner}</span></footer>
                  </div>
                </article>
              ))}
              {!loading && !assignedActions.length ? <EmptyState copy="No actions are assigned to you." /> : null}
            </section>
          </>
        ) : null}

        {view === 'notifications' ? (
          <>
            <ScreenHeading eyebrow="Live attention" title="Notifications" description="Derived from current work and assignments. Nothing here is a fake unread or push notification." />
            <section className={styles.notificationList} aria-label="Current work attention">
              {notifications.map((signal) => (
                <button key={signal.key} type="button" onClick={() => setSelectedItemId(signal.item.id)}>
                  <span className={`${styles.notificationMark} ${styles[signal.tone]}`} aria-hidden="true">!</span>
                  <span className={styles.notificationCopy}>
                    <strong>{signal.title}</strong>
                    <small>{signal.detail}</small>
                  </span>
                  <span className={styles.notificationArrow} aria-hidden="true">›</span>
                </button>
              ))}
              {!loading && !notifications.length ? (
                <EmptyState copy="Nothing currently needs your attention. This feed updates from live work status, dates, and assignments." />
              ) : null}
            </section>
          </>
        ) : null}
      </section>

      <nav className={styles.bottomNav} aria-label="Mobile navigation">
        <button className={view === 'home' ? styles.activeNav : ''} type="button" onClick={() => setView('home')}><span>⌂</span><small>Home</small></button>
        <button className={view === 'work' ? styles.activeNav : ''} type="button" onClick={() => setView('work')}><span>▤</span><small>My work</small></button>
        <button className={styles.floatingCreate} type="button" onClick={startCreate} aria-label="Create work card"><span>＋</span></button>
        <button className={view === 'actions' ? styles.activeNav : ''} type="button" onClick={() => setView('actions')}><span>✓</span><small>Actions</small></button>
        <button className={view === 'notifications' ? styles.activeNav : ''} type="button" onClick={() => setView('notifications')} aria-label="Notifications">
          <span aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg></span>
          <small>Notifications</small>
        </button>
      </nav>
      <WorkItemDetail
        key={selectedItem?.id ?? 'closed'}
        item={selectedItem}
        onClose={closeDetail}
        onUpdate={saveMobileUpdate}
        canUpdateStatus={Boolean(selectedItem?.owner === currentUserName)}
        canUpdateChecklist={(step) => step.assignee === currentUserName}
      />
    </main>
  );
}

function ScreenHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className={styles.screenHeading}><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></header>;
}

function WorkList({ items, loading, error, title, suffix, onOpen }: { items: WorkItem[]; loading: boolean; error: string; title?: string; suffix?: string; onOpen: (id: string) => void }) {
  return (
    <section className={styles.workSection} id="work">
      {title ? <header><h2>{title}</h2><span>{suffix}</span></header> : null}
      <div className={styles.cardList}>
        {items.map((item) => (
          <article
            className={styles.workCard}
            key={item.id}
            role="button"
            tabIndex={0}
            aria-label={`Open ${item.id}: ${item.title}`}
            onClick={() => onOpen(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen(item.id);
              }
            }}
          >
            <div className={styles.cardMeta}><span>{item.id}</span><b className={styles[item.status]}>{STATUS_LABELS[item.status]}</b></div>
            <h3>{item.title}</h3>
            {item.health === 'blocked' ? <p className={styles.blockedCopy}>Blocked · {progressCopy(item)}</p> : null}
            <div className={styles.progress}><i style={{ width: `${item.progress}%` }} /></div>
            <footer><span>{progressCopy(item)}</span><time dateTime={item.due}>Due {item.dueLabel}</time></footer>
          </article>
        ))}
        {loading ? <EmptyState copy="Loading your work…" /> : null}
        {!loading && error ? <EmptyState copy={error} /> : null}
        {!loading && !error && !items.length ? <EmptyState copy="No active work assigned to you." /> : null}
      </div>
    </section>
  );
}

function EmptyState({ copy }: { copy: string }) {
  return <p className={styles.emptyState}>{copy}</p>;
}

type StepProps = {
  draft: MobileDraft;
  updateDraft: <K extends keyof MobileDraft>(key: K, value: MobileDraft[K]) => void;
};

function OutcomeStep({ draft, updateDraft }: StepProps) {
  return (
    <section className={styles.formStep}>
      <p className={styles.kicker}>New work card</p><h1>What needs to be true when this work is done?</h1>
      <p className={styles.stepIntro}>Name the result, not just the activity. Management will see this wording.</p>
      <label><span>Outcome title <b>*</b></span><input autoFocus value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} placeholder="Qualify the revised injector seal" /></label>
      <label><span>Work type</span><select value={draft.type} onChange={(event) => updateDraft('type', event.target.value as WorkItemType)}>{(['Task', 'Experiment', 'Investigation', 'Review'] as WorkItemType[]).map((type) => <option key={type}>{type}</option>)}</select></label>
      <label><span>Why does this matter now? <b>*</b></span><textarea rows={4} value={draft.purpose} onChange={(event) => updateDraft('purpose', event.target.value)} placeholder="Decision, risk, or milestone this work supports" /></label>
      <label><span>Expected result <b>*</b></span><textarea rows={4} value={draft.expectedResult} onChange={(event) => updateDraft('expectedResult', event.target.value)} placeholder="The reviewed, verifiable result that marks this done" /></label>
    </section>
  );
}

function OwnershipStep({ draft, updateDraft, people }: StepProps & { people: string[] }) {
  return (
    <section className={styles.formStep}>
      <p className={styles.kicker}>Accountability</p><h1>Who owns the result, and when is it needed?</h1>
      <p className={styles.stepIntro}>The owner remains accountable even when actions are assigned to others.</p>
      <div className={styles.twoFields}>
        <label><span>Engineering team</span><select value={draft.team} onChange={(event) => updateDraft('team', event.target.value)}>{TEAMS.map((team) => <option key={team}>{team}</option>)}</select></label>
        <label><span>Priority</span><select value={draft.priority} onChange={(event) => updateDraft('priority', event.target.value as WorkPriority)}>{(['Critical', 'High', 'Medium'] as WorkPriority[]).map((priority) => <option key={priority}>{priority}</option>)}</select></label>
      </div>
      <label><span>Accountable owner</span><select value={draft.owner} onChange={(event) => updateDraft('owner', event.target.value)}>{people.map((engineer) => <option key={engineer}>{engineer}</option>)}</select><small>One person owns the integrated result.</small></label>
      <div className={styles.twoFields}>
        <label><span>Start date</span><input type="date" value={draft.start} onChange={(event) => updateDraft('start', event.target.value)} /></label>
        <label><span>Due date</span><input type="date" value={draft.due} onChange={(event) => updateDraft('due', event.target.value)} /></label>
      </div>
      <label><span>Linked goal <small>Optional</small></span><input value={draft.linkedGoal} onChange={(event) => updateDraft('linkedGoal', event.target.value)} placeholder="Flight readiness baseline" /></label>
    </section>
  );
}

function ActionsStep({ draft, updateDraft, updateAction, people, currentUserName }: StepProps & { updateAction: (id: string, field: 'title' | 'assignee', value: string) => void; people: string[]; currentUserName: string }) {
  return (
    <section className={styles.formStep}>
      <p className={styles.kicker}>Coordination</p><h1>How will progress be earned?</h1>
      <p className={styles.stepIntro}>Actions can have different assignees. Keep one owner for the overall result.</p>
      <label><span>Progress method</span><select value={draft.progressMethod} onChange={(event) => updateDraft('progressMethod', event.target.value as ProgressMethod)}>{(Object.entries(PROGRESS_METHOD_LABELS) as Array<[ProgressMethod, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className={styles.actionsEditor}>
        <header><div><strong>Checklist actions</strong><small>Assign each handoff clearly.</small></div><button type="button" onClick={() => updateDraft('checklist', [...draft.checklist, newChecklistStep(currentUserName)])}>＋ Add</button></header>
        {draft.checklist.map((action, index) => (
          <article key={action.id}>
            <div className={styles.actionNumber}>{index + 1}</div>
            <div>
              <label><span>Action</span><input value={action.title} onChange={(event) => updateAction(action.id, 'title', event.target.value)} placeholder="Run three thermal cycles" /></label>
              <label><span>Assigned to</span><select value={action.assignee} onChange={(event) => updateAction(action.id, 'assignee', event.target.value)}>{people.map((engineer) => <option key={engineer}>{engineer}</option>)}</select></label>
            </div>
            <button type="button" aria-label={`Remove action ${index + 1}`} onClick={() => updateDraft('checklist', draft.checklist.filter((candidate) => candidate.id !== action.id))}>×</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function ReviewStep({ draft }: { draft: MobileDraft }) {
  const actions = draft.checklist.filter((action) => action.title.trim());
  return (
    <section className={styles.formStep}>
      <p className={styles.kicker}>Final check</p><h1>Review the work card</h1>
      <p className={styles.stepIntro}>Create it as ready when the result is clear enough to begin, or keep it captured for triage.</p>
      <article className={styles.reviewHero}><div><span>{draft.type}</span><b>{draft.priority}</b></div><h2>{draft.title}</h2><p>{draft.expectedResult}</p></article>
      <dl className={styles.reviewDetails}>
        <div><dt>Owner</dt><dd>{draft.owner}</dd></div><div><dt>Team</dt><dd>{draft.team}</dd></div><div><dt>Dates</dt><dd>{draft.start} → {draft.due}</dd></div><div><dt>Progress</dt><dd>{PROGRESS_METHOD_LABELS[draft.progressMethod]}</dd></div>{draft.linkedGoal ? <div><dt>Goal</dt><dd>{draft.linkedGoal}</dd></div> : null}
      </dl>
      <section className={styles.reviewActions}><header><strong>{actions.length} assigned action{actions.length === 1 ? '' : 's'}</strong></header>{actions.map((action) => <div key={action.id}><span>○</span><p><strong>{action.title}</strong><small>{action.assignee}</small></p></div>)}</section>
    </section>
  );
}

function SuccessState({ item, onDone, onCreateAnother }: { item: WorkItem; onDone: () => void; onCreateAnother: () => void }) {
  return (
    <section className={styles.successState}>
      <div className={styles.confetti} aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</div>
      <div className={styles.successMark}>✓</div><p>Work card created</p><h1>{item.id} is visible to management.</h1>
      <article><span>{STATUS_LABELS[item.status]}</span><h2>{item.title}</h2><p>{item.owner} · {item.team}</p></article>
      <button type="button" onClick={onDone}>View my work <span>→</span></button><button type="button" onClick={onCreateAnother}>Create another</button>
    </section>
  );
}
