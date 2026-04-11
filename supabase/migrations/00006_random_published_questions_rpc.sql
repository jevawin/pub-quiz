-- Phase 02.2: RPC that returns N random published questions at a given difficulty,
-- scoped to a category subtree (recursive walk over categories.parent_id).

CREATE OR REPLACE FUNCTION random_published_questions(
  p_difficulty TEXT,
  p_category_slug TEXT,
  p_limit INT
)
RETURNS TABLE (
  id UUID,
  question_text TEXT,
  correct_answer TEXT,
  distractors JSONB,
  explanation TEXT,
  category_id UUID
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH RECURSIVE cat_tree AS (
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
  SELECT q.id, q.question_text, q.correct_answer, q.distractors, q.explanation, q.category_id
  FROM questions q
  WHERE q.status = 'published'
    AND q.difficulty = p_difficulty
    AND (
      p_category_slug IS NULL
      OR p_category_slug = 'general'
      OR q.category_id IN (SELECT id FROM cat_tree)
    )
  ORDER BY random()
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION random_published_questions(TEXT, TEXT, INT) TO anon, authenticated;
