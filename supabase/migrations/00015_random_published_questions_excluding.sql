-- Add a new RPC variant that excludes seen question IDs server-side.
-- The client passes the list of question IDs the user has already seen so the
-- database can filter them out before ordering and limiting. This prevents
-- repeats until the pool is exhausted.

CREATE OR REPLACE FUNCTION random_published_questions_excluding(
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
  category_slug TEXT
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
    AND (
      p_exclude_ids IS NULL
      OR array_length(p_exclude_ids, 1) IS NULL
      OR NOT (q.id = ANY(p_exclude_ids))
    )
  ORDER BY random()
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION random_published_questions_excluding(TEXT, TEXT, INT, UUID[]) TO anon, authenticated;

-- Count helper for pool-size warnings in the Setup screen. Returns the number
-- of published questions that match the filters and are NOT in p_exclude_ids.
CREATE OR REPLACE FUNCTION count_available_questions(
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
      OR q.category_id IN (SELECT id FROM cat_tree)
    )
    AND (
      p_exclude_ids IS NULL
      OR array_length(p_exclude_ids, 1) IS NULL
      OR NOT (q.id = ANY(p_exclude_ids))
    );
$$;

GRANT EXECUTE ON FUNCTION count_available_questions(TEXT, TEXT, UUID[]) TO anon, authenticated;
