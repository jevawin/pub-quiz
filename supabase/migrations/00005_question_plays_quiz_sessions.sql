-- Phase 02.2: web quiz feedback capture
-- question_plays + quiz_sessions, insert-only from the browser, scoped by auth.uid().

CREATE TABLE question_plays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  chosen_option TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  time_to_answer_ms INTEGER NOT NULL CHECK (time_to_answer_ms >= 0),
  feedback_reaction TEXT CHECK (feedback_reaction IN ('good', 'bad', 'confusing')),
  played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_question_plays_question ON question_plays(question_id);
CREATE INDEX idx_question_plays_played_at ON question_plays(played_at DESC);

ALTER TABLE question_plays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can insert own plays"
  ON question_plays
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND session_id = auth.uid());
-- Deliberately no SELECT/UPDATE/DELETE policies. Insert-only.


CREATE TABLE quiz_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  category_slug TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'normal', 'hard')),
  num_questions INTEGER NOT NULL CHECK (num_questions IN (5, 10, 15, 20)),
  score INTEGER NOT NULL CHECK (score >= 0),
  overall_rating TEXT CHECK (overall_rating IN ('good', 'okay', 'bad')),
  feedback_text TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quiz_sessions_completed ON quiz_sessions(completed_at DESC);
CREATE INDEX idx_quiz_sessions_category ON quiz_sessions(category_slug);

ALTER TABLE quiz_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can insert own sessions"
  ON quiz_sessions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND session_id = auth.uid());
