-- Review helpers for the OpenTDB bulk import.
-- Run via psql or Supabase SQL editor.

-- Summary
SELECT claude_verdict, review_status, COUNT(*)
FROM questions_staging WHERE source = 'opentdb'
GROUP BY 1, 2 ORDER BY 1, 2;

-- Keeps with no category assigned (needs attention)
SELECT id, question_text, correct_answer, claude_reason
FROM questions_staging
WHERE source = 'opentdb' AND claude_verdict = 'keep' AND category_id IS NULL;

-- Keeps flagged as possible duplicates
SELECT s.id, s.question_text, s.dup_score, q.question_text AS existing
FROM questions_staging s
JOIN questions q ON q.id = s.dup_of_question_id
WHERE s.source = 'opentdb' AND s.claude_verdict = 'keep'
ORDER BY s.dup_score DESC;

-- Uncertain — eyeball each
SELECT id, question_text, correct_answer, claude_reason
FROM questions_staging
WHERE source = 'opentdb' AND claude_verdict = 'uncertain' AND review_status = 'pending'
ORDER BY created_at;

-- Approve all Claude-keeps that aren't dupes and have a category
UPDATE questions_staging
SET review_status = 'approved', reviewed_at = now()
WHERE source = 'opentdb'
  AND review_status = 'pending'
  AND claude_verdict = 'keep'
  AND category_id IS NOT NULL
  AND dup_of_question_id IS NULL;

-- Reject all Claude-skips
UPDATE questions_staging
SET review_status = 'rejected', reviewed_at = now()
WHERE source = 'opentdb'
  AND review_status = 'pending'
  AND claude_verdict = 'skip';
