'use client';

import { useEffect, useRef, useState } from 'react';
import { formatDateTime } from '../../lib/local-time';
import {
  CHECKLIST_STATUSES,
  PROGRESS_METHOD_LABELS,
  STATUS_LABELS,
  TEAMS,
  WORK_STATUSES,
  type ChecklistStep,
  type ProgressMethod,
  type WorkItem,
  type WorkItemActivity,
  type WorkItemEditInput,
  type WorkItemPatch,
  type WorkItemType,
  type WorkPriority,
  type WorkStatus,
} from '../../lib/work-items';
import {
  addWorkItemComment,
  fetchWorkItemActivity,
} from '../../lib/work-items-client';
import styles from './work-item-detail.module.css';

const healthLabels = {
  'on-track': 'On track',
  'at-risk': 'At risk',
  blocked: 'Blocked',
} as const;

const checklistLabels = {
  open: 'Open',
  'in-progress': 'In progress',
  done: 'Done',
  blocked: 'Blocked',
} as const;

const activityLabels: Record<WorkItemActivity['type'], string> = {
  comment: 'Comment',
  created: 'Created',
  edited: 'Edit',
  workflow: 'Workflow',
  checklist: 'Checklist',
  archived: 'Archived',
  restored: 'Restored',
};

type Props = {
  item: WorkItem | null;
  people: string[];
  onClose: () => void;
  onUpdate: (patch: WorkItemPatch) => Promise<WorkItem>;
  onEdit: (input: WorkItemEditInput) => Promise<WorkItem>;
  onArchive: (archived: boolean) => Promise<WorkItem>;
  onDelete: (confirmation: string) => Promise<void>;
  canUpdateStatus: boolean;
  canUpdateChecklist: (step: ChecklistStep) => boolean;
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  allowAllChecklistStatuses?: boolean;
};

function editDraft(item: WorkItem): WorkItemEditInput {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    team: item.team,
    owner: item.owner,
    priority: item.priority,
    purpose: item.purpose,
    expectedResult: item.expectedResult,
    linkedGoal: item.linkedGoal ?? '',
    start: item.start,
    due: item.due,
    progressMethod: item.progressMethod,
    progress: item.progress,
    checklist: item.checklist.map((step) => ({
      id: step.id,
      title: step.title,
      assignee: step.assignee,
      weight: step.weight,
    })),
  };
}

export default function WorkItemDetail({
  item,
  people,
  onClose,
  onUpdate,
  onEdit,
  onArchive,
  onDelete,
  canUpdateStatus,
  canUpdateChecklist,
  canEdit,
  canArchive,
  canDelete,
  allowAllChecklistStatuses = false,
}: Props) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [savingKey, setSavingKey] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WorkItemEditInput | null>(item ? editDraft(item) : null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState<WorkItemActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [comment, setComment] = useState('');
  const [commentStepId, setCommentStepId] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const itemId = item?.id;

  useEffect(() => {
    if (!itemId) return;
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingKey) onClose();
    };
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', closeOnEscape);
      previous?.focus();
    };
  }, [itemId, onClose, savingKey]);

  useEffect(() => {
    setDraft(item ? editDraft(item) : null);
  }, [item]);

  if (!item) return null;

  const activityCount = activity.length
    ? Math.max(item.activityCount, activity.length)
    : item.activityCount;
  const latestActivityAt = activity.at(-1)?.createdAt ?? item.latestActivityAt;
  const personOptions = Array.from(new Set([
    item.owner,
    ...item.checklist.map((step) => step.assignee),
    ...people,
  ])).filter(Boolean);

  async function loadActivity() {
    try {
      setActivityLoading(true);
      setActivityError('');
      setActivity(await fetchWorkItemActivity(itemId!));
    } catch (loadError) {
      setActivityError(loadError instanceof Error ? loadError.message : 'Activity could not be loaded.');
    } finally {
      setActivityLoading(false);
    }
  }

  async function toggleActivity() {
    const next = !activityOpen;
    setActivityOpen(next);
    if (next && activity.length === 0) await loadActivity();
  }

  async function save(patch: WorkItemPatch, key: string) {
    try {
      setSavingKey(key);
      setError('');
      await onUpdate(patch);
      if (activityOpen) await loadActivity();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'The update could not be saved.');
    } finally {
      setSavingKey('');
    }
  }

  async function submitEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    try {
      setSavingKey('edit');
      setError('');
      const updated = await onEdit(draft);
      setDraft(editDraft(updated));
      setEditing(false);
      if (activityOpen) await loadActivity();
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : 'The edit could not be saved.');
    } finally {
      setSavingKey('');
    }
  }

  async function changeArchiveState() {
    try {
      setSavingKey('archive');
      setError('');
      await onArchive(!item?.archivedAt);
      setEditing(false);
      setDeleteOpen(false);
      if (activityOpen) await loadActivity();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'The lifecycle change could not be saved.');
    } finally {
      setSavingKey('');
    }
  }

  async function submitComment(event: React.FormEvent) {
    event.preventDefault();
    const body = comment.trim();
    if (!body) return;
    try {
      setSavingKey('comment');
      setActivityError('');
      const entry = await addWorkItemComment(itemId!, body, commentStepId || undefined);
      setActivity((current) => [...current, entry]);
      setComment('');
      setCommentStepId('');
    } catch (commentError) {
      setActivityError(commentError instanceof Error ? commentError.message : 'The comment could not be saved.');
    } finally {
      setSavingKey('');
    }
  }

  async function confirmDelete() {
    try {
      setSavingKey('delete');
      setError('');
      await onDelete(deleteConfirmation);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'The work item could not be deleted.');
      setSavingKey('');
    }
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !savingKey) onClose();
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="work-item-detail-title"
      >
        <header className={styles.header}>
          <div>
            <span>{item.id} · {item.type}</span>
            <h2 id="work-item-detail-title">{item.title}</h2>
          </div>
          <button
            ref={closeButton}
            type="button"
            aria-label="Close work item details"
            disabled={Boolean(savingKey)}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className={styles.body}>
          {item.archivedAt ? (
            <div className={styles.archivedBanner} role="status">
              <strong>Archived</strong>
              <span>
                {item.archivedByName ? ` by ${item.archivedByName}` : ''}
                {' · '}{formatDateTime(item.archivedAt)}
              </span>
              <small>This work item is read-only until it is restored.</small>
            </div>
          ) : null}

          <div className={styles.badges}>
            <span className={styles[item.status]}>{STATUS_LABELS[item.status]}</span>
            <span className={styles[item.health]}>{healthLabels[item.health]}</span>
            <span>{item.priority} priority</span>
            {item.archivedAt ? <span className={styles.archiveBadge}>Archived</span> : null}
          </div>

          <div className={styles.itemActions} aria-label="Work-item actions">
            {canEdit && !item.archivedAt ? (
              <button type="button" onClick={() => setEditing((current) => !current)} disabled={Boolean(savingKey)}>
                {editing ? 'Cancel edit' : 'Edit card'}
              </button>
            ) : null}
            {canArchive ? (
              <button type="button" onClick={() => void changeArchiveState()} disabled={Boolean(savingKey)}>
                {savingKey === 'archive' ? 'Saving…' : item.archivedAt ? 'Restore card' : 'Archive card'}
              </button>
            ) : null}
            {canDelete && item.archivedAt ? (
              <button className={styles.dangerAction} type="button" onClick={() => setDeleteOpen(true)} disabled={Boolean(savingKey)}>
                Delete permanently
              </button>
            ) : null}
          </div>

          {deleteOpen ? (
            <section className={styles.deletePanel} aria-labelledby="delete-card-title">
              <h3 id="delete-card-title">Permanently delete {item.id}</h3>
              <p>This removes the card, checklist, and complete activity history. Type <strong>{item.id}</strong> to continue.</p>
              <label>
                <span>Confirmation</span>
                <input
                  value={deleteConfirmation}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <div>
                <button type="button" onClick={() => setDeleteOpen(false)} disabled={Boolean(savingKey)}>Cancel</button>
                <button
                  className={styles.deleteButton}
                  type="button"
                  onClick={() => void confirmDelete()}
                  disabled={deleteConfirmation !== item.id || Boolean(savingKey)}
                >
                  {savingKey === 'delete' ? 'Deleting…' : 'Delete permanently'}
                </button>
              </div>
            </section>
          ) : null}

          {error ? <p className={styles.error} role="alert">{error}</p> : null}

          {editing && draft ? (
            <form className={styles.editForm} onSubmit={(event) => void submitEdit(event)}>
              <div className={styles.editGrid}>
                <label className={styles.fullField}>
                  <span>Title</span>
                  <input required maxLength={500} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
                </label>
                <label>
                  <span>Type</span>
                  <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as WorkItemType })}>
                    {(['Task', 'Experiment', 'Investigation', 'Review'] as WorkItemType[]).map((type) => <option key={type}>{type}</option>)}
                  </select>
                </label>
                <label>
                  <span>Priority</span>
                  <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as WorkPriority })}>
                    {(['Critical', 'High', 'Medium'] as WorkPriority[]).map((priority) => <option key={priority}>{priority}</option>)}
                  </select>
                </label>
                <label>
                  <span>Team</span>
                  <select value={draft.team} onChange={(event) => setDraft({ ...draft, team: event.target.value })}>
                    {TEAMS.map((team) => <option key={team}>{team}</option>)}
                  </select>
                </label>
                <label>
                  <span>Owner</span>
                  <select value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })}>
                    {personOptions.map((person) => <option key={person}>{person}</option>)}
                  </select>
                </label>
                <label>
                  <span>Start date</span>
                  <input required type="date" value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
                </label>
                <label>
                  <span>Due date</span>
                  <input required type="date" value={draft.due} onChange={(event) => setDraft({ ...draft, due: event.target.value })} />
                </label>
                <label className={styles.fullField}>
                  <span>Purpose</span>
                  <textarea required maxLength={4000} rows={3} value={draft.purpose} onChange={(event) => setDraft({ ...draft, purpose: event.target.value })} />
                </label>
                <label className={styles.fullField}>
                  <span>Expected result</span>
                  <textarea required maxLength={4000} rows={3} value={draft.expectedResult} onChange={(event) => setDraft({ ...draft, expectedResult: event.target.value })} />
                </label>
                <label className={styles.fullField}>
                  <span>Linked goal</span>
                  <input value={draft.linkedGoal ?? ''} onChange={(event) => setDraft({ ...draft, linkedGoal: event.target.value })} />
                </label>
                <label className={styles.fullField}>
                  <span>Progress method</span>
                  <select value={draft.progressMethod} onChange={(event) => setDraft({ ...draft, progressMethod: event.target.value as ProgressMethod })}>
                    {(Object.entries(PROGRESS_METHOD_LABELS) as Array<[ProgressMethod, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                {draft.progressMethod === 'manual-estimate' ? (
                  <label className={styles.fullField}>
                    <span>Manual progress: {draft.progress ?? 0}%</span>
                    <input type="range" min="0" max="100" value={draft.progress ?? 0} onChange={(event) => setDraft({ ...draft, progress: Number(event.target.value) })} />
                  </label>
                ) : null}
              </div>

              <section className={styles.editChecklist} aria-labelledby="edit-checklist-title">
                <header>
                  <div>
                    <h3 id="edit-checklist-title">Checklist actions</h3>
                    <p>Existing action IDs remain stable when titles or assignees change.</p>
                  </div>
                  <button type="button" onClick={() => setDraft({
                    ...draft,
                    checklist: [...draft.checklist, { title: '', assignee: draft.owner, weight: 1 }],
                  })}>＋ Add action</button>
                </header>
                {draft.checklist.map((step, index) => (
                  <div className={styles.editChecklistRow} key={step.id ?? `new-${index}`}>
                    <span>{index + 1}</span>
                    <input
                      required
                      maxLength={500}
                      aria-label={`Checklist action ${index + 1}`}
                      value={step.title}
                      onChange={(event) => setDraft({
                        ...draft,
                        checklist: draft.checklist.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, title: event.target.value } : candidate),
                      })}
                    />
                    <select
                      aria-label={`Assignee for checklist action ${index + 1}`}
                      value={step.assignee}
                      onChange={(event) => setDraft({
                        ...draft,
                        checklist: draft.checklist.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, assignee: event.target.value } : candidate),
                      })}
                    >
                      {personOptions.map((person) => <option key={person}>{person}</option>)}
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove checklist action ${index + 1}`}
                      onClick={() => setDraft({ ...draft, checklist: draft.checklist.filter((_, candidateIndex) => candidateIndex !== index) })}
                    >×</button>
                  </div>
                ))}
                {draft.checklist.length === 0 ? <p className={styles.empty}>No checklist actions.</p> : null}
              </section>
              <footer className={styles.editFooter}>
                <button type="button" onClick={() => {
                  setDraft(editDraft(item));
                  setEditing(false);
                }} disabled={Boolean(savingKey)}>Cancel</button>
                <button className={styles.primaryAction} type="submit" disabled={Boolean(savingKey)}>
                  {savingKey === 'edit' ? 'Saving…' : 'Save card'}
                </button>
              </footer>
            </form>
          ) : (
            <>
              {canUpdateStatus && !item.archivedAt ? (
                <label className={styles.statusControl}>
                  <span>Workflow status</span>
                  <select
                    value={item.status}
                    disabled={Boolean(savingKey)}
                    onChange={(event) => void save(
                      { id: item.id, status: event.target.value as WorkStatus },
                      'status',
                    )}
                  >
                    {WORK_STATUSES.map((status) => (
                      <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                    ))}
                  </select>
                  <small>{savingKey === 'status' ? 'Saving status…' : 'Changes save immediately.'}</small>
                </label>
              ) : null}

              {savingKey.startsWith('step:') ? <p className={styles.saving} role="status">Saving checklist…</p> : null}

              <section className={styles.narrative} aria-label="Outcome definition">
                <div>
                  <h3>Purpose</h3>
                  <p>{item.purpose}</p>
                </div>
                <div>
                  <h3>Expected result</h3>
                  <p>{item.expectedResult}</p>
                </div>
                {item.blocker ? (
                  <div className={styles.blocker}>
                    <h3>Blocker</h3>
                    <p>{item.blocker}</p>
                  </div>
                ) : null}
              </section>

              <dl className={styles.facts}>
                <div><dt>Team</dt><dd>{item.team}</dd></div>
                <div><dt>Owner</dt><dd>{item.owner}</dd></div>
                <div><dt>Start</dt><dd>{item.start}</dd></div>
                <div><dt>Due</dt><dd>{item.due}</dd></div>
                <div><dt>Progress</dt><dd>{item.progress}%</dd></div>
                <div><dt>Progress method</dt><dd>{PROGRESS_METHOD_LABELS[item.progressMethod]}</dd></div>
                <div><dt>Linked goal</dt><dd>{item.linkedGoal || 'None'}</dd></div>
                <div><dt>Created by</dt><dd>{item.createdBy}</dd></div>
                <div><dt>Created</dt><dd>{formatDateTime(item.createdAt)}</dd></div>
                <div><dt>Updated</dt><dd>{formatDateTime(item.updatedAt)}</dd></div>
              </dl>

              <section className={styles.checklist} aria-labelledby="detail-checklist-title">
                <header>
                  <div>
                    <h3 id="detail-checklist-title">Checklist</h3>
                    <p>{item.checklist.length} action{item.checklist.length === 1 ? '' : 's'}</p>
                  </div>
                  <strong>{item.checklist.filter((step) => step.status === 'done').length}/{item.checklist.length}</strong>
                </header>
                {item.checklist.length ? item.checklist.map((step) => {
                  const editable = !item.archivedAt && canUpdateChecklist(step);
                  const key = `step:${step.id}`;
                  return (
                    <article
                      key={step.id}
                      className={`${step.status === 'done' ? styles.completed : ''} ${allowAllChecklistStatuses ? styles.withSelect : ''}`}
                    >
                      {editable ? allowAllChecklistStatuses ? (
                        <select
                          className={styles.checkSelect}
                          value={step.status}
                          disabled={Boolean(savingKey)}
                          aria-label={`Status for ${step.title}`}
                          onChange={(event) => void save({
                            id: item.id,
                            checklistStep: {
                              id: step.id,
                              status: event.target.value as ChecklistStep['status'],
                            },
                          }, key)}
                        >
                          {CHECKLIST_STATUSES.map((status) => (
                            <option key={status} value={status}>{checklistLabels[status]}</option>
                          ))}
                        </select>
                      ) : (
                        <button
                          type="button"
                          className={styles.checkButton}
                          disabled={Boolean(savingKey)}
                          aria-label={`${step.status === 'done' ? 'Reopen' : 'Complete'} ${step.title}`}
                          onClick={() => void save({
                            id: item.id,
                            checklistStep: {
                              id: step.id,
                              status: step.status === 'done' ? 'open' : 'done',
                            },
                          }, key)}
                        >
                          {savingKey === key ? '…' : step.status === 'done' ? '✓' : ''}
                        </button>
                      ) : (
                        <span className={styles.readOnlyState} aria-hidden="true">
                          {step.status === 'done' ? '✓' : '•'}
                        </span>
                      )}
                      <div>
                        <h4>{step.title}</h4>
                        <p>{step.assignee} · {checklistLabels[step.status]}</p>
                      </div>
                    </article>
                  );
                }) : <p className={styles.empty}>No checklist actions were added.</p>}
              </section>
            </>
          )}

          <section className={styles.activitySection}>
            <button
              className={styles.activityToggle}
              type="button"
              aria-expanded={activityOpen}
              aria-controls="work-item-activity"
              onClick={() => void toggleActivity()}
            >
              <span>
                <strong>Activity &amp; Discussion</strong>
                <small>
                  {activityCount} entr{activityCount === 1 ? 'y' : 'ies'}
                  {latestActivityAt ? ` · Latest ${formatDateTime(latestActivityAt)}` : ''}
                </small>
              </span>
              <b aria-hidden="true">{activityOpen ? '−' : '+'}</b>
            </button>

            {activityOpen ? (
              <div id="work-item-activity" className={styles.activityBody}>
                {activityLoading ? <p className={styles.activityState} role="status">Loading activity…</p> : null}
                {activityError ? (
                  <div className={styles.activityError} role="alert">
                    <p>{activityError}</p>
                    <button type="button" onClick={() => void loadActivity()}>Try again</button>
                  </div>
                ) : null}
                {!activityLoading && !activityError && activity.length === 0 ? (
                  <p className={styles.activityState}>No activity has been recorded yet.</p>
                ) : null}
                {!activityLoading && activity.length > 0 ? (
                  <ol className={styles.activityList} aria-label="Chronological work-item activity">
                    {activity.map((entry) => (
                      <li key={entry.id}>
                        <div className={styles.activityAvatar} aria-hidden="true">{entry.authorName.slice(0, 1).toUpperCase()}</div>
                        <div>
                          <header>
                            <strong>{entry.authorName}</strong>
                            <span>{activityLabels[entry.type]}</span>
                            <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                          </header>
                          {entry.checklistTitle ? <small>Checklist: {entry.checklistTitle}</small> : null}
                          <p>{entry.body}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : null}

                {!item.archivedAt ? (
                  <form className={styles.commentForm} onSubmit={(event) => void submitComment(event)}>
                    <label>
                      <span>Add a comment</span>
                      <textarea
                        rows={3}
                        maxLength={2000}
                        required
                        value={comment}
                        onChange={(event) => setComment(event.target.value)}
                        placeholder="Share context, a decision, or a handoff…"
                      />
                      <small>{comment.length}/2000</small>
                    </label>
                    <div>
                      <label>
                        <span>Checklist action (optional)</span>
                        <select value={commentStepId} onChange={(event) => setCommentStepId(event.target.value)}>
                          <option value="">Whole card</option>
                          {item.checklist.map((step) => <option key={step.id} value={step.id}>{step.title}</option>)}
                        </select>
                      </label>
                      <button className={styles.primaryAction} type="submit" disabled={!comment.trim() || savingKey === 'comment'}>
                        {savingKey === 'comment' ? 'Posting…' : 'Post comment'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className={styles.activityState}>Restore this work item to add comments.</p>
                )}
              </div>
            ) : null}
          </section>
        </div>
      </section>
    </div>
  );
}
