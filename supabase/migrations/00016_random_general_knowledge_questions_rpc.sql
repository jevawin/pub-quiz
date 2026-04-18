-- General Knowledge quiz RPC: returns up to p_limit published questions
-- distributed round-robin across all root categories (parent_id IS NULL).
--
-- Strategy:
--   1. Walk categories recursively to map every category to its root ancestor.
--   2. Join published questions to their root id + slug.
--   3. Rank questions within each root in random order (ROW_NUMBER OVER PARTITION BY root).
--   4. Order globally by rank so rank=1 from every root is picked before any rank=2,
--      giving natural round-robin distribution.
--
-- Graceful shortfall: roots with fewer questions simply drop out at higher ranks;
-- the global ORDER BY rn then lets roots with surplus fill remaining slots up to p_limit.
-- Roots are discovered dynamically via parent_id IS NULL — no hardcoded slugs.
--
-- Return shape mirrors random_published_questions exactly (id, question_text,
-- correct_answer, distractors, explanation, category_id, category_slug) where
-- category_slug is the ROOT ancestor slug (matches the COALESCE pattern in 00008).

CREATE OR REPLACE FUNCTION random_general_knowledge_questions(p_limit INT)
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
  -- Map every category to its root ancestor (roots map to themselves).
  ancestry AS (
    SELECT c.id AS cat_id, c.id AS root_id, c.slug AS root_slug
    FROM categories c
    WHERE c.parent_id IS NULL
    UNION ALL
    SELECT c.id AS cat_id, a.root_id, a.root_slug
    FROM categories c
    JOIN ancestry a ON a.cat_id = c.parent_id
  ),
  -- All published questions joined to their root.
  pool AS (
    SELECT q.id,
           q.question_text,
           q.correct_answer,
           q.distractors,
           q.explanation,
           q.category_id,
           a.root_id,
           a.root_slug
    FROM questions q
    JOIN ancestry a ON a.cat_id = q.category_id
    WHERE q.status = 'published'
  ),
  -- Rank questions within each root in random order.
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
  -- Round-robin: every root contributes rank=1 before any contributes rank=2.
  -- Secondary random() tiebreaks which root goes first at each rank tier.
  ORDER BY r.rn, random()
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION random_general_knowledge_questions(INT) TO anon, authenticated;
