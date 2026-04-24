-- supabase/migrations/00020_questions_pipeline_tracking.sql
-- Per-question pipeline stage timestamps for observability.
-- All columns nullable: null = stage has not run on this question.
-- fun_fact_checked_at reserved for a future fact-check agent on fun_facts.

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS knowledge_sourced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fact_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qa_passed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fun_fact_checked_at TIMESTAMPTZ;
