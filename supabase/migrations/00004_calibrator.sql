-- supabase/migrations/00004_calibrator.sql
-- Add calibration tracking columns for the Difficulty Calibrator agent

ALTER TABLE questions
  ADD COLUMN calibrated_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN calibration_percent NUMERIC(5, 2) DEFAULT NULL;

-- Index for finding uncalibrated published questions efficiently
CREATE INDEX idx_questions_uncalibrated ON questions(calibrated_at) WHERE status = 'published' AND calibrated_at IS NULL;

-- Track calibration stats in pipeline runs
ALTER TABLE pipeline_runs
  ADD COLUMN questions_calibrated INTEGER DEFAULT 0,
  ADD COLUMN questions_recalibrated INTEGER DEFAULT 0;
