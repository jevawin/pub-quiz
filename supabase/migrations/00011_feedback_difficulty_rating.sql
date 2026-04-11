-- Update feedback_reaction to accept difficulty ratings.

ALTER TABLE question_plays DROP CONSTRAINT IF EXISTS question_plays_feedback_reaction_check;
ALTER TABLE question_plays ADD CONSTRAINT question_plays_feedback_reaction_check
  CHECK (feedback_reaction IN ('easy', 'medium', 'hard', 'too-easy', 'too-hard', 'just-right', 'good', 'bad', 'confusing'));
