-- Text dates/timestamps deliberately preserve the existing JSON and D1 values.
-- Schema changes are explicit: requests never create tables or insert demo data.
CREATE TABLE work_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  team TEXT NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL,
  health TEXT NOT NULL,
  priority TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
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
);

CREATE TABLE checklist_steps (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assignee TEXT NOT NULL,
  status TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_checklist_steps_work_item_id
  ON checklist_steps(work_item_id);
CREATE INDEX idx_work_items_created_at ON work_items(created_at DESC, id DESC);

-- Atomic allocation keeps team-prefixed IDs safe across concurrent processes.
CREATE TABLE work_item_counters (
  prefix TEXT PRIMARY KEY,
  last_value BIGINT NOT NULL CHECK (last_value > 0)
);
