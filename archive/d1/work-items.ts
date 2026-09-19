import { env } from 'cloudflare:workers';
import {
  createChecklistStepsTable,
  createChecklistWorkItemIndex,
  createWorkItemsTable,
  dropLegacyAssigneeIndex,
  dropLegacyOwnerIndex,
  dropLegacyStatusIndex,
  optimizeDatabase,
} from './schema';
import {
  formatDueLabel,
  type ChecklistStatus,
  type CreateWorkItemInput,
  type ProgressMethod,
  type WorkHealth,
  type WorkItem,
  type WorkItemPatch,
  type WorkItemType,
  type WorkPriority,
  type WorkStatus,
} from '../lib/work-items';

type WorkItemRow = {
  id: string;
  title: string;
  team: string;
  owner: string;
  status: WorkStatus;
  health: WorkHealth;
  priority: WorkPriority;
  progress: number;
  start_date: string;
  due_date: string;
  due_label: string;
  created_by: string;
  work_type: WorkItemType;
  purpose: string;
  expected_result: string;
  linked_goal: string | null;
  progress_method: ProgressMethod;
  blocker: string | null;
  created_at: string;
  updated_at: string;
};

type ChecklistRow = {
  id: string;
  work_item_id: string;
  title: string;
  assignee: string;
  status: ChecklistStatus;
  weight: number;
  position: number;
};

type SeedWorkItem = Omit<
  WorkItemRow,
  | 'due_label'
  | 'work_type'
  | 'purpose'
  | 'expected_result'
  | 'linked_goal'
  | 'progress_method'
  | 'blocker'
  | 'created_at'
  | 'updated_at'
> & {
  blocker?: string;
};

const seededWorkItems: SeedWorkItem[] = [
  { id: 'PROP-148', title: 'Define acceptance limits for chamber pressure oscillation', team: 'Propulsion', owner: 'Arjun Menon', status: 'captured', health: 'at-risk', priority: 'High', progress: 5, start_date: '2026-08-29', due_date: '2026-09-08', created_by: 'Meera Shah' },
  { id: 'GND-041', title: 'Confirm test-stand purge sequence instrumentation', team: 'Ground Systems', owner: 'Vikram Rao', status: 'captured', health: 'on-track', priority: 'Medium', progress: 0, start_date: '2026-08-30', due_date: '2026-09-11', created_by: 'Vikram Rao' },
  { id: 'AVN-071', title: 'Release telemetry harness interface drawing', team: 'Avionics', owner: 'Riya Das', status: 'ready', health: 'on-track', priority: 'High', progress: 10, start_date: '2026-08-28', due_date: '2026-09-04', created_by: 'Riya Das' },
  { id: 'STR-093', title: 'Prepare interstage modal-test article', team: 'Structures', owner: 'Neha Iyer', status: 'ready', health: 'at-risk', priority: 'Critical', progress: 12, start_date: '2026-08-25', due_date: '2026-09-02', created_by: 'Kabir Singh' },
  { id: 'GNC-056', title: 'Update actuator rate-limit assumptions in SIL model', team: 'GNC', owner: 'Kabir Singh', status: 'ready', health: 'on-track', priority: 'Medium', progress: 8, start_date: '2026-09-01', due_date: '2026-09-09', created_by: 'Kabir Singh' },
  { id: 'PROP-142', title: 'Validate injector pressure-drop model against cold-flow data', team: 'Propulsion', owner: 'Arjun Menon', status: 'active', health: 'on-track', priority: 'Critical', progress: 68, start_date: '2026-08-18', due_date: '2026-09-01', created_by: 'Arjun Menon' },
  { id: 'STR-089', title: 'Close composite tank-support load cases', team: 'Structures', owner: 'Neha Iyer', status: 'active', health: 'blocked', priority: 'Critical', progress: 44, start_date: '2026-08-19', due_date: '2026-08-31', created_by: 'Neha Iyer', blocker: 'Awaiting revised interface loads from Propulsion.' },
  { id: 'FSW-038', title: 'Implement loss-of-telemetry safe-state transition', team: 'Flight Software', owner: 'Asha Nair', status: 'active', health: 'at-risk', priority: 'High', progress: 52, start_date: '2026-08-22', due_date: '2026-09-03', created_by: 'Asha Nair' },
  { id: 'GND-037', title: 'Complete LOX fill-line pressure test', team: 'Ground Systems', owner: 'Vikram Rao', status: 'active', health: 'blocked', priority: 'High', progress: 35, start_date: '2026-08-24', due_date: '2026-08-30', created_by: 'Vikram Rao', blocker: 'Replacement pressure transducer has not arrived.' },
  { id: 'AVN-063', title: 'Resolve flight-computer harness routing conflict', team: 'Avionics', owner: 'Riya Das', status: 'active', health: 'blocked', priority: 'Critical', progress: 61, start_date: '2026-08-17', due_date: '2026-08-29', created_by: 'Riya Das', blocker: 'Mechanical envelope decision is pending.' },
  { id: 'GNC-049', title: 'Review navigation filter performance with sensor dropouts', team: 'GNC', owner: 'Kabir Singh', status: 'review', health: 'on-track', priority: 'High', progress: 92, start_date: '2026-08-21', due_date: '2026-08-31', created_by: 'Kabir Singh' },
  { id: 'STR-087', title: 'Close interstage quasi-static load review', team: 'Structures', owner: 'Neha Iyer', status: 'review', health: 'at-risk', priority: 'High', progress: 88, start_date: '2026-08-20', due_date: '2026-08-28', created_by: 'Neha Iyer' },
  { id: 'PROP-136', title: 'Archive hot-fire anomaly disposition evidence', team: 'Propulsion', owner: 'Meera Shah', status: 'review', health: 'on-track', priority: 'Medium', progress: 95, start_date: '2026-08-23', due_date: '2026-09-01', created_by: 'Meera Shah' },
  { id: 'AVN-058', title: 'Bench-verify power distribution fault telemetry', team: 'Avionics', owner: 'Riya Das', status: 'done', health: 'on-track', priority: 'High', progress: 100, start_date: '2026-08-19', due_date: '2026-08-27', created_by: 'Riya Das' },
  { id: 'FSW-034', title: 'Baseline guidance command message schema', team: 'Flight Software', owner: 'Asha Nair', status: 'done', health: 'on-track', priority: 'Medium', progress: 100, start_date: '2026-08-18', due_date: '2026-08-26', created_by: 'Asha Nair' },
];

const seededChecklist = [
  { id: 'STEP-PROP142-1', workItemId: 'PROP-142', title: 'Normalize cold-flow test data', assignee: 'Arjun Menon', status: 'done' as const },
  { id: 'STEP-PROP142-2', workItemId: 'PROP-142', title: 'Run pressure-drop correlation', assignee: 'Arjun Menon', status: 'in-progress' as const },
  { id: 'STEP-PROP142-3', workItemId: 'PROP-142', title: 'Review residuals against acceptance band', assignee: 'Meera Shah', status: 'open' as const },
  { id: 'STEP-PROP148-1', workItemId: 'PROP-148', title: 'Collect oscillation limits from test reports', assignee: 'Arjun Menon', status: 'open' as const },
  { id: 'STEP-PROP148-2', workItemId: 'PROP-148', title: 'Confirm controls margin with GNC', assignee: 'Kabir Singh', status: 'open' as const },
  { id: 'STEP-STR089-1', workItemId: 'STR-089', title: 'Supply revised propulsion interface loads', assignee: 'Arjun Menon', status: 'blocked' as const },
  { id: 'STEP-STR087-1', workItemId: 'STR-087', title: 'Review propulsion-side load assumptions', assignee: 'Arjun Menon', status: 'in-progress' as const },
];

let initialization: Promise<void> | null = null;

function database() {
  return (env as unknown as { DB: D1Database }).DB;
}

async function ensureDatabase() {
  if (initialization) return initialization;

  initialization = (async () => {
    const db = database();
    await db.batch([
      db.prepare(createWorkItemsTable),
      db.prepare(createChecklistStepsTable),
      db.prepare(dropLegacyOwnerIndex),
      db.prepare(dropLegacyStatusIndex),
      db.prepare(dropLegacyAssigneeIndex),
      db.prepare(createChecklistWorkItemIndex),
      db.prepare(optimizeDatabase),
    ]);

    const existing = await db
      .prepare('SELECT COUNT(*) AS count FROM work_items')
      .first<{ count: number }>();

    if ((existing?.count ?? 0) > 0) return;

    const timestamp = '2026-08-28T08:00:00.000Z';
    const itemStatements = seededWorkItems.map((item) =>
      db
        .prepare(`
          INSERT INTO work_items (
            id, title, team, owner, status, health, priority, progress,
            start_date, due_date, due_label, created_by, work_type, purpose,
            expected_result, linked_goal, progress_method, blocker,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          item.id,
          item.title,
          item.team,
          item.owner,
          item.status,
          item.health,
          item.priority,
          item.progress,
          item.start_date,
          item.due_date,
          formatDueLabel(item.due_date),
          item.created_by,
          'Task',
          `Provide the engineering evidence needed to ${item.title.toLowerCase()}.`,
          `A reviewed and traceable result for “${item.title}”.`,
          'Flight readiness baseline',
          item.id === 'PROP-142' ? 'checklist-count' : 'manual-estimate',
          item.blocker ?? null,
          timestamp,
          timestamp,
        ),
    );

    const stepStatements = seededChecklist.map((step, position) =>
      db
        .prepare(`
          INSERT INTO checklist_steps (
            id, work_item_id, title, assignee, status, weight, position
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          step.id,
          step.workItemId,
          step.title,
          step.assignee,
          step.status,
          1,
          position,
        ),
    );

    await db.batch([...itemStatements, ...stepStatements]);
  })();

  return initialization;
}

function hydrateItems(itemRows: WorkItemRow[], checklistRows: ChecklistRow[]) {
  return itemRows.map<WorkItem>((row) => ({
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
    checklist: checklistRows
      .filter((step) => step.work_item_id === row.id)
      .map((step) => ({
        id: step.id,
        workItemId: step.work_item_id,
        title: step.title,
        assignee: step.assignee,
        status: step.status,
        weight: step.weight,
        position: step.position,
      })),
  }));
}

export async function listWorkItems() {
  await ensureDatabase();
  const db = database();
  const [itemsResult, checklistResult] = await Promise.all([
    db.prepare('SELECT * FROM work_items ORDER BY created_at DESC, id DESC').all<WorkItemRow>(),
    db.prepare('SELECT * FROM checklist_steps ORDER BY position ASC').all<ChecklistRow>(),
  ]);
  return hydrateItems(itemsResult.results, checklistResult.results);
}

export async function getWorkItem(id: string) {
  const items = await listWorkItems();
  return items.find((item) => item.id === id) ?? null;
}

const teamPrefixes: Record<string, string> = {
  Propulsion: 'PROP',
  'Ground Systems': 'GND',
  Avionics: 'AVN',
  Structures: 'STR',
  GNC: 'GNC',
  'Flight Software': 'FSW',
};

async function nextWorkItemId(team: string) {
  const db = database();
  const prefix = teamPrefixes[team] ?? 'WORK';
  const result = await db
    .prepare('SELECT id FROM work_items WHERE id LIKE ? ORDER BY id DESC LIMIT 1')
    .bind(`${prefix}-%`)
    .first<{ id: string }>();
  const lastNumber = result ? Number(result.id.split('-')[1]) : 0;
  return `${prefix}-${String(lastNumber + 1).padStart(3, '0')}`;
}

export async function insertWorkItem(input: CreateWorkItemInput) {
  await ensureDatabase();
  const db = database();
  const id = await nextWorkItemId(input.team);
  const timestamp = new Date().toISOString();
  const checklist = input.checklist.filter((step) => step.title.trim());

  const itemStatement = db
    .prepare(`
      INSERT INTO work_items (
        id, title, team, owner, status, health, priority, progress,
        start_date, due_date, due_label, created_by, work_type, purpose,
        expected_result, linked_goal, progress_method, blocker,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
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
      input.createdBy,
      input.type,
      input.purpose.trim(),
      input.expectedResult.trim(),
      input.linkedGoal?.trim() || null,
      input.progressMethod,
      null,
      timestamp,
      timestamp,
    );

  const checklistStatements = checklist.map((step, position) =>
    db
      .prepare(`
        INSERT INTO checklist_steps (
          id, work_item_id, title, assignee, status, weight, position
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        crypto.randomUUID(),
        id,
        step.title.trim(),
        step.assignee,
        'open',
        step.weight ?? 1,
        position,
      ),
  );

  await db.batch([itemStatement, ...checklistStatements]);
  return getWorkItem(id);
}

export async function patchWorkItem(patch: WorkItemPatch) {
  await ensureDatabase();
  const db = database();
  const existing = await getWorkItem(patch.id);
  if (!existing) return null;

  if (patch.checklistStep) {
    await db
      .prepare(`
        UPDATE checklist_steps
        SET status = ?
        WHERE id = ? AND work_item_id = ?
      `)
      .bind(patch.checklistStep.status, patch.checklistStep.id, patch.id)
      .run();
  }

  let progress = patch.progress ?? existing.progress;
  if (patch.checklistStep && existing.progressMethod === 'checklist-count') {
    const counts = await db
      .prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS complete
        FROM checklist_steps WHERE work_item_id = ?
      `)
      .bind(patch.id)
      .first<{ total: number; complete: number }>();
    progress = counts?.total
      ? Math.round(((counts.complete ?? 0) / counts.total) * 100)
      : progress;
  }
  if (patch.status === 'done') progress = 100;

  await db
    .prepare(`
      UPDATE work_items
      SET status = ?, health = ?, progress = ?, blocker = ?, updated_at = ?
      WHERE id = ?
    `)
    .bind(
      patch.status ?? existing.status,
      patch.health ?? existing.health,
      Math.max(0, Math.min(100, progress)),
      patch.blocker === undefined ? existing.blocker : patch.blocker,
      new Date().toISOString(),
      patch.id,
    )
    .run();

  return getWorkItem(patch.id);
}
