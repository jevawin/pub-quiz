-- Add fun_fact to random_published_questions_excluding return signature so the web client can render it on answer reveal.
-- DROP first because Postgres forbids changing a function's return type via CREATE OR REPLACE.

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
      OR q.category_id IN (SELECT id FROM cat_tree)
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
