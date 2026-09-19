/**
 * Canonical D1 schema for work items and their independently assignable steps.
 * Each constant is one SQL statement so runtime initialization can safely use
 * D1 prepared statements.
 */

export const createWorkItemsTable = `
  CREATE TABLE IF NOT EXISTS work_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    team TEXT NOT NULL,
    owner TEXT NOT NULL,
    status TEXT NOT NULL,
    health TEXT NOT NULL,
    priority TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    start_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    due_label TEXT NOT NULL,
    created_by TEXT NOT NULL,
    work_type TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expected_result TEXT NOT NULL,
    linked_goal TEXT,
    progress_method TEXT NOT NULL,
    blocker TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

export const createChecklistStepsTable = `
  CREATE TABLE IF NOT EXISTS checklist_steps (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL,
    title TEXT NOT NULL,
    assignee TEXT NOT NULL,
    status TEXT NOT NULL,
    weight INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
  )
`;

export const createChecklistWorkItemIndex = `
  CREATE INDEX IF NOT EXISTS idx_checklist_steps_work_item_id
  ON checklist_steps(work_item_id)
`;

// Remove indexes from the first prototype that are not used by server queries.
export const dropLegacyOwnerIndex = 'DROP INDEX IF EXISTS work_items_owner_idx';
export const dropLegacyStatusIndex = 'DROP INDEX IF EXISTS work_items_status_idx';
export const dropLegacyAssigneeIndex =
  'DROP INDEX IF EXISTS checklist_steps_assignee_idx';

export const optimizeDatabase = 'PRAGMA optimize';
