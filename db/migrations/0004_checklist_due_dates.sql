-- Optional checklist deadlines keep action scheduling independent from card dates.
ALTER TABLE checklist_steps
  ADD COLUMN due_date DATE;

CREATE INDEX idx_checklist_steps_due_date
  ON checklist_steps(due_date)
  WHERE due_date IS NOT NULL;
