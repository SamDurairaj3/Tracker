import { randomUUID } from 'node:crypto';
import { database } from './postgres';
import type { Database, Queryable } from './database';
import type { ChecklistRow, WorkItemActivityRow, WorkItemRow } from './rows';
import {
  canAccessWorkItem,
  formatDueLabel,
  STATUS_LABELS,
  type CreateWorkItemInput,
  type WorkItem,
  type WorkItemActivity,
  type WorkItemActivityType,
  type WorkItemEditInput,
  type WorkItemPatch,
} from '../lib/work-items';

export type WorkItemActor = {
  id: string | null;
  name: string;
  role: string;
};

export type WorkItemMutationCode =
  | 'not-found'
  | 'forbidden'
  | 'archived'
  | 'invalid'
  | 'conflict';

export class WorkItemMutationError extends Error {
  constructor(
    public readonly code: WorkItemMutationCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorkItemMutationError';
  }
}

function hydrateDate(value: string | Date | null) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function hydrateItems(itemRows: WorkItemRow[], checklistRows: ChecklistRow[]): WorkItem[] {
  return itemRows.map((row) => ({
    id: row.id,
    title: row.title,
    team: row.team,
    owner: row.owner,
    status: row.status,
    health: row.health,
    priority: row.priority,
    progress: row.progress,
    start: row.start_date,
    due: row.due_date,
    dueLabel: row.due_label,
    createdBy: row.created_by,
    type: row.work_type,
    purpose: row.purpose,
    expectedResult: row.expected_result,
    linkedGoal: row.linked_goal,
    progressMethod: row.progress_method,
    blocker: row.blocker,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    archivedByName: row.archived_by_name,
    activityCount: Number(row.activity_count),
    latestActivityAt: row.latest_activity_at,
    checklist: checklistRows
      .filter((step) => step.work_item_id === row.id)
      .map((step) => ({
        id: step.id,
        workItemId: step.work_item_id,
        title: step.title,
        assignee: step.assignee,
        due: hydrateDate(step.due_date),
        status: step.status,
        weight: step.weight,
        position: step.position,
      })),
  }));
}

function hydrateActivity(rows: WorkItemActivityRow[]): WorkItemActivity[] {
  return rows.map((row) => ({
    id: row.id,
    workItemId: row.work_item_id,
    type: row.entry_type,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    body: row.body,
    checklistStepId: row.checklist_step_id,
    checklistTitle: row.checklist_title,
    createdAt: row.created_at,
  }));
}

const itemSelect = `
  SELECT w.*,
         (SELECT COUNT(*)::integer
            FROM work_item_activity a
           WHERE a.work_item_id = w.id) AS activity_count,
         (SELECT MAX(a.created_at)
            FROM work_item_activity a
           WHERE a.work_item_id = w.id) AS latest_activity_at
    FROM work_items w
`;

async function readItem(client: Queryable, id: string, lock = false) {
  const { rows } = await client.query<WorkItemRow>(
    `${itemSelect} WHERE w.id = $1${lock ? ' FOR UPDATE OF w' : ''}`,
    [id],
  );
  if (!rows.length) return null;
  const steps = await client.query<ChecklistRow>(
    'SELECT * FROM checklist_steps WHERE work_item_id = $1 ORDER BY position ASC, id ASC',
    [id],
  );
  return hydrateItems(rows, steps.rows)[0];
}

const teamPrefixes: Record<string, string> = {
  Propulsion: 'PROP',
  'Ground Systems': 'GND',
  Avionics: 'AVN',
  Structures: 'STR',
  GNC: 'GNC',
  'Flight Software': 'FSW',
};

async function nextWorkItemId(client: Queryable, team: string) {
  const prefix = teamPrefixes[team] ?? 'WORK';
  const { rows } = await client.query<{ last_value: string }>(`
    INSERT INTO work_item_counters (prefix, last_value)
    VALUES ($1, (SELECT COALESCE(MAX(substring(id FROM '[0-9]+$')::bigint), 0) + 1
                FROM work_items WHERE id ~ $2))
    ON CONFLICT (prefix) DO UPDATE
    SET last_value = GREATEST(work_item_counters.last_value + 1, EXCLUDED.last_value)
    RETURNING last_value
  `, [prefix, `^${prefix}-[0-9]+$`]);
  return `${prefix}-${String(rows[0].last_value).padStart(3, '0')}`;
}

function canManageItem(item: WorkItem, actor: WorkItemActor) {
  return actor.role === 'admin' || item.owner === actor.name;
}

function assertEditable(item: WorkItem) {
  if (item.archivedAt) {
    throw new WorkItemMutationError('archived', 'Archived work items are read-only.');
  }
}

async function appendActivity(
  client: Queryable,
  itemId: string,
  actor: WorkItemActor,
  type: WorkItemActivityType,
  body: string,
  checklistStepId: string | null = null,
  checklistTitle: string | null = null,
) {
  await client.query(`
    INSERT INTO work_item_activity (
      id, work_item_id, entry_type, author_user_id, author_name, body,
      checklist_step_id, checklist_title, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [
    randomUUID(),
    itemId,
    type,
    actor.id,
    actor.name.trim(),
    body.trim(),
    checklistStepId,
    checklistTitle,
    new Date().toISOString(),
  ]);
}

function describeCardChanges(existing: WorkItem, patch: WorkItemPatch) {
  const changes: string[] = [];
  if (patch.status !== undefined && patch.status !== existing.status) {
    changes.push(`workflow status from ${STATUS_LABELS[existing.status]} to ${STATUS_LABELS[patch.status]}`);
  }
  if (patch.health !== undefined && patch.health !== existing.health) {
    changes.push(`health from ${existing.health} to ${patch.health}`);
  }
  if (patch.progress !== undefined && patch.progress !== existing.progress) {
    changes.push(`progress from ${existing.progress}% to ${Math.round(patch.progress)}%`);
  }
  if (patch.blocker !== undefined && patch.blocker !== existing.blocker) {
    changes.push(patch.blocker ? 'the blocker note' : 'cleared the blocker note');
  }
  return changes;
}

function editFieldChanges(existing: WorkItem, input: WorkItemEditInput) {
  const checks: Array<[string, unknown, unknown]> = [
    ['title', existing.title, input.title.trim()],
    ['type', existing.type, input.type],
    ['team', existing.team, input.team],
    ['owner', existing.owner, input.owner],
    ['priority', existing.priority, input.priority],
    ['purpose', existing.purpose, input.purpose.trim()],
    ['expected result', existing.expectedResult, input.expectedResult.trim()],
    ['linked goal', existing.linkedGoal ?? '', input.linkedGoal?.trim() ?? ''],
    ['start date', existing.start, input.start],
    ['progress method', existing.progressMethod, input.progressMethod],
  ];
  if (input.progress !== undefined && input.progress !== existing.progress) {
    checks.push(['progress', existing.progress, input.progress]);
  }
  return checks.filter(([, before, after]) => before !== after).map(([label]) => label);
}

function describeDueDateChange(subject: string, before: string | null, after: string | null) {
  if (!before && after) return `Set ${subject} to ${after}.`;
  if (before && !after) return `Cleared ${subject} (was ${before}).`;
  return `Changed ${subject} from ${before} to ${after}.`;
}

async function calculateChecklistProgress(client: Queryable, itemId: string) {
  const { rows } = await client.query<{ total: number; complete: number }>(`
    SELECT COUNT(*)::integer AS total,
           COUNT(*) FILTER (WHERE status = 'done')::integer AS complete
      FROM checklist_steps
     WHERE work_item_id = $1
  `, [itemId]);
  return rows[0].total ? Math.round(rows[0].complete / rows[0].total * 100) : 0;
}

export function createWorkItemRepository(db: Database) {
  return {
    listWorkItems(includeArchived = false) {
      return db.transaction(async (client) => {
        const items = await client.query<WorkItemRow>(
          `${itemSelect}
             ${includeArchived ? '' : 'WHERE w.archived_at IS NULL'}
             ORDER BY w.created_at DESC, w.id DESC`,
        );
        const steps = await client.query<ChecklistRow>(
          'SELECT * FROM checklist_steps ORDER BY position ASC, id ASC',
        );
        return hydrateItems(items.rows, steps.rows);
      }, { readOnly: true });
    },

    getWorkItem(id: string) {
      return db.transaction((client) => readItem(client, id), { readOnly: true });
    },

    insertWorkItem(input: CreateWorkItemInput, actor?: WorkItemActor) {
      return db.transaction(async (client) => {
        const mutationActor = actor ?? {
          id: null,
          name: input.createdBy,
          role: 'admin',
        };
        const id = await nextWorkItemId(client, input.team);
        const timestamp = new Date().toISOString();
        await client.query(`
          INSERT INTO work_items (
            id, title, team, owner, status, health, priority, progress,
            start_date, due_date, due_label, created_by, work_type, purpose,
            expected_result, linked_goal, progress_method, blocker, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        `, [
          id,
          input.title.trim(),
          input.team,
          input.owner,
          input.status,
          'on-track',
          input.priority,
          0,
          input.start,
          input.due,
          formatDueLabel(input.due),
          mutationActor.name,
          input.type,
          input.purpose.trim(),
          input.expectedResult.trim(),
          input.linkedGoal?.trim() || null,
          input.progressMethod,
          null,
          timestamp,
          timestamp,
        ]);
        const checklist = input.checklist.filter((step) => step.title.trim());
        for (const [position, step] of checklist.entries()) {
          await client.query(`
            INSERT INTO checklist_steps (id, work_item_id, title, assignee, due_date, status, weight, position)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          `, [
            randomUUID(), id, step.title.trim(), step.assignee, step.due,
            'open', step.weight ?? 1, position,
          ]);
        }
        await appendActivity(client, id, mutationActor, 'created', 'Created the work item.');
        return (await readItem(client, id))!;
      });
    },

    patchWorkItem(patch: WorkItemPatch, actor?: WorkItemActor) {
      return db.transaction(async (client) => {
        const existing = await readItem(client, patch.id, true);
        if (!existing) return null;
        const mutationActor = actor ?? {
          id: null,
          name: existing.owner,
          role: 'admin',
        };
        assertEditable(existing);

        const cardChanges = describeCardChanges(existing, patch);
        const changesCard = patch.status !== undefined
          || patch.health !== undefined
          || patch.progress !== undefined
          || patch.blocker !== undefined;
        if (changesCard && mutationActor.role !== 'admin' && existing.owner !== mutationActor.name) {
          throw new WorkItemMutationError('forbidden', 'Access denied.');
        }

        let checklistChanged = false;
        let checklistTitle: string | null = null;
        let priorChecklistStatus = '';
        if (patch.checklistStep) {
          const step = existing.checklist.find((candidate) => candidate.id === patch.checklistStep?.id);
          if (!step) throw new WorkItemMutationError('not-found', 'Checklist action not found.');
          if (mutationActor.role !== 'admin' && step.assignee !== mutationActor.name) {
            throw new WorkItemMutationError('forbidden', 'Access denied.');
          }
          checklistTitle = step.title;
          priorChecklistStatus = step.status;
          checklistChanged = step.status !== patch.checklistStep.status;
          if (checklistChanged) {
            await client.query(
              'UPDATE checklist_steps SET status = $1 WHERE id = $2 AND work_item_id = $3',
              [patch.checklistStep.status, patch.checklistStep.id, patch.id],
            );
          }
        }

        let progress = patch.progress ?? existing.progress;
        if (checklistChanged && existing.progressMethod === 'checklist-count') {
          progress = await calculateChecklistProgress(client, patch.id);
        }
        if (patch.status === 'done') progress = 100;

        const changed = cardChanges.length > 0 || checklistChanged
          || progress !== existing.progress;
        if (!changed) return existing;

        await client.query(`
          UPDATE work_items
             SET status = $1, health = $2, progress = $3, blocker = $4, updated_at = $5
           WHERE id = $6
        `, [
          patch.status ?? existing.status,
          patch.health ?? existing.health,
          Math.max(0, Math.min(100, Math.round(progress))),
          patch.blocker === undefined ? existing.blocker : patch.blocker?.trim() || null,
          new Date().toISOString(),
          patch.id,
        ]);

        if (checklistChanged && patch.checklistStep) {
          await appendActivity(
            client,
            patch.id,
            mutationActor,
            'checklist',
            `Changed checklist item “${checklistTitle}” from ${priorChecklistStatus} to ${patch.checklistStep.status}.`,
            patch.checklistStep.id,
            checklistTitle,
          );
        }
        if (cardChanges.length || (progress !== existing.progress && !patch.checklistStep)) {
          const description = cardChanges.length ? cardChanges.join(', ') : `progress to ${progress}%`;
          await appendActivity(client, patch.id, mutationActor, 'workflow', `Updated ${description}.`);
        }
        return (await readItem(client, patch.id))!;
      });
    },

    editWorkItem(input: WorkItemEditInput, actor: WorkItemActor) {
      return db.transaction(async (client) => {
        const existing = await readItem(client, input.id, true);
        if (!existing) throw new WorkItemMutationError('not-found', 'Work item not found.');
        assertEditable(existing);
        if (!canManageItem(existing, actor)) {
          throw new WorkItemMutationError('forbidden', 'Access denied.');
        }

        const existingIds = new Set(existing.checklist.map((step) => step.id));
        const suppliedIds = input.checklist.flatMap((step) => step.id ? [step.id] : []);
        if (new Set(suppliedIds).size !== suppliedIds.length) {
          throw new WorkItemMutationError('invalid', 'Checklist action IDs must be unique.');
        }
        if (suppliedIds.some((id) => !existingIds.has(id))) {
          throw new WorkItemMutationError('invalid', 'A checklist action does not belong to this work item.');
        }

        const preparedChecklist = input.checklist.map((step, position) => {
          const current = step.id
            ? existing.checklist.find((candidate) => candidate.id === step.id) ?? null
            : null;
          return {
            ...step,
            id: step.id ?? randomUUID(),
            position,
            current,
          };
        });
        const fieldChanges = editFieldChanges(existing, input);
        const cardDueChanged = existing.due !== input.due;
        const checklistDetailsChanged = input.checklist.length !== existing.checklist.length
          || preparedChecklist.some((step) => (
            !step.current
            || step.current.position !== step.position
            || step.current.title !== step.title.trim()
            || step.current.assignee !== step.assignee
            || step.current.weight !== (step.weight ?? step.current.weight)
          ));
        const checklistDueChanges = preparedChecklist
          .filter((step) => (step.current?.due ?? null) !== step.due)
          .map((step) => ({
            id: step.id,
            title: step.title.trim(),
            before: step.current?.due ?? null,
            after: step.due,
          }));
        const checklistChanged = checklistDetailsChanged || checklistDueChanges.length > 0;

        for (const existingStep of existing.checklist) {
          if (!suppliedIds.includes(existingStep.id)) {
            await client.query(
              'DELETE FROM checklist_steps WHERE id = $1 AND work_item_id = $2',
              [existingStep.id, input.id],
            );
          }
        }
        for (const step of preparedChecklist) {
          if (step.current) {
            await client.query(`
              UPDATE checklist_steps
                 SET title = $1, assignee = $2, weight = $3, due_date = $4, position = $5
               WHERE id = $6 AND work_item_id = $7
            `, [
              step.title.trim(),
              step.assignee,
              step.weight ?? step.current.weight,
              step.due,
              step.position,
              step.id,
              input.id,
            ]);
          } else {
            await client.query(`
              INSERT INTO checklist_steps (
                id, work_item_id, title, assignee, due_date, status, weight, position
              ) VALUES ($1,$2,$3,$4,$5,'open',$6,$7)
            `, [
              step.id, input.id, step.title.trim(), step.assignee,
              step.due, step.weight ?? 1, step.position,
            ]);
          }
        }

        let progress = input.progress ?? existing.progress;
        if (input.progressMethod === 'checklist-count') {
          progress = await calculateChecklistProgress(client, input.id);
        }
        if (existing.status === 'done') progress = 100;
        const progressChanged = Math.round(progress) !== existing.progress;

        if (
          !fieldChanges.length
          && !cardDueChanged
          && !checklistChanged
          && !progressChanged
        ) return existing;

        await client.query(`
          UPDATE work_items
             SET title = $1, work_type = $2, team = $3, owner = $4, priority = $5,
                 purpose = $6, expected_result = $7, linked_goal = $8,
                 start_date = $9, due_date = $10, due_label = $11,
                 progress_method = $12, progress = $13, updated_at = $14
           WHERE id = $15
        `, [
          input.title.trim(),
          input.type,
          input.team,
          input.owner,
          input.priority,
          input.purpose.trim(),
          input.expectedResult.trim(),
          input.linkedGoal?.trim() || null,
          input.start,
          input.due,
          formatDueLabel(input.due),
          input.progressMethod,
          Math.max(0, Math.min(100, Math.round(progress))),
          new Date().toISOString(),
          input.id,
        ]);

        const changedLabels = [...fieldChanges];
        if (checklistDetailsChanged) changedLabels.push('checklist');
        if (progressChanged && !changedLabels.includes('progress')) changedLabels.push('progress');
        if (changedLabels.length) {
          await appendActivity(
            client,
            input.id,
            actor,
            'edited',
            `Edited ${changedLabels.join(', ')}.`,
          );
        }
        if (cardDueChanged) {
          await appendActivity(
            client,
            input.id,
            actor,
            'edited',
            describeDueDateChange('work-card due date', existing.due, input.due),
          );
        }
        for (const change of checklistDueChanges) {
          await appendActivity(
            client,
            input.id,
            actor,
            'checklist',
            describeDueDateChange(
              `due date for checklist item “${change.title}”`,
              change.before,
              change.after,
            ),
            change.id,
            change.title,
          );
        }
        return (await readItem(client, input.id))!;
      });
    },

    setWorkItemArchived(id: string, archived: boolean, actor: WorkItemActor) {
      return db.transaction(async (client) => {
        const existing = await readItem(client, id, true);
        if (!existing) throw new WorkItemMutationError('not-found', 'Work item not found.');
        if (!canManageItem(existing, actor)) {
          throw new WorkItemMutationError('forbidden', 'Access denied.');
        }
        if (Boolean(existing.archivedAt) === archived) return existing;

        const timestamp = new Date().toISOString();
        await client.query(`
          UPDATE work_items
             SET archived_at = $1, archived_by_user_id = $2,
                 archived_by_name = $3, updated_at = $4
           WHERE id = $5
        `, [
          archived ? timestamp : null,
          archived ? actor.id : null,
          archived ? actor.name : null,
          timestamp,
          id,
        ]);
        await appendActivity(
          client,
          id,
          actor,
          archived ? 'archived' : 'restored',
          archived ? 'Archived the work item.' : 'Restored the work item.',
        );
        return (await readItem(client, id))!;
      });
    },

    deleteWorkItem(id: string, confirmation: string, actor: WorkItemActor) {
      return db.transaction(async (client) => {
        const existing = await readItem(client, id, true);
        if (!existing) throw new WorkItemMutationError('not-found', 'Work item not found.');
        if (actor.role !== 'admin') {
          throw new WorkItemMutationError('forbidden', 'Access denied.');
        }
        if (!existing.archivedAt) {
          throw new WorkItemMutationError('conflict', 'Archive the work item before deleting it permanently.');
        }
        if (confirmation !== id) {
          throw new WorkItemMutationError('invalid', 'Type the work-item ID exactly to confirm deletion.');
        }
        await client.query('DELETE FROM work_items WHERE id = $1', [id]);
        return { id };
      });
    },

    listWorkItemActivity(id: string) {
      return db.transaction(async (client) => {
        const item = await readItem(client, id);
        if (!item) throw new WorkItemMutationError('not-found', 'Work item not found.');
        const { rows } = await client.query<WorkItemActivityRow>(`
          SELECT * FROM work_item_activity
           WHERE work_item_id = $1
           ORDER BY created_at ASC, id ASC
        `, [id]);
        return hydrateActivity(rows);
      }, { readOnly: true });
    },

    addWorkItemComment(
      id: string,
      body: string,
      checklistStepId: string | null,
      actor: WorkItemActor,
    ) {
      return db.transaction(async (client) => {
        const existing = await readItem(client, id, true);
        if (!existing) throw new WorkItemMutationError('not-found', 'Work item not found.');
        assertEditable(existing);
        if (!canAccessWorkItem(existing, actor)) {
          throw new WorkItemMutationError('forbidden', 'Access denied.');
        }
        let checklistTitle: string | null = null;
        if (checklistStepId) {
          const step = existing.checklist.find((candidate) => candidate.id === checklistStepId);
          if (!step) {
            throw new WorkItemMutationError('invalid', 'The checklist action does not belong to this work item.');
          }
          checklistTitle = step.title;
        }
        await appendActivity(
          client,
          id,
          actor,
          'comment',
          body,
          checklistStepId,
          checklistTitle,
        );
        const { rows } = await client.query<WorkItemActivityRow>(`
          SELECT * FROM work_item_activity
           WHERE work_item_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT 1
        `, [id]);
        return hydrateActivity(rows)[0];
      });
    },
  };
}

export const listWorkItems = (includeArchived = false) =>
  createWorkItemRepository(database()).listWorkItems(includeArchived);
export const getWorkItem = (id: string) =>
  createWorkItemRepository(database()).getWorkItem(id);
export const insertWorkItem = (input: CreateWorkItemInput, actor?: WorkItemActor) =>
  createWorkItemRepository(database()).insertWorkItem(input, actor);
export const patchWorkItem = (patch: WorkItemPatch, actor?: WorkItemActor) =>
  createWorkItemRepository(database()).patchWorkItem(patch, actor);
export const editWorkItem = (input: WorkItemEditInput, actor: WorkItemActor) =>
  createWorkItemRepository(database()).editWorkItem(input, actor);
export const setWorkItemArchived = (id: string, archived: boolean, actor: WorkItemActor) =>
  createWorkItemRepository(database()).setWorkItemArchived(id, archived, actor);
export const deleteWorkItem = (id: string, confirmation: string, actor: WorkItemActor) =>
  createWorkItemRepository(database()).deleteWorkItem(id, confirmation, actor);
export const listWorkItemActivity = (id: string) =>
  createWorkItemRepository(database()).listWorkItemActivity(id);
export const addWorkItemComment = (
  id: string,
  body: string,
  checklistStepId: string | null,
  actor: WorkItemActor,
) => createWorkItemRepository(database()).addWorkItemComment(
  id,
  body,
  checklistStepId,
  actor,
);
