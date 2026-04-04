# Phase 1: Question Pipeline -- Agents & Schema - Research

**Researched:** 2026-04-04
**Domain:** AI agent pipeline (Claude API), PostgreSQL schema design (Supabase), Wikipedia data ingestion, GitHub Actions orchestration
**Confidence:** HIGH

## Summary

This phase builds a 4-agent pipeline (Category, Knowledge, Questions, Fact-Check) that runs as a GitHub Actions cron workflow, calls the Anthropic Claude API via the TypeScript SDK, fetches reference material from Wikipedia, and writes verified quiz questions to a Supabase PostgreSQL database. The schema must support hierarchical categories (adjacency list), questions with JSONB distractors, verification scoring, and pipeline run tracking -- all with RLS enforced.

The technical stack is well-understood: `@anthropic-ai/sdk` (0.82.0) provides structured output and tool use, Supabase (supabase-js 2.101.1) handles all database operations with service-role key for pipeline writes, and Wikipedia's MediaWiki Action API (`action=query&prop=extracts`) delivers plain-text article content. GitHub Actions cron workflows are reliable and free-tier generous for daily runs. The main complexity is prompt engineering for question quality and the Fact-Check Agent's independent verification logic.

**Primary recommendation:** Build each agent as a standalone TypeScript script using `@anthropic-ai/sdk` with structured output (Zod schemas) for type-safe question generation. Use the MediaWiki Action API (TextExtracts) for Wikipedia content -- not the REST API which is being deprecated. Pipeline writes use a Supabase client initialized with `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS. Track token usage from each API response's `usage` object to implement COST-03 budget caps.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Agents run via GitHub Actions cron workflows -- not Claude Code Remote Triggers
- **D-02:** Agents call Claude via the Anthropic TypeScript SDK (`@anthropic-ai/sdk`) directly
- **D-03:** Pipeline scripts written in TypeScript
- **D-04:** Pipeline lives in a `/pipeline` directory in this monorepo
- **D-05:** Agents run as a sequential pipeline: Category -> Knowledge -> Questions -> Fact-Check
- **D-06:** Each run processes work in configurable batches
- **D-07:** On failure, the pipeline stops and reports via GitHub Actions notification. No retry logic.
- **D-08:** Each agent is a separate script file
- **D-09:** Knowledge Agent accesses Wikipedia via the Wikimedia REST API (note: research recommends Action API instead -- see pitfall below)
- **D-10:** Fetched Wikipedia content stored in a Supabase `sources` table
- **D-11:** Wikipedia only for v1
- **D-12:** Category hierarchy uses adjacency list (parent_id column)
- **D-13:** Wrong answers (distractors) stored as JSONB array column on the questions table
- **D-14:** Verification strength is a simple integer (0-3) on the question row
- **D-15:** Pipeline runs tracked in a `pipeline_runs` table in Supabase

### Claude's Discretion
- Exact batch sizes per agent
- Specific GitHub Actions cron schedule timing
- Supabase table naming conventions and exact column types
- RLS policy implementation details
- Error notification channel

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DB-01 | Supabase PostgreSQL schema for questions, categories, wrong answers, explanations, sources, and difficulty ratings | Schema design section covers all tables, columns, types, indexes |
| DB-02 | Row-level security enforced from first migration -- public read for published, service-role write for pipeline | RLS patterns section covers exact policy types needed |
| PIPE-01 | Pipeline runs as independent cloud service, decoupled from app | GitHub Actions cron workflow pattern, `/pipeline` directory structure |
| PIPE-04 | Category Agent -- discovers and proposes categories/subcategories from 12 seed themes | Claude structured output with Zod schemas, adjacency list insertion |
| PIPE-05 | Knowledge Agent -- finds quality reference material per category (Wikipedia) | MediaWiki Action API TextExtracts endpoint, sources table storage |
| PIPE-06 | Questions Agent -- generates MCQ with correct answer, 3 distractors, explanation, difficulty | Claude structured output, JSONB distractors, prompt engineering patterns |
| PIPE-07 | Fact-Check Agent -- independently verifies answers using RAG against sources (0-3 score) | Wikipedia cross-verification pattern, verification_score column |
| PIPE-08 | Wikipedia integration strategy | MediaWiki Action API (TextExtracts + Parse), rate limits, content storage |
| PIPE-09 | Pipeline execution environment decided and implemented | GitHub Actions (decided in D-01), workflow configuration, tsx runner |
| COST-03 | Pipeline cost controls -- rate limiting, budget caps, monitoring | Token tracking from API response `usage` object, `pipeline_runs` table, budget cap logic |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack**: Supabase (PostgreSQL + Auth + RLS + Edge Functions), TypeScript
- **State management**: Zustand (client) + TanStack Query (server) -- not relevant to pipeline phase
- **Supabase version**: supabase-js 2.101.x
- **TypeScript**: strict mode
- **Type generation**: `supabase gen types typescript` for DB types
- **Zod**: 3.x for runtime validation
- **Avoid**: AsyncStorage, Redux, custom WebSockets, NativeWind v5

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @anthropic-ai/sdk | 0.82.0 | Claude API client for all 4 agents | Official Anthropic TypeScript SDK. Structured output, tool use, token tracking built-in. |
| @supabase/supabase-js | 2.101.1 | Database client for pipeline writes and reads | Project standard per CLAUDE.md. Service-role client bypasses RLS for pipeline writes. |
| zod | 3.24.x (verified: 4.3.6 available but 3.x per CLAUDE.md) | Schema validation for agent outputs | Validates Claude's structured output matches expected shapes. CLAUDE.md specifies 3.x. |
| tsx | 4.21.0 | TypeScript runner for pipeline scripts | Runs .ts files directly without compilation step. ESM-compatible. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| dotenv | 16.x | Environment variable loading | Local development. GitHub Actions uses secrets natively. |
| date-fns | 4.x | Date manipulation | Pipeline run timestamps, scheduling logic. Per CLAUDE.md. |

**Note on Zod version:** npm shows zod 4.3.6 as latest, but CLAUDE.md specifies "zod 3.x for runtime validation." Stick with zod 3.x (latest 3.24.x) to match the project standard. The `@anthropic-ai/sdk` structured output works with both Zod 3 and 4.

### Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| @anthropic-ai/sdk (direct) | Vercel AI SDK (@ai-sdk/anthropic) | Never for this project. Direct SDK gives full control over prompts, tools, token budgets per D-02. |
| tsx | ts-node | Never. tsx is faster, handles ESM correctly, zero config. |
| MediaWiki Action API | Wikimedia REST API (rest_v1) | Avoid -- RESTBase is being deprecated. Action API is the long-term stable choice. |
| zod 3.x | zod 4.x | Not yet -- CLAUDE.md pins to 3.x. Evaluate when/if CLAUDE.md updates. |

**Installation:**
```bash
# From project root
cd pipeline
npm init -y
npm install @anthropic-ai/sdk@^0.82.0 @supabase/supabase-js@^2.101.1 zod@^3.24.0 date-fns@^4.0.0 dotenv@^16.0.0
npm install -D tsx@^4.21.0 typescript@^5.0.0 @types/node@^22.0.0
```

## Architecture Patterns

### Recommended Project Structure
```
pipeline/
  package.json
  tsconfig.json
  .env.example               # Template for required env vars
  src/
    agents/
      category.ts             # Category Agent entry point
      knowledge.ts            # Knowledge Agent entry point
      questions.ts            # Questions Agent entry point
      fact-check.ts           # Fact-Check Agent entry point
    lib/
      claude.ts               # Shared Anthropic client setup + token tracking
      supabase.ts             # Supabase client (service-role)
      wikipedia.ts            # Wikipedia API helper
      schemas.ts              # Zod schemas for agent outputs
      config.ts               # Batch sizes, budget caps, configurable params
      types.ts                # Re-export of generated Supabase types
    run-pipeline.ts           # Sequential orchestrator: runs all 4 agents in order
.github/
  workflows/
    question-pipeline.yml     # Cron workflow
supabase/
  migrations/
    00001_initial_schema.sql  # Tables, indexes, RLS policies
  seed.sql                    # 12 seed categories
```

### Pattern 1: Structured Output with Zod
**What:** Use Claude's structured output to get type-safe JSON from each agent.
**When to use:** Every agent call that produces data to be stored.
**Example:**
```typescript
// Source: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const QuestionSchema = z.object({
  question_text: z.string(),
  correct_answer: z.string(),
  distractors: z.array(z.string()).length(3),
  explanation: z.string(),
  difficulty: z.enum(['easy', 'normal', 'hard']),
});

const client = new Anthropic();

const response = await client.messages.create({
  model: 'claude-sonnet-4-5-20250514',  // Cost-effective for generation
  max_tokens: 4096,
  system: 'You are a quiz question generator...',
  messages: [{ role: 'user', content: prompt }],
  // Structured output ensures valid JSON matching schema
});

// Parse and validate the response
const parsed = QuestionSchema.parse(JSON.parse(response.content[0].text));
```

### Pattern 2: Token Tracking for Cost Control (COST-03)
**What:** Extract token counts from every API response to enforce budget caps.
**When to use:** Every Claude API call.
**Example:**
```typescript
// Source: https://platform.claude.com/docs/en/build-with-claude/token-counting
interface TokenAccumulator {
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

function trackUsage(response: Anthropic.Message, acc: TokenAccumulator): void {
  acc.input_tokens += response.usage.input_tokens;
  acc.output_tokens += response.usage.output_tokens;
  // Haiku 4.5: $1/$5 per MTok | Sonnet 4.5: $3/$15 per MTok
  acc.estimated_cost_usd +=
    (response.usage.input_tokens / 1_000_000) * INPUT_COST +
    (response.usage.output_tokens / 1_000_000) * OUTPUT_COST;
}

function checkBudget(acc: TokenAccumulator, budgetUsd: number): void {
  if (acc.estimated_cost_usd >= budgetUsd) {
    throw new Error(`Budget cap reached: $${acc.estimated_cost_usd.toFixed(4)} >= $${budgetUsd}`);
  }
}
```

### Pattern 3: Supabase Service-Role Client for Pipeline Writes
**What:** A dedicated Supabase client that bypasses RLS for pipeline inserts.
**When to use:** All pipeline database operations.
**Example:**
```typescript
// Source: https://supabase.com/docs/guides/api/api-keys
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Service-role client -- NEVER expose this key to clients
const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// This bypasses all RLS policies
const { data, error } = await supabase
  .from('questions')
  .insert({
    question_text: 'What is the capital of France?',
    correct_answer: 'Paris',
    distractors: ['London', 'Berlin', 'Madrid'],
    explanation: 'Paris has been the capital of France since...',
    difficulty: 'easy',
    category_id: categoryId,
    verification_score: 0,
    status: 'pending_review',
  });
```

### Pattern 4: Wikipedia Content Fetching
**What:** Use MediaWiki Action API to get article plain text.
**When to use:** Knowledge Agent fetching reference material.
**Example:**
```typescript
// Source: https://www.mediawiki.org/wiki/API:Get_the_contents_of_a_page

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

async function getArticleText(title: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    titles: title,
    explaintext: '1',     // Plain text, not HTML
    exlimit: '1',
    format: 'json',
    formatversion: '2',
  });

  const res = await fetch(`${WIKIPEDIA_API}?${params}`, {
    headers: { 'User-Agent': 'PubQuizPipeline/1.0 (contact@example.com)' },
  });

  const data = await res.json();
  const page = data.query.pages[0];
  if (page.missing) return null;
  return page.extract;
}

async function searchArticles(query: string): Promise<string[]> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '10',
    format: 'json',
    formatversion: '2',
  });

  const res = await fetch(`${WIKIPEDIA_API}?${params}`, {
    headers: { 'User-Agent': 'PubQuizPipeline/1.0 (contact@example.com)' },
  });

  const data = await res.json();
  return data.query.search.map((r: any) => r.title);
}
```

### Pattern 5: Sequential Pipeline Orchestrator
**What:** Run agents in sequence, stop on failure, track results.
**When to use:** The main `run-pipeline.ts` entry point.
**Example:**
```typescript
import { runCategoryAgent } from './agents/category';
import { runKnowledgeAgent } from './agents/knowledge';
import { runQuestionsAgent } from './agents/questions';
import { runFactCheckAgent } from './agents/fact-check';

const config = {
  categoryBatchSize: 5,
  knowledgeBatchSize: 10,
  questionsBatchSize: 20,
  budgetCapUsd: 1.00,  // Per-run cap
};

async function runPipeline() {
  const runId = await createPipelineRun();

  try {
    const categories = await runCategoryAgent(config);
    await logAgentResult(runId, 'category', categories);

    const sources = await runKnowledgeAgent(config);
    await logAgentResult(runId, 'knowledge', sources);

    const questions = await runQuestionsAgent(config);
    await logAgentResult(runId, 'questions', questions);

    const verified = await runFactCheckAgent(config);
    await logAgentResult(runId, 'fact-check', verified);

    await completePipelineRun(runId, 'success');
  } catch (error) {
    await completePipelineRun(runId, 'failed', error);
    process.exit(1); // GitHub Actions marks step as failed
  }
}
```

### Anti-Patterns to Avoid
- **Retrying failed API calls silently:** Per D-07, stop and report. Silent retries hide cost overruns.
- **Storing distractors in a separate `answers` table:** Per D-13, use JSONB array. A separate table adds join complexity for no benefit -- distractors are always fetched with the question.
- **Using REST API (rest_v1) for Wikipedia:** RESTBase is being deprecated. Use the Action API which is the long-term stable API.
- **Hardcoding batch sizes:** Make them configurable via environment variables or a config file for easy tuning without code changes.
- **Creating a single monolithic agent script:** Per D-08, keep each agent in its own file for independent testing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Claude API communication | Custom HTTP client, prompt formatting | `@anthropic-ai/sdk` (0.82.0) | Handles auth, retries, streaming, structured output, token counting |
| JSON schema validation | Manual JSON parsing and type checking | Zod 3.x schemas | Type-safe at compile time and runtime, generates JSON Schema for Claude |
| Database types | Manual TypeScript interfaces for tables | `supabase gen types typescript` | Auto-generates types from actual schema, stays in sync with migrations |
| Wikipedia text extraction | Custom HTML parsing, scraping | MediaWiki Action API `prop=extracts&explaintext=1` | Returns clean plain text directly, no parsing needed |
| Cron scheduling | Custom scheduler, PM2, dedicated server | GitHub Actions `schedule` trigger | Free, reliable, built-in logging, secrets management, notifications |
| Token cost estimation | Manual token counting | `response.usage.input_tokens` / `output_tokens` from SDK | Exact counts from the API, no estimation needed |

## Common Pitfalls

### Pitfall 1: Wikipedia REST API Deprecation
**What goes wrong:** Using `en.wikipedia.org/api/rest_v1/page/summary/{title}` which only returns a short summary (1-2 paragraphs), not full article text. Also, RESTBase is being deprecated.
**Why it happens:** The REST API is more intuitive (clean URLs) but has limited content extraction and is being sunset.
**How to avoid:** Use the MediaWiki Action API: `en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles={title}`. Returns full plain-text article content.
**Warning signs:** Articles with only 2-3 sentences of content in the sources table.
**Note:** D-09 references "Wikimedia REST API" -- the planner should use the Action API instead for full content. The `/page/summary/{title}` endpoint is fine for quick metadata but not for building a knowledge base.

### Pitfall 2: Claude Generating Plausible-Sounding But Wrong Answers
**What goes wrong:** The correct answer generated by Claude is actually incorrect, or distractors are accidentally correct.
**Why it happens:** LLMs hallucinate facts. This is the entire reason the Fact-Check Agent exists.
**How to avoid:** (1) Provide Wikipedia source text in the prompt context for Questions Agent. (2) Fact-Check Agent must verify against stored source text, not generate new knowledge. (3) Questions with verification_score 0 are never shown to users.
**Warning signs:** High percentage of questions failing fact-check, or fact-check passing everything (rubber-stamp).

### Pitfall 3: Unbounded Token Costs
**What goes wrong:** A single pipeline run costs $50+ because of long Wikipedia articles in context or generating too many questions.
**Why it happens:** Claude charges per input token. A 10,000-word Wikipedia article is ~13K tokens. 20 articles = 260K input tokens per call.
**How to avoid:** (1) Truncate Wikipedia content to first N characters (e.g., 5000 chars ~= 1500 tokens). (2) Set a hard budget cap per run (e.g., $1.00). (3) Track cumulative tokens after every API call. (4) Use Haiku 4.5 ($1/$5 per MTok) for fact-checking and Sonnet 4.5 ($3/$15 per MTok) for question generation.
**Warning signs:** Pipeline runs taking >10 minutes, token counts exceeding expectations.

### Pitfall 4: JSONB Distractors Without Validation
**What goes wrong:** Distractors array has wrong number of items (not 3), contains duplicates, or contains the correct answer.
**Why it happens:** Claude's output may not always follow instructions perfectly.
**How to avoid:** (1) Zod schema enforces `.array(z.string()).length(3)`. (2) Add a validation step that checks distractors don't include the correct answer. (3) PostgreSQL CHECK constraint: `jsonb_array_length(distractors) = 3`.
**Warning signs:** Questions with fewer than 4 total options displayed in the app.

### Pitfall 5: RLS Blocking Pipeline Writes
**What goes wrong:** Pipeline inserts fail with permission denied errors.
**Why it happens:** Using the anon key instead of service-role key, or RLS policies that don't account for service-role access.
**How to avoid:** (1) Service-role client (`SUPABASE_SERVICE_ROLE_KEY`) bypasses ALL RLS -- no special policies needed for pipeline writes. (2) RLS policies only need to handle public read access (anon/authenticated users). (3) Never use the anon key in the pipeline.
**Warning signs:** 403 errors in pipeline logs, zero questions appearing in the database after a run.

### Pitfall 6: GitHub Actions Cron Timing Unreliability
**What goes wrong:** Scheduled workflow doesn't run at the expected time, or skips runs during high-demand periods.
**Why it happens:** GitHub Actions cron is best-effort -- during peak load, scheduled workflows can be delayed by 15-60 minutes or even skipped.
**How to avoid:** (1) Don't schedule at common times (top of the hour, midnight UTC). Use odd times like `23 4 * * *`. (2) Design the pipeline to be idempotent -- safe to run twice. (3) Accept that exact timing doesn't matter for daily content generation.
**Warning signs:** Gaps in pipeline_runs table timestamps, runs at unexpected times.

### Pitfall 7: Category Tree Infinite Recursion
**What goes wrong:** Category Agent creates circular parent-child relationships (A -> B -> C -> A).
**Why it happens:** Agent proposes subcategories without checking existing hierarchy.
**How to avoid:** (1) PostgreSQL CHECK constraint or trigger preventing self-referential loops. (2) Max depth check (4 levels per project spec). (3) Validate proposed category against existing tree before insertion.
**Warning signs:** Recursive queries hanging, categories appearing at wrong depth levels.

## Code Examples

### GitHub Actions Workflow
```yaml
# .github/workflows/question-pipeline.yml
name: Question Pipeline

on:
  schedule:
    - cron: '23 4 * * *'  # Daily at 04:23 UTC (odd time avoids congestion)
  workflow_dispatch:        # Allow manual trigger

jobs:
  run-pipeline:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: pipeline/package-lock.json

      - name: Install dependencies
        working-directory: pipeline
        run: npm ci

      - name: Run pipeline
        working-directory: pipeline
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          PIPELINE_BUDGET_USD: '1.00'
          CATEGORY_BATCH_SIZE: '5'
          KNOWLEDGE_BATCH_SIZE: '10'
          QUESTIONS_BATCH_SIZE: '20'
        run: npx tsx src/run-pipeline.ts
```

### Database Schema (Supabase Migration)
```sql
-- supabase/migrations/00001_initial_schema.sql

-- Categories: adjacency list with max 4 levels
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  depth INTEGER NOT NULL DEFAULT 0 CHECK (depth >= 0 AND depth <= 3),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL DEFAULT 'pipeline'  -- 'pipeline' or 'manual'
);

CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_slug ON categories(slug);

-- Sources: Wikipedia content stored for audit trail
CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,                    -- Wikipedia article title
  url TEXT NOT NULL,                      -- Full Wikipedia URL
  content TEXT NOT NULL,                  -- Plain text extract
  content_hash TEXT NOT NULL,             -- SHA-256 for dedup
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
  distractors JSONB NOT NULL DEFAULT '[]'::jsonb,  -- Array of 3 strings
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
  -- Per-agent metrics
  categories_processed INTEGER DEFAULT 0,
  categories_failed INTEGER DEFAULT 0,
  sources_fetched INTEGER DEFAULT 0,
  sources_failed INTEGER DEFAULT 0,
  questions_generated INTEGER DEFAULT 0,
  questions_failed INTEGER DEFAULT 0,
  questions_verified INTEGER DEFAULT 0,
  questions_rejected INTEGER DEFAULT 0,
  -- Cost tracking
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  estimated_cost_usd NUMERIC(10, 4) DEFAULT 0,
  -- Config snapshot
  config JSONB  -- Record batch sizes and model used for this run
);

CREATE INDEX idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX idx_pipeline_runs_started ON pipeline_runs(started_at DESC);

-- Row Level Security
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

-- Public read for published questions and all categories
CREATE POLICY "Public can read categories"
  ON categories FOR SELECT
  USING (true);

CREATE POLICY "Public can read published questions"
  ON questions FOR SELECT
  USING (status = 'published');

-- Sources are internal -- no public read needed
-- (Only accessed by pipeline agents, not the app)

-- Pipeline runs are internal -- no public read needed
-- (Accessed via service-role key or admin dashboard)

-- No INSERT/UPDATE/DELETE policies for anon/authenticated
-- Pipeline uses service-role key which bypasses RLS entirely
```

### Supabase Type Generation
```bash
# Generate TypeScript types from schema (run after migration)
npx supabase gen types typescript --project-id "$SUPABASE_PROJECT_ID" > pipeline/src/lib/types.ts

# Or from local Supabase instance
npx supabase gen types typescript --local > pipeline/src/lib/types.ts
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Wikimedia REST API (RESTBase) | MediaWiki Action API + new MediaWiki REST API | 2025-2026 (deprecation in progress) | Use Action API for content extraction; RESTBase endpoints may stop working after July 2026 |
| Claude beta structured output | GA structured output (output_config.format) | Late 2025 | No beta headers needed; Zod integration stable |
| Custom prompt parsing for JSON | SDK structured output with schema validation | 2025 | Eliminates JSON parsing errors from LLM output |
| Manual token counting | Response `usage` object + Usage & Cost API | 2025 | Exact per-request tracking, no estimation needed |

**Deprecated/outdated:**
- **Wikimedia RESTBase** (`/api/rest_v1/`): Being deprecated, gradual sunset starting July 2026. Use MediaWiki Action API or new MediaWiki REST API instead.
- **Claude beta structured output headers**: No longer needed. Structured output is GA.

## Claude API Cost Estimates for Pipeline

| Model | Input $/MTok | Output $/MTok | Recommended For |
|-------|-------------|---------------|-----------------|
| Haiku 4.5 | $1 | $5 | Fact-Check Agent (simpler verification task) |
| Sonnet 4.5/4.6 | $3 | $15 | Category Agent, Questions Agent (need quality generation) |

**Estimated per-run cost (daily):**
- Category Agent: ~5K input + ~2K output tokens = ~$0.05
- Knowledge Agent: No Claude calls (Wikipedia fetch only) = $0.00
- Questions Agent: ~50K input + ~20K output tokens (20 questions) = ~$0.45
- Fact-Check Agent: ~30K input + ~5K output tokens (Haiku) = ~$0.055
- **Total per daily run: ~$0.55** (well within a $1.00/run budget cap)

These are rough estimates. Actual costs depend on Wikipedia article length and number of questions per batch. The pipeline_runs table tracks exact costs per run.

## Batch Size Recommendations

| Agent | Recommended Batch | Rationale |
|-------|-------------------|-----------|
| Category | 3-5 new subcategories per run | Slow growth prevents low-quality deep categories. 12 seeds x 4 depth = ~500 categories at full build. |
| Knowledge | 5-10 categories per run | Each requires 1-3 Wikipedia fetches. Rate limit is 200 req/s so not a bottleneck. |
| Questions | 10-20 questions per run | Each needs source context in prompt. More = more tokens = more cost. |
| Fact-Check | All pending (unverified) questions | Cheap with Haiku. Process everything generated in this run. |

## Open Questions

1. **Wikipedia content truncation strategy**
   - What we know: Full articles can be 10,000+ words (13K+ tokens). Sending full text is expensive.
   - What's unclear: Optimal truncation length that preserves enough context for quality questions.
   - Recommendation: Start with first 3000 characters (~900 tokens). Test question quality. Adjust up if questions are too shallow.

2. **Question deduplication**
   - What we know: Claude may generate similar questions across runs for the same category.
   - What's unclear: Best dedup strategy -- text similarity? Semantic embedding? Simple exact match?
   - Recommendation: Start with providing existing questions for the category in the prompt context ("Don't generate questions similar to these:"). Add semantic dedup in v2 if needed.

3. **Fact-Check Agent RAG approach**
   - What we know: PIPE-07 says "RAG against external sources (not LLM-on-LLM)." The sources table stores Wikipedia text.
   - What's unclear: How to implement RAG without vector embeddings (pgvector is mentioned as potentially costly in the Cost Risk Register).
   - Recommendation: For v1, simple keyword/passage matching -- give Fact-Check Agent the relevant source text and ask it to verify the answer against that specific text. This is "RAG" in the sense that we retrieve source text and ground the check. Full vector search is v2.

4. **Seed data insertion**
   - What we know: 12 seed categories listed in PROJECT.md.
   - What's unclear: Should seed categories be in a SQL migration or inserted by the Category Agent's first run?
   - Recommendation: SQL seed file (`supabase/seed.sql`) for the 12 root categories. Category Agent then discovers subcategories under these. This ensures the pipeline always has starting points.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Pipeline scripts (tsx) | Yes | v24.14.0 | -- |
| npm | Package management | Yes | 11.9.0 | -- |
| GitHub CLI (gh) | Workflow debugging | Yes | 2.87.0 | -- |
| Supabase CLI | Migrations, type generation | No | -- | Install via `npm install -g supabase` or `brew install supabase/tap/supabase` |
| Anthropic API key | Claude API calls | Unknown | -- | Must be provisioned as GitHub Actions secret |
| Supabase project | Database | Unknown | -- | Must be created via Supabase dashboard |

**Missing dependencies with no fallback:**
- Supabase CLI -- needed for migrations and type generation. Must be installed.
- Supabase project -- must be created. Pipeline cannot run without it.
- Anthropic API key -- must be provisioned. Pipeline cannot generate questions without it.

**Missing dependencies with fallback:**
- None -- all are required.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (not yet installed -- recommend for TypeScript-native testing) |
| Config file | `pipeline/vitest.config.ts` (Wave 0) |
| Quick run command | `cd pipeline && npx vitest run --reporter=verbose` |
| Full suite command | `cd pipeline && npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DB-01 | Schema tables exist with correct columns | integration | `cd pipeline && npx vitest run tests/schema.test.ts -t "schema"` | No -- Wave 0 |
| DB-02 | RLS allows public read, blocks public write | integration | `cd pipeline && npx vitest run tests/rls.test.ts` | No -- Wave 0 |
| PIPE-04 | Category Agent produces valid subcategories | unit | `cd pipeline && npx vitest run tests/agents/category.test.ts` | No -- Wave 0 |
| PIPE-05 | Knowledge Agent fetches and stores Wikipedia content | unit + integration | `cd pipeline && npx vitest run tests/agents/knowledge.test.ts` | No -- Wave 0 |
| PIPE-06 | Questions Agent generates valid MCQ | unit | `cd pipeline && npx vitest run tests/agents/questions.test.ts` | No -- Wave 0 |
| PIPE-07 | Fact-Check Agent verifies answers against sources | unit | `cd pipeline && npx vitest run tests/agents/fact-check.test.ts` | No -- Wave 0 |
| PIPE-08 | Wikipedia API returns article content | unit | `cd pipeline && npx vitest run tests/lib/wikipedia.test.ts` | No -- Wave 0 |
| PIPE-09 | Pipeline runs end-to-end in GitHub Actions | smoke (manual) | `gh workflow run question-pipeline.yml` | No -- Wave 0 |
| COST-03 | Budget cap stops pipeline when exceeded | unit | `cd pipeline && npx vitest run tests/lib/budget.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `cd pipeline && npx vitest run`
- **Per wave merge:** Full suite
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `pipeline/vitest.config.ts` -- Vitest configuration
- [ ] `pipeline/tests/` directory structure
- [ ] All test files listed above
- [ ] Framework install: `cd pipeline && npm install -D vitest`
- [ ] Mock helpers for Claude API responses (avoid real API calls in tests)
- [ ] Mock helpers for Supabase client

## Sources

### Primary (HIGH confidence)
- [@anthropic-ai/sdk npm](https://www.npmjs.com/package/@anthropic-ai/sdk) -- v0.82.0 confirmed via `npm view`
- [@supabase/supabase-js npm](https://www.npmjs.com/package/@supabase/supabase-js) -- v2.101.1 confirmed via `npm view`
- [Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security) -- RLS patterns, service-role bypass
- [Supabase API keys docs](https://supabase.com/docs/guides/api/api-keys) -- service-role key usage
- [MediaWiki API: Get contents of a page](https://www.mediawiki.org/wiki/API:Get_the_contents_of_a_page) -- TextExtracts, Parse API endpoints
- [MediaWiki REST API Reference](https://www.mediawiki.org/wiki/API:REST_API/Reference) -- REST endpoints for search and page content
- [Claude structured outputs docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) -- GA structured output with Zod
- [Claude token counting docs](https://platform.claude.com/docs/en/build-with-claude/token-counting) -- usage tracking per request
- [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) -- Haiku $1/$5, Sonnet $3/$15, Opus $5/$25 per MTok

### Secondary (MEDIUM confidence)
- [Supabase type generation docs](https://supabase.com/docs/guides/api/rest/generating-types) -- `supabase gen types typescript`
- [GitHub Actions cron docs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions) -- schedule syntax, limitations
- [Wikimedia REST API deprecation notice](https://www.mediawiki.org/wiki/Wikimedia_REST_API) -- RESTBase being deprecated
- [Wikimedia rate limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits) -- 200 req/s for REST API

### Tertiary (LOW confidence)
- Claude API cost estimates per run -- based on rough token count estimates, actual usage will vary
- Batch size recommendations -- based on cost/quality tradeoff reasoning, need real-world validation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified on npm, versions confirmed, CLAUDE.md alignment checked
- Architecture: HIGH -- patterns from official docs, schema design follows PostgreSQL best practices
- Pitfalls: HIGH -- based on documented API behaviors, known GitHub Actions limitations, common LLM failure modes
- Cost estimates: MEDIUM -- based on current pricing, actual token usage depends on prompt design and content length
- Batch sizes: LOW -- educated guesses, need real-world tuning

**Research date:** 2026-04-04
**Valid until:** 2026-05-04 (stable domain -- main risk is Wikimedia API deprecation timeline)
