ALTER TABLE work_items
  ADD COLUMN needs_attention BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE work_item_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (
    name = btrim(name)
    AND char_length(name) BETWEEN 1 AND 80
  ),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX work_item_teams_name_uidx
  ON work_item_teams(lower(name));
CREATE INDEX work_item_teams_order_idx
  ON work_item_teams(active DESC, position ASC, lower(name));

INSERT INTO work_item_teams (name, position)
VALUES
  ('Propulsion', 0),
  ('Ground Systems', 1),
  ('Avionics', 2),
  ('Structures', 3),
  ('GNC', 4),
  ('Flight Software', 5);

INSERT INTO work_item_teams (name, position)
SELECT existing.team, 100 + row_number() OVER (ORDER BY lower(existing.team))
  FROM (SELECT DISTINCT team FROM work_items) existing
 WHERE NOT EXISTS (
   SELECT 1 FROM work_item_teams configured
    WHERE lower(configured.name) = lower(existing.team)
 );
