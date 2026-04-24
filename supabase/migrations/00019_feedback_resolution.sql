-- supabase/migrations/00019_feedback_resolution.sql
-- Allow actioned feedback to be marked resolved with optional note.

ALTER TABLE question_feedback
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_note TEXT;
