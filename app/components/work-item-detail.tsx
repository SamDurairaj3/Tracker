'use client';

import { useEffect, useRef, useState } from 'react';
import { formatDateTime } from '../../lib/local-time';
import {
  CHECKLIST_STATUSES,
  PROGRESS_METHOD_LABELS,
  STATUS_LABELS,
  WORK_STATUSES,
  type ChecklistStep,
  type WorkItem,
  type WorkItemPatch,
  type WorkStatus,
} from '../../lib/work-items';
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

type Props = {
  item: WorkItem | null;
  onClose: () => void;
  onUpdate: (patch: WorkItemPatch) => Promise<WorkItem>;
  canUpdateStatus: boolean;
  canUpdateChecklist: (step: ChecklistStep) => boolean;
  allowAllChecklistStatuses?: boolean;
};

export default function WorkItemDetail({
  item,
  onClose,
  onUpdate,
  canUpdateStatus,
  canUpdateChecklist,
  allowAllChecklistStatuses = false,
}: Props) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [savingKey, setSavingKey] = useState('');
  const [error, setError] = useState('');
  const itemId = item?.id;

  useEffect(() => {
    if (!itemId) return;
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
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
  }, [itemId, onClose]);


  if (!item) return null;

  async function save(patch: WorkItemPatch, key: string) {
    try {
      setSavingKey(key);
      setError('');
      await onUpdate(patch);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'The update could not be saved.');
    } finally {
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
          <div className={styles.badges}>
            <span className={styles[item.status]}>{STATUS_LABELS[item.status]}</span>
            <span className={styles[item.health]}>{healthLabels[item.health]}</span>
            <span>{item.priority} priority</span>
          </div>

          {canUpdateStatus ? (
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
          {error ? <p className={styles.error} role="alert">{error}</p> : null}

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
              const editable = canUpdateChecklist(step);
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
        </div>
      </section>
    </div>
  );
}
