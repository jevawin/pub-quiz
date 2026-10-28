-- Stage 2 (category taxonomy loop): hide/protect columns, alias table, change log,
-- visibility view, and per-question category cap 5 -> 8 (chain tagging: up to 6 chain rows + GK).
-- Additive and idempotent-safe: no existing rows are modified or removed.

BEGIN;

ALTER TABLE categories ADD COLUMN IF NOT EXISTS hidden_at timestamptz NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS hidden_reason text NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS protected boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'categories_hidden_reason_check'
  ) THEN
    ALTER TABLE categories ADD CONSTRAINT categories_hidden_reason_check
      CHECK (hidden_reason IN ('merged', 'trimmed', 'veto'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS category_aliases (
  old_slug text PRIMARY KEY,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS category_changes (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('merge','hide','unhide','create','rehome','flag_duplicate','protect')),
  payload jsonb NOT NULL,
  prior jsonb,
  created_at timestamptz DEFAULT now(),
  undone_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_category_changes_run_id ON category_changes(run_id);

-- Internal tables: match the other tables' posture (service role only). Enable RLS without policies.
ALTER TABLE category_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_changes ENABLE ROW LEVEL SECURITY;

-- distinct_published = DISTINCT published questions linked to the category or any descendant.
-- visible = not hidden AND >= 10 (MIN_VISIBLE_QUESTIONS).
CREATE OR REPLACE VIEW category_visibility AS
WITH RECURSIVE subtree(root_id, node_id) AS (
  SELECT id, id FROM categories
  UNION ALL
  SELECT s.root_id, c.id
  FROM subtree s
  JOIN categories c ON c.parent_id = s.node_id
),
counts AS (
  SELECT s.root_id AS category_id,
         COUNT(DISTINCT qc.question_id)::int AS distinct_published
  FROM subtree s
  JOIN question_categories qc ON qc.category_id = s.node_id
  JOIN questions q ON q.id = qc.question_id AND q.status = 'published'
  GROUP BY s.root_id
)
SELECT c.id AS category_id,
       c.slug,
       c.depth,
       c.parent_id,
       COALESCE(n.distinct_published, 0) AS distinct_published,
       (c.hidden_at IS NOT NULL) AS hidden,
       (c.hidden_at IS NULL AND COALESCE(n.distinct_published, 0) >= 10) AS visible
FROM categories c
LEFT JOIN counts n ON n.category_id = c.id;

-- Body copied verbatim from 00034; only the cap number and message change (5 -> 8).
CREATE OR REPLACE FUNCTION enforce_question_categories_rules()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  qid UUID := COALESCE(NEW.question_id, OLD.question_id);
  row_count INT;
BEGIN
  SELECT COUNT(*) FROM question_categories WHERE question_id = qid INTO row_count;

  IF row_count > 8 THEN
    RAISE EXCEPTION 'Question % cannot have more than 8 categories (got %)', qid, row_count;
  END IF;
  RETURN NULL;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
