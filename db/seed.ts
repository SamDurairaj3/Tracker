import type { Database } from './database';
import { seededChecklist, seededWorkItems } from './demo-data';
import { formatDueLabel } from '../lib/work-items';

export function assertDemoSeedAllowed(environment: NodeJS.ProcessEnv, confirmed: boolean) {
  if (environment.NODE_ENV !== 'development' || environment.ALLOW_DEMO_SEED !== 'true' || !confirmed) {
    throw new Error('Demo seeding requires NODE_ENV=development, ALLOW_DEMO_SEED=true, and --confirm-demo.');
  }
}

export async function seedDemo(db: Database, environment: NodeJS.ProcessEnv, confirmed: boolean) {
  assertDemoSeedAllowed(environment, confirmed);
  return db.transaction(async (client) => {
    await client.query('LOCK TABLE work_items, checklist_steps, work_item_counters IN EXCLUSIVE MODE');
    const { rows } = await client.query<{ occupied: boolean }>(`
      SELECT EXISTS (SELECT 1 FROM work_items)
          OR EXISTS (SELECT 1 FROM checklist_steps)
          OR EXISTS (SELECT 1 FROM work_item_counters) AS occupied
    `);
    if (rows[0].occupied) throw new Error('Demo seeding refuses a database with existing work records or counters.');
    const timestamp = '2026-08-28T08:00:00.000Z';
    for (const item of seededWorkItems) {
      await client.query(`
        INSERT INTO work_items (
          id, title, team, owner, status, health, priority, progress,
          start_date, due_date, due_label, created_by, work_type, purpose,
          expected_result, linked_goal, progress_method, blocker, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      `, [
        item.id, item.title, item.team, item.owner, item.status, item.health, item.priority, item.progress,
        item.start_date, item.due_date, formatDueLabel(item.due_date), item.created_by, 'Task',
        `Provide the engineering evidence needed to ${item.title.toLowerCase()}.`,
        `A reviewed and traceable result for “${item.title}”.`, 'Flight readiness baseline',
        item.id === 'PROP-142' ? 'checklist-count' : 'manual-estimate', item.blocker ?? null, timestamp, timestamp,
      ]);
    }
    for (const [position, step] of seededChecklist.entries()) {
      await client.query(`
        INSERT INTO checklist_steps (id, work_item_id, title, assignee, status, weight, position)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [step.id, step.workItemId, step.title, step.assignee, step.status, 1, position]);
    }
    return seededWorkItems.length;
  });
}
