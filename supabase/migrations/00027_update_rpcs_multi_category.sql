-- Migration 00027 (Phase 999.8 Plan 05) — rewrite RPCs to use question_categories
-- with effective-score filtering instead of the dropped questions.difficulty and
-- questions.category_id columns.
--
-- Effective score = observed_score when observed_n >= 30 else estimate_score.
-- Score range is supplied by the caller as p_score_min / p_score_max (NUMERIC,
-- 0..100). The web client maps UI difficulty buckets to ranges:
--   Mixed  → 0..100
--   Easy   → 67..100
--   Medium → 34..66
--   Hard   → 0..33
-- See apps/web/src/lib/difficulty.ts (uiToScoreRange).
--
-- Function signatures change. Postgres forbids return-type changes via CREATE OR
-- REPLACE, and we are also changing parameter lists, so each function is dropped
-- by old signature first.
--
-- RPCs rewritten:
--   1. random_published_questions_excluding — main quiz fetch (consumed by web).
--   2. count_available_questions             — pool-size warning (web Setup).
--   3. counts_by_root_category               — per-pill counts (web Setup).
--   4. random_general_knowledge_questions    — GK round-robin (legacy, retained).
--   5. random_published_questions            — 3-arg legacy used by RLS test.
--
-- All RPCs return category_slug as the ROOT slug for the chosen
-- question_categories row, matching the existing client contract.

-- ---------------------------------------------------------------------------
-- 1. random_published_questions_excluding
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS random_published_questions_excluding(TEXT, TEXT, INT, UUID[]);

CREATE FUNCTION random_published_questions_excluding(
  p_score_min NUMERIC,
  p_score_max NUMERIC,
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
  ancestry AS (
    -- Map every category to its root ancestor (roots map to themselves).
    SELECT c.id AS cat_id, c.id AS root_id, c.slug AS root_slug
    FROM categories c
    WHERE c.parent_id IS NULL
    UNION ALL
    SELECT c.id AS cat_id, a.root_id, a.root_slug
    FROM categories c
    JOIN ancestry a ON a.cat_id = c.parent_id
  ),
  effective AS (
    SELECT qc.question_id,
           qc.category_id,
           CASE WHEN qc.observed_n >= 30 THEN qc.observed_score ELSE qc.estimate_score END AS score
    FROM question_categories qc
  ),
  matches AS (
    -- One row per (question, matching question_categories row). DISTINCT later
    -- collapses to one row per question, picking any matching root slug.
    SELECT q.id,
           q.question_text,
           q.correct_answer,
           q.distractors,
           q.explanation,
           q.fun_fact,
           e.category_id,
           a.root_slug
    FROM questions q
    JOIN effective e ON e.question_id = q.id
    JOIN ancestry a ON a.cat_id = e.category_id
    WHERE q.status = 'published'
      AND e.score BETWEEN p_score_min AND p_score_max
      AND (
        p_category_slug IS NULL
        OR p_category_slug = 'general'
        OR e.category_id IN (SELECT id FROM cat_tree)
      )
      AND (
        p_exclude_ids IS NULL
        OR array_length(p_exclude_ids, 1) IS NULL
        OR NOT (q.id = ANY(p_exclude_ids))
      )
  )
  SELECT DISTINCT ON (id)
         id,
         question_text,
         correct_answer,
         distractors,
         explanation,
         category_id,
         root_slug AS category_slug,
         fun_fact
  FROM matches
  ORDER BY id, random()
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION random_published_questions_excluding(NUMERIC, NUMERIC, TEXT, INT, UUID[]) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. count_available_questions
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS count_available_questions(TEXT, TEXT, UUID[]);

CREATE FUNCTION count_available_questions(
  p_score_min NUMERIC,
  p_score_max NUMERIC,
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
      p_category_slug IS NULL
      OR p_category_slug = 'general'
      OR e.category_id IN (SELECT id FROM cat_tree)
    )
    AND (
      p_exclude_ids IS NULL
      OR array_length(p_exclude_ids, 1) IS NULL
      OR NOT (q.id = ANY(p_exclude_ids))
    );
$$;

GRANT EXECUTE ON FUNCTION count_available_questions(NUMERIC, NUMERIC, TEXT, UUID[]) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. counts_by_root_category
--
-- Returns one row per (root_slug, band) where band is 'easy'/'normal'/'hard'
-- bucketed from the effective score. Web client groups these into the
-- CategoryCounts shape it already consumes.
--   Easy   = score 67..100
--   Normal = score 34..66
--   Hard   = score 0..33
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS counts_by_root_category();

CREATE FUNCTION counts_by_root_category()
RETURNS TABLE (root_slug TEXT, difficulty TEXT, question_count INT)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH RECURSIVE
  ancestry AS (
    SELECT c.id AS cat_id, c.id AS root_id, c.slug AS root_slug
    FROM categories c
    WHERE c.parent_id IS NULL
    UNION ALL
    SELECT c.id AS cat_id, a.root_id, a.root_slug
    FROM categories c
    JOIN ancestry a ON a.cat_id = c.parent_id
  ),
  effective AS (
    SELECT qc.question_id,
           qc.category_id,
           CASE WHEN qc.observed_n >= 30 THEN qc.observed_score ELSE qc.estimate_score END AS score
    FROM question_categories qc
  ),
  banded AS (
    SELECT a.root_slug,
           CASE
             WHEN e.score <= 33 THEN 'hard'
             WHEN e.score <= 66 THEN 'normal'
             ELSE 'easy'
           END AS band,
           e.question_id
    FROM effective e
    JOIN ancestry a ON a.cat_id = e.category_id
    JOIN questions q ON q.id = e.question_id AND q.status = 'published'
  )
  SELECT b.root_slug, b.band AS difficulty, COUNT(DISTINCT b.question_id)::INT AS question_count
  FROM banded b
  GROUP BY b.root_slug, b.band;
$$;

GRANT EXECUTE ON FUNCTION counts_by_root_category() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. random_general_knowledge_questions
--
-- Round-robin GK fetch over root categories, now with score-range filter.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS random_general_knowledge_questions(INT);

CREATE FUNCTION random_general_knowledge_questions(
  p_score_min NUMERIC,
  p_score_max NUMERIC,
  p_limit INT
)
RETURNS TABLE (
  id UUID,
  question_text TEXT,
  correct_answer TEXT,
  distractors JSONB,
  explanation TEXT,
  category_id UUID,
  category_slug TEXT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH RECURSIVE
  ancestry AS (
    SELECT c.id AS cat_id, c.id AS root_id, c.slug AS root_slug
    FROM categories c
    WHERE c.parent_id IS NULL
    UNION ALL
    SELECT c.id AS cat_id, a.root_id, a.root_slug
    FROM categories c
    JOIN ancestry a ON a.cat_id = c.parent_id
  ),
  effective AS (
    SELECT qc.question_id,
           qc.category_id,
           CASE WHEN qc.observed_n >= 30 THEN qc.observed_score ELSE qc.estimate_score END AS score
    FROM question_categories qc
  ),
  pool AS (
    SELECT DISTINCT ON (q.id)
           q.id,
           q.question_text,
           q.correct_answer,
           q.distractors,
           q.explanation,
           e.category_id,
           a.root_id,
           a.root_slug
    FROM questions q
    JOIN effective e ON e.question_id = q.id
    JOIN ancestry a ON a.cat_id = e.category_id
    WHERE q.status = 'published'
      AND e.score BETWEEN p_score_min AND p_score_max
    ORDER BY q.id, random()
  ),
  ranked AS (
    SELECT p.*,
           ROW_NUMBER() OVER (PARTITION BY p.root_id ORDER BY random()) AS rn
    FROM pool p
  )
  SELECT r.id,
         r.question_text,
         r.correct_answer,
         r.distractors,
         r.explanation,
         r.category_id,
         r.root_slug AS category_slug
  FROM ranked r
  ORDER BY r.rn, random()
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION random_general_knowledge_questions(NUMERIC, NUMERIC, INT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. random_published_questions  (3-arg legacy form used by rls.integration.test.ts)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS random_published_questions(TEXT, TEXT, INT);

CREATE FUNCTION random_published_questions(
  p_score_min NUMERIC,
  p_score_max NUMERIC,
  p_category_slug TEXT,
  p_limit INT
)
RETURNS TABLE (
  id UUID,
  question_text TEXT,
  correct_answer TEXT,
  distractors JSONB,
  explanation TEXT,
  category_id UUID,
  category_slug TEXT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT id, question_text, correct_answer, distractors, explanation, category_id, category_slug
  FROM random_published_questions_excluding(
    p_score_min,
    p_score_max,
    p_category_slug,
    p_limit,
    ARRAY[]::UUID[]
  );
$$;

GRANT EXECUTE ON FUNCTION random_published_questions(NUMERIC, NUMERIC, TEXT, INT) TO anon, authenticated;
