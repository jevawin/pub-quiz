-- Phase 999.22 Wave 3 — bump trigger cap from 4 to 5.
--
-- Rationale: chain tagging emits up to 3 ancestor rows per Q (root + sub + sub-sub),
-- plus optional GK row, plus 1 cousin root row = 5. Locked decision 1.
--
-- Trigger function created in 00022, loosened in 00023 (GK now optional).
-- This change updates only the row-count cap.

CREATE OR REPLACE FUNCTION enforce_question_categories_rules()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  qid UUID := COALESCE(NEW.question_id, OLD.question_id);
  row_count INT;
BEGIN
  SELECT COUNT(*) FROM question_categories WHERE question_id = qid INTO row_count;

  IF row_count > 5 THEN
    RAISE EXCEPTION 'Question % cannot have more than 5 categories (got %)', qid, row_count;
  END IF;
  RETURN NULL;
END $$;
