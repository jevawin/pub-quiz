-- Migration 00025 — fix sport category filter leak (quick task 260426-ow2).
--
-- Bug: random_published_questions_excluding and count_available_questions filter
-- categories by the legacy questions.category_id column. Phase 999.8 introduced
-- multi-category support via the question_categories join table, which is now the
-- authoritative source. When a question's join-table classification disagrees with
-- its legacy category_id (e.g. a sport question whose Category Agent put its
-- primary slug under "tv-and-film"), the user picks Sports and either gets
-- non-sport questions or misses real sport questions.
--
-- Fix: a question matches the category filter if EITHER
--   (a) a row exists in question_categories linking it to any category in the
--       requested subtree, OR
--   (b) the question has NO question_categories rows yet (un-backfilled) AND
--       its legacy category_id is in the subtree.
--
-- Branch (b) is the compatibility shim. Once Phase 999.8 Plan 04 backfill
-- finishes (currently ~348 of 2848 published questions still have no join rows)
-- this branch can be removed. Track removal with the legacy column drop in
-- Plan 05.
--
-- Behavior preserved:
--   - p_category_slug IS NULL or 'general' short-circuits the filter (matches all).
--   - Return signatures unchanged from migration 00024 (fun_fact TEXT included).
--   - Exclusion of seen IDs unchanged.
--   - Re-grant EXECUTE to anon and authenticated.
--
-- Out of scope: random_general_knowledge_questions_rpc, counts_by_root_category.

-- ---------------------------------------------------------------------------
-- random_published_questions_excluding
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS random_published_questions_excluding(TEXT, TEXT, INT, UUID[]);

CREATE FUNCTION random_published_questions_excluding(
  p_difficulty TEXT,
  p_category_slug TEXT,
  p_limit INT,
  p_exclude_ids UUID[]
)
RETURNS TABLE (
  id UUID,
  question_text TEXT,
  correct_answer TEXT,
  distractors JSONB,
  explanation TEXT,
  category_id UUID,
  category_slug TEXT,
  fun_fact TEXT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH RECURSIVE
  cat_tree AS (
    SELECT c.id
    FROM categories c
    WHERE p_category_slug IS NOT NULL
      AND p_category_slug <> 'general'
      AND c.slug = p_category_slug
    UNION ALL
    SELECT c.id
    FROM categories c
    JOIN cat_tree t ON c.parent_id = t.id
  ),
  root_lookup AS (
    SELECT c.id, c.slug, c.parent_id
    FROM categories c
    WHERE c.parent_id IS NULL
  )
  SELECT q.id, q.question_text, q.correct_answer, q.distractors, q.explanation, q.category_id,
         COALESCE(root.slug, cat.slug) AS category_slug,
         q.fun_fact
  FROM questions q
  JOIN categories cat ON cat.id = q.category_id
  LEFT JOIN root_lookup root ON root.id = cat.parent_id
  WHERE q.status = 'published'
    AND q.difficulty = p_difficulty
    AND (
      p_category_slug IS NULL
      OR p_category_slug = 'general'
      OR EXISTS (
        SELECT 1 FROM question_categories qc
        WHERE qc.question_id = q.id
          AND qc.category_id IN (SELECT id FROM cat_tree)
      )
      OR (
        NOT EXISTS (SELECT 1 FROM question_categories qc WHERE qc.question_id = q.id)
        AND q.category_id IN (SELECT id FROM cat_tree)
      )
    )
    AND (
      p_exclude_ids IS NULL
      OR array_length(p_exclude_ids, 1) IS NULL
      OR NOT (q.id = ANY(p_exclude_ids))
    )
  ORDER BY random()
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION random_published_questions_excluding(TEXT, TEXT, INT, UUID[]) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- count_available_questions
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS count_available_questions(TEXT, TEXT, UUID[]);

CREATE FUNCTION count_available_questions(
  p_difficulty TEXT,
  p_category_slug TEXT,
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
    SELECT c.id
    FROM categories c
    WHERE p_category_slug IS NOT NULL
      AND p_category_slug <> 'general'
      AND c.slug = p_category_slug
    UNION ALL
    SELECT c.id
    FROM categories c
    JOIN cat_tree t ON c.parent_id = t.id
  )
  SELECT COUNT(*)::INT
  FROM questions q
  WHERE q.status = 'published'
    AND q.difficulty = p_difficulty
    AND (
      p_category_slug IS NULL
      OR p_category_slug = 'general'
      OR EXISTS (
        SELECT 1 FROM question_categories qc
        WHERE qc.question_id = q.id
          AND qc.category_id IN (SELECT id FROM cat_tree)
      )
      OR (
        NOT EXISTS (SELECT 1 FROM question_categories qc WHERE qc.question_id = q.id)
        AND q.category_id IN (SELECT id FROM cat_tree)
      )
    )
    AND (
      p_exclude_ids IS NULL
      OR array_length(p_exclude_ids, 1) IS NULL
      OR NOT (q.id = ANY(p_exclude_ids))
    );
$$;

GRANT EXECUTE ON FUNCTION count_available_questions(TEXT, TEXT, UUID[]) TO anon, authenticated;
