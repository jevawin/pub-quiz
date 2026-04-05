-- supabase/migrations/00003_enrichment_agent.sql
-- Add fun_fact column and enrichment tracking

-- Fun fact for post-answer display and future SMS feature
ALTER TABLE questions
  ADD COLUMN fun_fact TEXT DEFAULT NULL;

-- Track enrichment stats in pipeline runs
ALTER TABLE pipeline_runs
  ADD COLUMN questions_enriched INTEGER DEFAULT 0;
