-- Shared work-item lifecycle and append-only discussion history.
ALTER TABLE work_items
  ADD COLUMN archived_at TEXT,
  ADD COLUMN archived_by_user_id UUID REFERENCES auth_users(id) ON DELETE SET NULL,
  ADD COLUMN archived_by_name TEXT;

CREATE INDEX idx_work_items_archived_at
  ON work_items(archived_at, created_at DESC, id DESC);

CREATE TABLE work_item_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'comment', 'created', 'edited', 'workflow', 'checklist', 'archived', 'restored'
  )),
  author_user_id UUID REFERENCES auth_users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL CHECK (char_length(btrim(author_name)) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  checklist_step_id TEXT REFERENCES checklist_steps(id) ON DELETE SET NULL,
  checklist_title TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_work_item_activity_item_time
  ON work_item_activity(work_item_id, created_at ASC, id ASC);

