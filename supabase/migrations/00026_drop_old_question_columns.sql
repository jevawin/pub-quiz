-- Migration 00026 (Phase 999.8 Plan 05) — drop legacy questions columns.
--
-- Cutover step: now that question_categories is fully backfilled (Plan 04 Task 3
-- completed 2026-05-03 with still_missing=0), the old single-category +
-- single-difficulty + scalar-calibration columns on questions can go away.
--
-- This migration is intentionally fail-safe:
--   1. Precondition: aborts with RAISE EXCEPTION if any published question still
--      lacks a question_categories row. The next migration (00027) rewrites the
--      RPCs to read from question_categories only, so a missing-row case would
--      silently disappear from quiz fetches once the columns are dropped.
--   2. Drops the old single-column indexes that depended on the removed columns.
--   3. Drops the four legacy columns: category_id, difficulty,
--      calibration_percent, calibrated_at.
--
-- After this runs, migration 00027 must apply in the same deploy: every existing
-- RPC still references q.difficulty / q.category_id, so without 00027 the DB is
-- temporarily unable to serve quiz traffic. The two migrations are paired by
-- intent — never apply 00026 without 00027 immediately after.
--
-- The pre-existing 00025_category_filter_uses_join_table.sql introduced a
-- compatibility shim that fell back to q.category_id when a question had no
-- question_categories rows. The precondition below guarantees that branch is
-- now dead, so 00027 removes the shim entirely.

-- 1. Precondition: every published question must have ≥1 question_categories row.
DO $$
DECLARE
  missing INT;
BEGIN
  SELECT COUNT(*)
  FROM questions q
  WHERE q.status = 'published'
    AND NOT EXISTS (
      SELECT 1 FROM question_categories qc WHERE qc.question_id = q.id
    )
  INTO missing;

  IF missing > 0 THEN
    RAISE EXCEPTION
      '% published questions still lack question_categories rows; run the Plan 04 backfill before migration 00026',
      missing;
  END IF;
END $$;

-- 2. Drop old single-column indexes (each depends on a column being dropped).
DROP INDEX IF EXISTS idx_questions_category;
DROP INDEX IF EXISTS idx_questions_difficulty;
DROP INDEX IF EXISTS idx_questions_uncalibrated;

-- 3. Drop legacy columns (clean break per D-01).
--    `IF EXISTS` so the migration is safely re-runnable on an environment that
--    already had a partial drop applied manually.
ALTER TABLE questions DROP COLUMN IF EXISTS category_id;
ALTER TABLE questions DROP COLUMN IF EXISTS difficulty;
ALTER TABLE questions DROP COLUMN IF EXISTS calibration_percent;
ALTER TABLE questions DROP COLUMN IF EXISTS calibrated_at;
