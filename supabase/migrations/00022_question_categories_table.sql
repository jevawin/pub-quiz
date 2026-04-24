-- supabase/migrations/00022_question_categories_table.sql
-- Adds the question_categories join table for multi-category + per-category score support.
-- This is Wave 1 of the 999.8 phase. Old columns on questions are NOT dropped here —
-- drop happens in migration 00024 after the backfill in Plan 04 completes.

-- 1. Create the join table
CREATE TABLE question_categories (
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  estimate_score NUMERIC(5,2) NOT NULL,
  observed_score NUMERIC(5,2) NULL,
  observed_n INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, category_id),
  CONSTRAINT chk_estimate_score_range CHECK (estimate_score BETWEEN 0 AND 100),
  CONSTRAINT chk_observed_score_range CHECK (observed_score IS NULL OR observed_score BETWEEN 0 AND 100),
  CONSTRAINT chk_observed_n_nonneg CHECK (observed_n >= 0)
);

-- 2. Create indexes
CREATE INDEX idx_question_categories_question ON question_categories(question_id);
CREATE INDEX idx_question_categories_category ON question_categories(category_id);

-- Functional index for effective-score queries (used by RPC in Plan 05):
-- CASE WHEN observed_n >= 30 THEN observed_score ELSE estimate_score END
CREATE INDEX idx_question_categories_effective_score
  ON question_categories(category_id, (CASE WHEN observed_n >= 30 THEN observed_score ELSE estimate_score END));

-- 3. Trigger function: enforce GK-mandatory + 4-row-cap rules
-- DEFERRABLE INITIALLY DEFERRED is essential — lets the pipeline insert all 2-4 rows
-- for a question in one transaction without the trigger firing on the first incomplete insert.
CREATE OR REPLACE FUNCTION enforce_question_categories_rules()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  qid UUID := COALESCE(NEW.question_id, OLD.question_id);
  has_gk BOOLEAN;
  row_count INT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM question_categories qc
    JOIN categories c ON c.id = qc.category_id
    WHERE qc.question_id = qid AND c.slug = 'general-knowledge'
  ) INTO has_gk;

  SELECT COUNT(*) FROM question_categories WHERE question_id = qid INTO row_count;

  IF row_count > 0 AND NOT has_gk THEN
    RAISE EXCEPTION 'Question % must have a general-knowledge row', qid;
  END IF;
  IF row_count > 4 THEN
    RAISE EXCEPTION 'Question % cannot have more than 4 categories (got %)', qid, row_count;
  END IF;
  RETURN NULL;
END $$;

-- 4. Create the DEFERRABLE constraint trigger
CREATE CONSTRAINT TRIGGER trg_question_categories_rules
  AFTER INSERT OR UPDATE OR DELETE ON question_categories
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_question_categories_rules();

-- 5. Enable RLS — mirror the questions table pattern
ALTER TABLE question_categories ENABLE ROW LEVEL SECURITY;

-- Public can SELECT rows for published questions only
CREATE POLICY "public_read_question_categories_of_published"
  ON question_categories FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM questions q
    WHERE q.id = question_categories.question_id AND q.status = 'published'
  ));
-- service_role bypasses RLS; no INSERT/UPDATE/DELETE policies needed for anon

-- 6. Grant SELECT to anon + authenticated so PostgREST exposes the table
GRANT SELECT ON question_categories TO anon, authenticated;
