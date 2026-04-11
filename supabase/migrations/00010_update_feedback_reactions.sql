-- Update feedback_reaction values to difficulty feedback.

ALTER TABLE question_plays DROP CONSTRAINT IF EXISTS question_plays_feedback_reaction_check;
ALTER TABLE question_plays ADD CONSTRAINT question_plays_feedback_reaction_check
  CHECK (feedback_reaction IN ('too-easy', 'too-hard', 'just-right', 'good', 'bad', 'confusing'));
