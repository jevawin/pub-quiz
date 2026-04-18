-- RPC returning published question counts grouped by root category slug and difficulty.
-- One row per (root_slug, difficulty) combination that has at least one published question.
-- Walks UP each question's category.parent_id chain to the root (parent_id IS NULL)
-- so questions filed under descendants (e.g. 'movies-and-tv/pixar') roll up to their
-- root ('movies-and-tv'). Payload is tiny (<= 12 roots * 3 difficulties = 36 rows) so
-- the client can fetch once on mount and derive Mixed totals locally.

CREATE OR REPLACE FUNCTION counts_by_root_category()
RETURNS TABLE (root_slug TEXT, difficulty TEXT, question_count INT)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH RECURSIVE ancestors AS (
    -- Seed: every category points to itself as its current walker node.
    SELECT id AS cat_id, id AS cur_id, slug AS cur_slug, parent_id AS cur_parent
    FROM categories
    UNION ALL
    -- Step up to the parent.
    SELECT a.cat_id, p.id, p.slug, p.parent_id
    FROM ancestors a
    JOIN categories p ON p.id = a.cur_parent
  ),
  root_of AS (
    SELECT cat_id, cur_slug AS root_slug
    FROM ancestors
    WHERE cur_parent IS NULL
  )
  SELECT r.root_slug, q.difficulty, COUNT(*)::INT AS question_count
  FROM questions q
  JOIN root_of r ON r.cat_id = q.category_id
  WHERE q.status = 'published'
  GROUP BY r.root_slug, q.difficulty;
$$;

GRANT EXECUTE ON FUNCTION counts_by_root_category() TO anon, authenticated;
