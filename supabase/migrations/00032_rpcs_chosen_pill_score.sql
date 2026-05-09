-- Phase 999.22 Wave 2 — RPCs use chosen-pill row's score, fall back to descendant.
--
-- Pre-change: any qc row in the chain walk could pass the score filter, so a Q
--   with leaf score 80 would surface under root pill at "easy" even when the
--   root-tier audience would call it hard. Score "leaks" up.
--
-- Post-change: when player picks pill P, the score filter uses the qc row whose
--   category_id matches P. If no row at P (legacy unchained Q), falls back to
--   any descendant row in P's subtree (preserves current behaviour for unchained
--   Qs during/after backfill — locked decision 7).
--
-- Touched RPCs:
--   1. random_published_questions_excluding
--   2. count_available_questions
--   3. counts_by_root_category   (pick root-tier row per (root, Q))
--   4. random_general_knowledge_questions  (pick root-tier row in walk-up)
--
-- Function signatures unchanged. Callers (apps/web/src/lib/questions.ts) untouched.

-- ---------------------------------------------------------------------------
-- 1. random_published_questions_excluding
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS random_published_questions_excluding(NUMERIC, NUMERIC, TEXT, INT, UUID[]);

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
    SELECT c.id AS cat_id, c.id AS root_id, c.slug AS root_slug
    FROM categories c
    WHERE c.parent_id IS NULL
    UNION ALL
    SELECT c.id AS cat_id, a.root_id, a.root_slug
    FROM categories c
    JOIN ancestry a ON a.cat_id = c.parent_id
  ),
  chosen_cat AS (
    SELECT id FROM categories
    WHERE p_category_slug IS NOT NULL
      AND p_category_slug <> 'general'
      AND slug = p_category_slug
  ),
  effective AS (
    SELECT qc.question_id,
           qc.category_id,
           CASE WHEN qc.observed_n >= 30 THEN qc.observed_score ELSE qc.estimate_score END AS score
    FROM question_categories qc
  ),
  -- One preferred qc row per question: chosen-pill row first, else any tree row,
  -- with deterministic tiebreak by category_id.
  preferred AS (
    SELECT DISTINCT ON (e.question_id)
           e.question_id,
           e.category_id,
           e.score
    FROM effective e
    WHERE p_category_slug IS NULL
       OR p_category_slug = 'general'
       OR e.category_id IN (SELECT id FROM cat_tree)
    ORDER BY e.question_id,
             (e.category_id = (SELECT id FROM chosen_cat)) DESC NULLS LAST,
             e.category_id
  ),
  matches AS (
    SELECT q.id,
           q.question_text,
           q.correct_answer,
           q.distractors,
           q.explanation,
           q.fun_fact,
           p.category_id,
           a.root_slug
    FROM questions q
    JOIN preferred p ON p.question_id = q.id
    JOIN ancestry a ON a.cat_id = p.category_id
    WHERE q.status = 'published'
      AND p.score BETWEEN p_score_min AND p_score_max
      AND (
        p_exclude_ids IS NULL
        OR array_length(p_exclude_ids, 1) IS NULL
        OR NOT (q.id = ANY(p_exclude_ids))
      )
  )
  SELECT id,
         question_text,
         correct_answer,
         distractors,
         explanation,
         category_id,
         root_slug AS category_slug,
         fun_fact
  FROM matches
  ORDER BY random()
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION random_published_questions_excluding(NUMERIC, NUMERIC, TEXT, INT, UUID[]) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. count_available_questions
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS count_available_questions(NUMERIC, NUMERIC, TEXT, UUID[]);

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
  chosen_cat AS (
    SELECT id FROM categories
    WHERE p_category_slug IS NOT NULL
      AND p_category_slug <> 'general'
      AND slug = p_category_slug
  ),
  effective AS (
    SELECT qc.question_id,
           qc.category_id,
           CASE WHEN qc.observed_n >= 30 THEN qc.observed_score ELSE qc.estimate_score END AS score
    FROM question_categories qc
  ),
  preferred AS (
    SELECT DISTINCT ON (e.question_id)
           e.question_id,
           e.score
    FROM effective e
    WHERE p_category_slug IS NULL
       OR p_category_slug = 'general'
       OR e.category_id IN (SELECT id FROM cat_tree)
    ORDER BY e.question_id,
             (e.category_id = (SELECT id FROM chosen_cat)) DESC NULLS LAST,
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

GRANT EXECUTE ON FUNCTION count_available_questions(NUMERIC, NUMERIC, TEXT, UUID[]) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. counts_by_root_category — per (root, Q), prefer root-tier row, fall back
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
  -- Per (root, Q): prefer the qc row at the root level; else any descendant.
  preferred AS (
    SELECT DISTINCT ON (a.root_slug, e.question_id)
           a.root_slug,
           e.question_id,
           e.score
    FROM effective e
    JOIN ancestry a ON a.cat_id = e.category_id
    JOIN questions q ON q.id = e.question_id AND q.status = 'published'
    ORDER BY a.root_slug, e.question_id,
             (e.category_id = a.root_id) DESC,
             e.category_id
  ),
  banded AS (
    SELECT root_slug,
           CASE
             WHEN score <= 33 THEN 'hard'
             WHEN score <= 66 THEN 'normal'
             ELSE 'easy'
           END AS band,
           question_id
    FROM preferred
  )
  SELECT b.root_slug, b.band AS difficulty, COUNT(DISTINCT b.question_id)::INT AS question_count
  FROM banded b
  GROUP BY b.root_slug, b.band;
$$;

GRANT EXECUTE ON FUNCTION counts_by_root_category() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. random_general_knowledge_questions — same chosen-pill pattern (root-tier)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS random_general_knowledge_questions(NUMERIC, NUMERIC, INT);

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
  preferred AS (
    SELECT DISTINCT ON (a.root_slug, e.question_id)
           a.root_slug,
           a.root_id,
           e.question_id,
           e.category_id,
           e.score
    FROM effective e
    JOIN ancestry a ON a.cat_id = e.category_id
    ORDER BY a.root_slug, e.question_id,
             (e.category_id = a.root_id) DESC,
             e.category_id
  ),
  pool AS (
    SELECT q.id,
           q.question_text,
           q.correct_answer,
           q.distractors,
           q.explanation,
           p.category_id,
           p.root_id,
           p.root_slug
    FROM questions q
    JOIN preferred p ON p.question_id = q.id
    WHERE q.status = 'published'
      AND p.score BETWEEN p_score_min AND p_score_max
  ),
  ranked AS (
    SELECT pool.*,
           ROW_NUMBER() OVER (PARTITION BY root_id ORDER BY random()) AS rn
    FROM pool
  )
  SELECT id,
         question_text,
         correct_answer,
         distractors,
         explanation,
         category_id,
         root_slug AS category_slug
  FROM ranked
  ORDER BY rn, random()
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION random_general_knowledge_questions(NUMERIC, NUMERIC, INT) TO anon, authenticated;
