-- Capture free-text feedback on individual questions.

CREATE TABLE question_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  feedback_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_question_feedback_question ON question_feedback(question_id);

ALTER TABLE question_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can insert own feedback"
  ON question_feedback
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND session_id = auth.uid());
