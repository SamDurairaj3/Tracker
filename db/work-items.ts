import { randomUUID } from 'node:crypto';
import { database } from './postgres';
import type { Database, Queryable } from './database';
import type { ChecklistRow, WorkItemRow } from './rows';
import { formatDueLabel, type CreateWorkItemInput, type WorkItem, type WorkItemPatch } from '../lib/work-items';

function hydrateItems(itemRows: WorkItemRow[], checklistRows: ChecklistRow[]): WorkItem[] {
  return itemRows.map((row) => ({
    id: row.id, title: row.title, team: row.team, owner: row.owner,
    status: row.status, health: row.health, priority: row.priority, progress: row.progress,
    start: row.start_date, due: row.due_date, dueLabel: row.due_label,
    createdBy: row.created_by, type: row.work_type, purpose: row.purpose,
    expectedResult: row.expected_result, linkedGoal: row.linked_goal,
    progressMethod: row.progress_method, blocker: row.blocker,
    createdAt: row.created_at, updatedAt: row.updated_at,
    checklist: checklistRows.filter((step) => step.work_item_id === row.id).map((step) => ({
      id: step.id, workItemId: step.work_item_id, title: step.title,
      assignee: step.assignee, status: step.status, weight: step.weight, position: step.position,
    })),
  }));
}

async function readItem(client: Queryable, id: string, lock = false) {
  const { rows } = await client.query<WorkItemRow>(
    `SELECT * FROM work_items WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id],
  );
  if (!rows.length) return null;
  const steps = await client.query<ChecklistRow>(
    'SELECT * FROM checklist_steps WHERE work_item_id = $1 ORDER BY position ASC, id ASC', [id],
  );
  return hydrateItems(rows, steps.rows)[0];
}

const teamPrefixes: Record<string, string> = {
  Propulsion: 'PROP', 'Ground Systems': 'GND', Avionics: 'AVN',
  Structures: 'STR', GNC: 'GNC', 'Flight Software': 'FSW',
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

export function createWorkItemRepository(db: Database) {
  return {
    listWorkItems() {
      return db.transaction(async (client) => {
        const items = await client.query<WorkItemRow>('SELECT * FROM work_items ORDER BY created_at DESC, id DESC');
        const steps = await client.query<ChecklistRow>('SELECT * FROM checklist_steps ORDER BY position ASC, id ASC');
        return hydrateItems(items.rows, steps.rows);
      }, { readOnly: true });
    },

    getWorkItem(id: string) {
      return db.transaction((client) => readItem(client, id), { readOnly: true });
    },

    insertWorkItem(input: CreateWorkItemInput) {
      return db.transaction(async (client) => {
        const id = await nextWorkItemId(client, input.team);
        const timestamp = new Date().toISOString();
        await client.query(`
          INSERT INTO work_items (
            id, title, team, owner, status, health, priority, progress,
            start_date, due_date, due_label, created_by, work_type, purpose,
            expected_result, linked_goal, progress_method, blocker, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        `, [
          id, input.title.trim(), input.team, input.owner, input.status, 'on-track', input.priority, 0,
          input.start, input.due, formatDueLabel(input.due), input.createdBy, input.type,
          input.purpose.trim(), input.expectedResult.trim(), input.linkedGoal?.trim() || null,
          input.progressMethod, null, timestamp, timestamp,
        ]);
        const checklist = input.checklist.filter((step) => step.title.trim());
        for (const [position, step] of checklist.entries()) {
          await client.query(`
            INSERT INTO checklist_steps (id, work_item_id, title, assignee, status, weight, position)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
          `, [randomUUID(), id, step.title.trim(), step.assignee, 'open', step.weight ?? 1, position]);
        }
        return (await readItem(client, id))!;
      });
    },

    patchWorkItem(patch: WorkItemPatch) {
      return db.transaction(async (client) => {
        // All writers lock the parent first, serializing checklist and card edits.
        const existing = await readItem(client, patch.id, true);
        if (!existing) return null;
        if (patch.checklistStep) {
          await client.query(`
            UPDATE checklist_steps SET status = $1 WHERE id = $2 AND work_item_id = $3
          `, [patch.checklistStep.status, patch.checklistStep.id, patch.id]);
        }
        let progress = patch.progress ?? existing.progress;
        if (patch.checklistStep && existing.progressMethod === 'checklist-count') {
          const { rows } = await client.query<{ total: number; complete: number }>(`
            SELECT COUNT(*)::integer AS total,
                   COUNT(*) FILTER (WHERE status = 'done')::integer AS complete
            FROM checklist_steps WHERE work_item_id = $1
          `, [patch.id]);
          if (rows[0].total) progress = Math.round(rows[0].complete / rows[0].total * 100);
        }
        if (patch.status === 'done') progress = 100;
        await client.query(`
          UPDATE work_items
          SET status = $1, health = $2, progress = $3, blocker = $4, updated_at = $5
          WHERE id = $6
        `, [
          patch.status ?? existing.status, patch.health ?? existing.health,
          Math.max(0, Math.min(100, progress)),
          patch.blocker === undefined ? existing.blocker : patch.blocker,
          new Date().toISOString(), patch.id,
        ]);
        return readItem(client, patch.id);
      });
    },
  };
}

export const listWorkItems = () => createWorkItemRepository(database()).listWorkItems();
export const getWorkItem = (id: string) => createWorkItemRepository(database()).getWorkItem(id);
export const insertWorkItem = (input: CreateWorkItemInput) => createWorkItemRepository(database()).insertWorkItem(input);
export const patchWorkItem = (patch: WorkItemPatch) => createWorkItemRepository(database()).patchWorkItem(patch);
