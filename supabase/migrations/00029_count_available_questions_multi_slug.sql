-- Migration 00029 — count_available_questions accepts a slug ARRAY and dedupes
-- across categories.
--
-- After 999.8 multi-category cutover, a single question can be tagged under
-- multiple root categories (e.g. a science question that also belongs to
-- general-knowledge). The Setup screen pool-size needs the count of UNIQUE
-- questions reachable across the user's selected categories — summing
-- per-category counts in the client double-counts cross-tagged questions.
--
-- This migration drops the single-slug signature and replaces it with one
-- accepting `p_category_slugs TEXT[]`. The client now makes a single RPC call
-- and gets back a deduped count.
--
-- Behaviour:
--   p_category_slugs = ['general']             → all published questions in score range
--   p_category_slugs = ['science']             → questions in science subtree (any depth)
--   p_category_slugs = ['science','history']   → DISTINCT questions in either subtree
--   p_category_slugs IS NULL or empty          → treated as 'general' (all)

DROP FUNCTION IF EXISTS count_available_questions(NUMERIC, NUMERIC, TEXT, UUID[]);

CREATE FUNCTION count_available_questions(
  p_score_min NUMERIC,
  p_score_max NUMERIC,
  p_category_slugs TEXT[],
  p_exclude_ids UUID[]
)
RETURNS INT
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH RECURSIVE
  cat_tree AS (
    -- Seeds: every category whose slug is in p_category_slugs (excluding the
    -- virtual 'general' marker).
    SELECT c.id
    FROM categories c
    WHERE p_category_slugs IS NOT NULL
      AND c.slug = ANY(p_category_slugs)
      AND c.slug <> 'general'
    UNION ALL
    SELECT c.id
    FROM categories c
    JOIN cat_tree t ON c.parent_id = t.id
  ),
  effective AS (
    SELECT qc.question_id,
           qc.category_id,
           CASE WHEN qc.observed_n >= 30 THEN qc.observed_score ELSE qc.estimate_score END AS score
    FROM question_categories qc
  )
  SELECT COUNT(DISTINCT q.id)::INT
  FROM questions q
  JOIN effective e ON e.question_id = q.id
  WHERE q.status = 'published'
    AND e.score BETWEEN p_score_min AND p_score_max
    AND (
      p_category_slugs IS NULL
      OR array_length(p_category_slugs, 1) IS NULL
      OR 'general' = ANY(p_category_slugs)
      OR e.category_id IN (SELECT id FROM cat_tree)
    )
    AND (
      p_exclude_ids IS NULL
      OR array_length(p_exclude_ids, 1) IS NULL
      OR NOT (q.id = ANY(p_exclude_ids))
    );
$$;

GRANT EXECUTE ON FUNCTION count_available_questions(NUMERIC, NUMERIC, TEXT[], UUID[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
