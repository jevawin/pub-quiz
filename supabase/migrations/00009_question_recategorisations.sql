-- Capture user suggestions for question recategorisation.

CREATE TABLE question_recategorisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  suggested_category_slug TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_recategorisations_question ON question_recategorisations(question_id);

ALTER TABLE question_recategorisations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can insert own recategorisations"
  ON question_recategorisations
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND session_id = auth.uid());
