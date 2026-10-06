'use client';

import { useEffect, useState } from 'react';
import { defaultWorkDates } from '../../lib/local-time';
import {
  PROGRESS_METHOD_LABELS,
  type CreateWorkItemInput,
  type ProgressMethod,
  type WorkItem,
  type WorkItemType,
  type WorkPriority,
} from '../../lib/work-items';
import { createWorkItem } from '../../lib/work-items-client';
import styles from './work-item-create-dialog.module.css';

type ChecklistDraft = { title: string; assignee: string; due: string };
type FormState = Omit<CreateWorkItemInput, 'status' | 'createdBy' | 'checklist'> & {
  linkedGoal: string;
  checklist: ChecklistDraft[];
};

function emptyForm(defaultOwner: string, defaultTeam: string): FormState {
  return {
    title: '',
    type: 'Task',
    team: defaultTeam,
    owner: defaultOwner,
    priority: 'High',
    purpose: '',
    expectedResult: '',
    linkedGoal: '',
    ...defaultWorkDates(new Date()),
    progressMethod: 'checklist-count',
    checklist: [{ title: '', assignee: defaultOwner, due: '' }],
  };
}

export default function WorkItemCreateDialog({
  creatorName,
  people,
  teams,
  onClose,
  onCreated,
}: {
  creatorName: string;
  people: string[];
  teams: string[];
  onClose(): void;
  onCreated(item: WorkItem): void;
}) {
  const defaultOwner = people.find((name) => name !== creatorName) ?? creatorName;
  const [form, setForm] = useState<FormState>(() => emptyForm(defaultOwner, teams[0] ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, saving]);

  function updateChecklist(index: number, field: keyof ChecklistDraft, value: string) {
    setForm((current) => ({
      ...current,
      checklist: current.checklist.map((step, stepIndex) => (
        stepIndex === index ? { ...step, [field]: value } : step
      )),
    }));
  }

  async function submit(event: { preventDefault(): void }, status: 'captured' | 'ready') {
    event.preventDefault();
    setError('');
    if (!form.title.trim() || !form.purpose.trim() || !form.expectedResult.trim()) {
      setError('Add a title, purpose, and expected result before creating the card.');
      return;
    }
    if (form.due < form.start) {
      setError('The due date must be on or after the start date.');
      return;
    }
    try {
      setSaving(true);
      const item = await createWorkItem({
        ...form,
        status,
        createdBy: creatorName,
        checklist: form.checklist
          .filter((step) => step.title.trim())
          .map((step) => ({ ...step, due: step.due || null })),
      });
      onCreated(item);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The work card could not be created.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="management-create-title">
        <header>
          <div><span>Management assignment</span><h2 id="management-create-title">Create and assign work</h2><p>Define the expected result, accountable owner, dates, and any delegated checklist actions.</p></div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close create work card">×</button>
        </header>
        <form onSubmit={(event) => void submit(event, 'ready')}>
          <section>
            <h3>Result</h3>
            <label className={styles.full}><span>Work card title *</span><input autoFocus value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label>
            <div className={styles.grid}>
              <label><span>Type</span><select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as WorkItemType }))}>{(['Task', 'Experiment', 'Investigation', 'Review'] as WorkItemType[]).map((value) => <option key={value}>{value}</option>)}</select></label>
              <label><span>Priority</span><select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as WorkPriority }))}>{(['Critical', 'High', 'Medium'] as WorkPriority[]).map((value) => <option key={value}>{value}</option>)}</select></label>
            </div>
            <label className={styles.full}><span>Purpose — why now? *</span><textarea rows={2} value={form.purpose} onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value }))} /></label>
            <label className={styles.full}><span>Expected result / definition of done *</span><textarea rows={2} value={form.expectedResult} onChange={(event) => setForm((current) => ({ ...current, expectedResult: event.target.value }))} /></label>
          </section>
          <section>
            <h3>Ownership and schedule</h3>
            <div className={styles.grid}>
              <label><span>Team</span><select required value={form.team} onChange={(event) => setForm((current) => ({ ...current, team: event.target.value }))}>{teams.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label><span>Accountable owner</span><select value={form.owner} onChange={(event) => setForm((current) => ({ ...current, owner: event.target.value }))}>{people.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label><span>Start date</span><input type="date" value={form.start} onChange={(event) => setForm((current) => ({ ...current, start: event.target.value }))} /></label>
              <label><span>Due date</span><input type="date" value={form.due} onChange={(event) => setForm((current) => ({ ...current, due: event.target.value }))} /></label>
            </div>
            <label className={styles.full}><span>Linked goal</span><input value={form.linkedGoal} onChange={(event) => setForm((current) => ({ ...current, linkedGoal: event.target.value }))} placeholder="Optional milestone or objective" /></label>
          </section>
          <section>
            <h3>Progress and checklist assignments</h3>
            <label className={styles.full}><span>Progress method</span><select value={form.progressMethod} onChange={(event) => setForm((current) => ({ ...current, progressMethod: event.target.value as ProgressMethod }))}>{(Object.entries(PROGRESS_METHOD_LABELS) as Array<[ProgressMethod, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <div className={styles.checklistHeader}><strong>Checklist actions</strong><button type="button" onClick={() => setForm((current) => ({ ...current, checklist: [...current.checklist, { title: '', assignee: form.owner, due: '' }] }))}>＋ Add action</button></div>
            <div className={styles.checklist}>
              {form.checklist.map((step, index) => (
                <div key={index}>
                  <span>{index + 1}</span>
                  <input value={step.title} onChange={(event) => updateChecklist(index, 'title', event.target.value)} placeholder="Action or handoff" aria-label={`Checklist action ${index + 1}`} />
                  <select value={step.assignee} onChange={(event) => updateChecklist(index, 'assignee', event.target.value)} aria-label={`Assignee for action ${index + 1}`}>{people.map((value) => <option key={value}>{value}</option>)}</select>
                  <input type="date" value={step.due} onChange={(event) => updateChecklist(index, 'due', event.target.value)} aria-label={`Due date for action ${index + 1}`} />
                  <button type="button" onClick={() => setForm((current) => ({ ...current, checklist: current.checklist.filter((_, stepIndex) => stepIndex !== index) }))} aria-label={`Remove checklist action ${index + 1}`}>×</button>
                </div>
              ))}
            </div>
          </section>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <footer>
            <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" onClick={(event) => void submit(event, 'captured')} disabled={saving}>Save captured</button>
            <button className={styles.primary} type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create and assign'}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
