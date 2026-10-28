-- Stage 2: max category depth 3 -> 5 (root = 0), and a recursion guard on category_visibility.
-- Idempotent: dropping IF EXISTS and re-adding the same constraint is safe to re-run.

BEGIN;

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_depth_check;
ALTER TABLE categories ADD CONSTRAINT categories_depth_check CHECK (depth >= 0 AND depth <= 5);

-- Same columns and semantics as 00039; the recursive CTE gains a level counter so a
-- parent_id cycle can never recurse forever (levels beyond 6 are not followed).
CREATE OR REPLACE VIEW category_visibility AS
WITH RECURSIVE subtree(root_id, node_id, lvl) AS (
  SELECT id, id, 0 FROM categories
  UNION ALL
  SELECT s.root_id, c.id, s.lvl + 1
  FROM subtree s
  JOIN categories c ON c.parent_id = s.node_id
  WHERE s.lvl < 6
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

NOTIFY pgrst, 'reload schema';

COMMIT;
