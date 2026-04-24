-- supabase/migrations/00021_pipeline_tracking_backfill.sql
-- Approximate backfill for existing questions. Timestamps are now(), not exact run times.
-- Criteria:
--   enriched_at    <- questions WHERE fun_fact IS NOT NULL (enrichment agent ran)
--   knowledge_sourced_at, fact_checked_at, qa_passed_at
--                  <- questions WHERE verification_score = 3 (native pipeline, all steps ran)
--   OpenTDB imports (score=2) stay null -- they bypassed the pipeline.

UPDATE questions
  SET enriched_at = now()
  WHERE fun_fact IS NOT NULL
    AND enriched_at IS NULL;

UPDATE questions
  SET knowledge_sourced_at = now(),
      fact_checked_at = now(),
      qa_passed_at = now()
  WHERE verification_score = 3
    AND knowledge_sourced_at IS NULL;
