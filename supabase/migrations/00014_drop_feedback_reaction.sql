-- Drop unused feedback_reaction column from question_plays.
-- This per-question difficulty rating was replaced by the
-- "something wrong with this question" free-text feedback flow
-- (question_feedback table) and end-of-quiz overall rating
-- (quiz_sessions.overall_rating).

ALTER TABLE question_plays DROP COLUMN feedback_reaction;
