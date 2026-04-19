-- Staging table for bulk imports from external question sources (e.g. OpenTDB).
-- Rows land here for human review, then are promoted into `questions`.

CREATE TABLE questions_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Provenance
  source TEXT NOT NULL,                    -- 'opentdb' etc.
  external_id TEXT,                        -- stable id/hash from the source
  raw_payload JSONB NOT NULL,              -- original record for audit

  -- Mapped question content (ready to promote)
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  question_text TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  distractors JSONB NOT NULL DEFAULT '[]'::jsonb,
  fun_fact TEXT,
  difficulty TEXT CHECK (difficulty IN ('easy', 'normal', 'hard')),

  -- Claude's per-question judgement
  claude_verdict TEXT CHECK (claude_verdict IN ('keep', 'skip', 'uncertain')),
  claude_reason TEXT,

  -- Duplicate detection
  dup_of_question_id UUID REFERENCES questions(id) ON DELETE SET NULL,
  dup_score NUMERIC,

  -- Review workflow
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected', 'imported')),
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_staging_source_external UNIQUE (source, external_id),
  CONSTRAINT chk_staging_distractors CHECK (jsonb_array_length(distractors) <= 3)
);

CREATE INDEX idx_staging_review_status ON questions_staging(review_status);
CREATE INDEX idx_staging_verdict ON questions_staging(claude_verdict);
CREATE INDEX idx_staging_category ON questions_staging(category_id);
CREATE INDEX idx_staging_dup ON questions_staging(dup_of_question_id) WHERE dup_of_question_id IS NOT NULL;
