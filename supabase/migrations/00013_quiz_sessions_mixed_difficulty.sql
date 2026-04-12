-- Allow 'mixed' as a difficulty value in quiz_sessions
ALTER TABLE quiz_sessions DROP CONSTRAINT quiz_sessions_difficulty_check;
ALTER TABLE quiz_sessions ADD CONSTRAINT quiz_sessions_difficulty_check
  CHECK (difficulty IN ('easy', 'normal', 'hard', 'mixed'));
