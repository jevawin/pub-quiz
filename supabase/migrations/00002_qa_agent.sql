-- supabase/migrations/00002_qa_agent.sql
-- Add QA Agent tracking columns for Phase 02.1

-- Add QA Agent tracking columns to pipeline_runs
ALTER TABLE pipeline_runs
  ADD COLUMN questions_qa_passed INTEGER DEFAULT 0,
  ADD COLUMN questions_qa_rewritten INTEGER DEFAULT 0,
  ADD COLUMN questions_qa_rejected INTEGER DEFAULT 0;

-- Add QA rewrite tracking to questions
ALTER TABLE questions
  ADD COLUMN qa_rewritten BOOLEAN DEFAULT false;
