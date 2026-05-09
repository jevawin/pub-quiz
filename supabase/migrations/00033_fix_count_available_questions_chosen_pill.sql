-- Phase 999.22 Wave 2 follow-up.
-- Migration 00032 inadvertently created a single-slug count_available_questions(TEXT, ...)
-- version, but the active client-facing signature is multi-slug TEXT[] (set by 00029).
-- Two functions now coexist; web client uses the multi-slug one which is still on the
-- old "any-row score" logic.
--
-- Fix:
--   1. Drop the orphan single-TEXT version created by 00032.
--   2. Drop and recreate the multi-slug TEXT[] version with chosen-pill row preference
--      (exact match against any of p_category_slugs first, else any tree row).

-- 1. Drop orphan single-TEXT version
DROP FUNCTION IF EXISTS count_available_questions(NUMERIC, NUMERIC, TEXT, UUID[]);

-- 2. Recreate multi-slug version with chosen-pill row preference
DROP FUNCTION IF EXISTS count_available_questions(NUMERIC, NUMERIC, TEXT[], UUID[]);

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
    -- Union of subtrees rooted at any selected slug (excluding the virtual 'general').
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
  chosen_cat_ids AS (
    -- The exact category ids matching the player's selected slugs (no descendants).
    -- Used to prefer the chosen-pill row when present.
    SELECT id FROM categories
    WHERE p_category_slugs IS NOT NULL
      AND slug = ANY(p_category_slugs)
      AND slug <> 'general'
  ),
  effective AS (
    SELECT qc.question_id,
           qc.category_id,
           CASE WHEN qc.observed_n >= 30 THEN qc.observed_score ELSE qc.estimate_score END AS score
    FROM question_categories qc
  ),
  -- Per Q: prefer a row whose category is one of the chosen slugs; else any tree row.
  preferred AS (
    SELECT DISTINCT ON (e.question_id)
           e.question_id,
           e.score
    FROM effective e
    WHERE p_category_slugs IS NULL
       OR array_length(p_category_slugs, 1) IS NULL
       OR 'general' = ANY(p_category_slugs)
       OR e.category_id IN (SELECT id FROM cat_tree)
    ORDER BY e.question_id,
             (e.category_id IN (SELECT id FROM chosen_cat_ids)) DESC NULLS LAST,
             e.category_id
  )
  SELECT COUNT(DISTINCT q.id)::INT
  FROM questions q
  JOIN preferred p ON p.question_id = q.id
  WHERE q.status = 'published'
    AND p.score BETWEEN p_score_min AND p_score_max
    AND (
      p_exclude_ids IS NULL
      OR array_length(p_exclude_ids, 1) IS NULL
      OR NOT (q.id = ANY(p_exclude_ids))
    );
$$;

GRANT EXECUTE ON FUNCTION count_available_questions(NUMERIC, NUMERIC, TEXT[], UUID[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
