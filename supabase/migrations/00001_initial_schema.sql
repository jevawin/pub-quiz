-- supabase/migrations/00001_initial_schema.sql
-- Initial schema for the Pub Quiz question pipeline.
-- Tables: categories, sources, questions, pipeline_runs

-- Categories: adjacency list with max 4 levels (depth 0-3)
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  depth INTEGER NOT NULL DEFAULT 0 CHECK (depth >= 0 AND depth <= 3),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL DEFAULT 'pipeline'
);

CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_slug ON categories(slug);

-- Sources: Wikipedia content stored for audit trail
CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sources_category ON sources(category_id);
CREATE UNIQUE INDEX idx_sources_content_hash ON sources(content_hash);

-- Questions: core quiz content
CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
  question_text TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  distractors JSONB NOT NULL DEFAULT '[]'::jsonb,
  explanation TEXT,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'normal', 'hard')),
  verification_score INTEGER NOT NULL DEFAULT 0 CHECK (verification_score >= 0 AND verification_score <= 3),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected', 'published')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  CONSTRAINT chk_distractors_count CHECK (jsonb_array_length(distractors) = 3)
);

CREATE INDEX idx_questions_category ON questions(category_id);
CREATE INDEX idx_questions_status ON questions(status);
CREATE INDEX idx_questions_difficulty ON questions(difficulty);
CREATE INDEX idx_questions_verification ON questions(verification_score);
CREATE INDEX idx_questions_published ON questions(published_at) WHERE status = 'published';

-- Pipeline runs: tracking and cost monitoring (COST-03)
CREATE TABLE pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  error_message TEXT,
  categories_processed INTEGER DEFAULT 0,
  categories_failed INTEGER DEFAULT 0,
  sources_fetched INTEGER DEFAULT 0,
  sources_failed INTEGER DEFAULT 0,
  questions_generated INTEGER DEFAULT 0,
  questions_failed INTEGER DEFAULT 0,
  questions_verified INTEGER DEFAULT 0,
  questions_rejected INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  estimated_cost_usd NUMERIC(10, 4) DEFAULT 0,
  config JSONB
);

CREATE INDEX idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX idx_pipeline_runs_started ON pipeline_runs(started_at DESC);

-- Row Level Security
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

-- Public read for all categories
CREATE POLICY "Public can read categories"
  ON categories FOR SELECT
  USING (true);

-- Public read for published questions only
CREATE POLICY "Public can read published questions"
  ON questions FOR SELECT
  USING (status = 'published');

-- Sources: no public policies (pipeline-only via service-role key)
-- Pipeline runs: no public policies (pipeline-only via service-role key)
-- No INSERT/UPDATE/DELETE policies for anon/authenticated
-- Pipeline uses service-role key which bypasses RLS entirely
