-- Add general-knowledge as a root category and loosen the GK-mandatory rule.
-- Previously every question needed a GK row; now GK is applied selectively
-- (only when a general-public player would plausibly know the answer).
-- Keeps the 4-row cap and 1-row minimum (when rows exist).

INSERT INTO categories (slug, name, parent_id)
VALUES ('general-knowledge', 'General Knowledge', NULL)
ON CONFLICT (slug) DO NOTHING;

CREATE OR REPLACE FUNCTION enforce_question_categories_rules()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  qid UUID := COALESCE(NEW.question_id, OLD.question_id);
  row_count INT;
BEGIN
  SELECT COUNT(*) FROM question_categories WHERE question_id = qid INTO row_count;

  IF row_count > 4 THEN
    RAISE EXCEPTION 'Question % cannot have more than 4 categories (got %)', qid, row_count;
  END IF;
  RETURN NULL;
END $$;
