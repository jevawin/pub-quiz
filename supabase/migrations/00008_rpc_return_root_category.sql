-- Return root (top-level) category slug instead of direct subcategory slug.
-- Walks up the parent chain to find the root ancestor.

DROP FUNCTION IF EXISTS random_published_questions(TEXT, TEXT, INT);

CREATE FUNCTION random_published_questions(
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
  category_id UUID,
  category_slug TEXT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH RECURSIVE
  -- Walk DOWN from the selected category to find all subcategories
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
  -- Walk UP from each question's category to find the root ancestor
  root_lookup AS (
    SELECT c.id, c.slug, c.parent_id
    FROM categories c
    WHERE c.parent_id IS NULL
  )
  SELECT q.id, q.question_text, q.correct_answer, q.distractors, q.explanation, q.category_id,
         COALESCE(root.slug, cat.slug) AS category_slug
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
  ORDER BY random()
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION random_published_questions(TEXT, TEXT, INT) TO anon, authenticated;
