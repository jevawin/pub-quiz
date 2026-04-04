---
phase: 01-question-pipeline-agents-schema
verified: 2026-04-04T19:30:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 1: Question Pipeline, Agents, and Schema — Verification Report

**Phase Goal:** An autonomous pipeline produces verified quiz questions and writes them to Supabase, with the database schema ready for both pipeline writes and future app reads.
**Verified:** 2026-04-04T19:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| #  | Truth                                                                                                                                                             | Status     | Evidence                                                                                                             |
|----|-------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------|----------------------------------------------------------------------------------------------------------------------|
| 1  | Supabase PostgreSQL schema exists with tables for questions, categories, wrong answers, explanations, sources, difficulty ratings, and pipeline jobs — with RLS enforced on every table | ✓ VERIFIED | `supabase/migrations/00001_initial_schema.sql`: 4 CREATE TABLE, 4 ENABLE ROW LEVEL SECURITY, 2 CREATE POLICY        |
| 2  | Category Agent can discover and propose new subcategories starting from the 12 seed themes                                                                        | ✓ VERIFIED | `pipeline/src/agents/category.ts` exports `runCategoryAgent`; calls Claude with seed context; 11 unit tests pass     |
| 3  | Knowledge Agent can find and store reference material for a given category using Wikipedia                                                                         | ✓ VERIFIED | `pipeline/src/agents/knowledge.ts` exports `runKnowledgeAgent`; uses MediaWiki Action API; integration test hits real API and passes |
| 4  | Questions Agent can generate multiple-choice questions (1 correct + 3 plausible distractors) with explanations and difficulty ratings                              | ✓ VERIFIED | `pipeline/src/agents/questions.ts` exports `runQuestionsAgent`; validates distractors length=3 via Zod + case-insensitive collision check; 13 unit tests pass |
| 5  | Fact-Check Agent can independently verify answers using RAG against external sources and assign verification strength scores (0-3)                                 | ✓ VERIFIED | `pipeline/src/agents/fact-check.ts` exports `runFactCheckAgent`; uses Claude Haiku against stored Wikipedia text; HAIKU cost rates used; auto-publishes only score >= 3; 13 unit tests pass |

**Score:** 5/5 truths verified

---

### Required Artifacts

#### Plan 01-01 Artifacts

| Artifact                                       | Expected                                               | Status     | Details                                                                                      |
|------------------------------------------------|--------------------------------------------------------|------------|----------------------------------------------------------------------------------------------|
| `supabase/migrations/00001_initial_schema.sql` | All table definitions, indexes, RLS policies           | ✓ VERIFIED | 4 tables (categories, sources, questions, pipeline_runs), 4 RLS enablements, 2 public policies, all CHECK constraints present |
| `supabase/seed.sql`                            | 12 seed categories as root-level entries               | ✓ VERIFIED | Single INSERT with 12 value rows; all 12 slugs present (science, history, movies-and-tv, etc.) |
| `pipeline/package.json`                        | Pipeline project with all dependencies                 | ✓ VERIFIED | Contains @anthropic-ai/sdk, @supabase/supabase-js, zod, eslint, vitest, typescript-eslint    |
| `pipeline/package-lock.json`                   | Locked dependency tree                                 | ✓ VERIFIED | File present — required for `npm ci` in GitHub Actions                                       |
| `pipeline/.gitignore`                          | Ignores node_modules, dist, .env, *.tsbuildinfo        | ✓ VERIFIED | All four entries confirmed                                                                   |
| `pipeline/eslint.config.js`                    | ESLint 9 flat config with TypeScript support           | ✓ VERIFIED | Uses `tseslint.config()` flat config format — not legacy .eslintrc                           |
| `pipeline/src/lib/supabase.ts`                 | Typed Supabase service-role client                     | ✓ VERIFIED | Exports `createSupabaseClient`; imports `Database` from `./database.types.js`                |
| `pipeline/src/lib/claude.ts`                   | Anthropic client with token tracking and budget        | ✓ VERIFIED | Exports `createClaudeClient`, `trackUsage`, `checkBudget`, `BudgetExceededError`, `createTokenAccumulator`; cost constants SONNET_INPUT=3, HAIKU_INPUT=1 |
| `pipeline/src/lib/wikipedia.ts`                | MediaWiki Action API helper                            | ✓ VERIFIED | Exports `getArticleText`, `searchArticles`; uses `https://en.wikipedia.org/w/api.php`; comment notes D-09 rationale |
| `pipeline/src/lib/schemas.ts`                  | Zod schemas for all agent outputs                      | ✓ VERIFIED | Exports `CategoryProposalSchema`, `QuestionGeneratedSchema` (distractors `.length(3)`), `FactCheckResultSchema` (score 0-3) |
| `pipeline/src/lib/logger.ts`                   | Structured logging helper                              | ✓ VERIFIED | Exports `log` function with timestamp, level prefix, optional data JSON                      |
| `pipeline/src/lib/database.types.ts`           | Manual Database type bridge                            | ✓ VERIFIED | TEMPORARY comment present with `supabase gen types` replacement instructions                 |
| `pipeline/README.md`                           | Setup checklist                                        | ✓ VERIFIED | Contains supabase link, db push, GitHub secrets instructions                                 |

#### Plan 01-02 Artifacts

| Artifact                                               | Expected                                              | Status     | Details                                                                            |
|--------------------------------------------------------|-------------------------------------------------------|------------|------------------------------------------------------------------------------------|
| `pipeline/src/agents/category.ts`                      | Category Agent with prompt cap, per-item error handling | ✓ VERIFIED | Exports `runCategoryAgent`; has 50-leaf cap logic; try/catch per item; `log()` used |
| `pipeline/src/agents/knowledge.ts`                     | Knowledge Agent with Wikipedia integration            | ✓ VERIFIED | Exports `runKnowledgeAgent`; SHA-256 hash dedup; encodeURIComponent for URL        |
| `pipeline/tests/agents/category.test.ts`               | Unit tests with mocked Claude + Supabase              | ✓ VERIFIED | 11 tests pass                                                                      |
| `pipeline/tests/agents/knowledge.test.ts`              | Unit tests with mocked Wikipedia + Supabase           | ✓ VERIFIED | Tests pass (count included in 63 total)                                            |
| `pipeline/tests/lib/wikipedia.test.ts`                 | Unit tests for Wikipedia helper                       | ✓ VERIFIED | Tests pass                                                                         |
| `pipeline/tests/integration/wikipedia.integration.test.ts` | Integration test skipped in CI                   | ✓ VERIFIED | Uses `describe.skipIf(process.env.CI === 'true')`; BOTH integration tests pass against real Wikipedia API |

#### Plan 01-03 Artifacts

| Artifact                                    | Expected                                                   | Status     | Details                                                                                        |
|---------------------------------------------|------------------------------------------------------------|------------|------------------------------------------------------------------------------------------------|
| `pipeline/src/agents/questions.ts`          | Questions Agent with dedup cap, source-only instruction    | ✓ VERIFIED | Exports `runQuestionsAgent`; DEDUP_CAP=20 constant; SYSTEM_PROMPT includes "ONLY from facts that appear in the provided text"; 13 tests pass |
| `pipeline/src/agents/fact-check.ts`         | Fact-Check Agent with 0-3 scoring, auto-publish at >= 3    | ✓ VERIFIED | Exports `runFactCheckAgent`; uses `config.claudeModelVerification` (Haiku); score>=3 → published+published_at; score 1-2 → verified only; 13 tests pass |
| `pipeline/tests/agents/questions.test.ts`   | Unit tests for Questions Agent                             | ✓ VERIFIED | 13 tests pass                                                                                  |
| `pipeline/tests/agents/fact-check.test.ts`  | Unit tests for Fact-Check Agent                            | ✓ VERIFIED | 13 tests pass; includes separate tests for score=2 (no publish) vs score=3 (publish)           |

#### Plan 01-04 Artifacts

| Artifact                                     | Expected                                                     | Status     | Details                                                                                 |
|----------------------------------------------|--------------------------------------------------------------|------------|-----------------------------------------------------------------------------------------|
| `pipeline/src/run-pipeline.ts`               | Sequential orchestrator with concurrent-run guard            | ✓ VERIFIED | Exports `runPipeline`; imports all 4 agents; concurrent guard queries `status='running'`; updates pipeline_runs on success/fail; config snapshot stored; process.exit(1) on failure |
| `.github/workflows/question-pipeline.yml`    | GitHub Actions daily cron + manual trigger                   | ✓ VERIFIED | schedule cron='23 4 * * *'; workflow_dispatch with inputs; timeout-minutes:30; npm ci; Health check step; tsx src/run-pipeline.ts |
| `pipeline/tests/run-pipeline.test.ts`        | Unit tests for orchestrator                                  | ✓ VERIFIED | Tests pass (included in 63 total)                                                       |

---

### Key Link Verification

| From                              | To                              | Via                              | Status   | Details                                                                  |
|-----------------------------------|---------------------------------|----------------------------------|----------|--------------------------------------------------------------------------|
| `pipeline/src/lib/supabase.ts`    | `pipeline/src/lib/database.types.ts` | Imports `Database` type     | ✓ WIRED  | `import { Database } from './database.types.js'`                         |
| `pipeline/src/lib/claude.ts`      | `pipeline/src/lib/config.ts`    | `budgetCapUsd` from config       | ✓ WIRED  | `checkBudget(accumulator, budgetCapUsd)` — parameter flows from config   |
| `pipeline/src/agents/category.ts` | `pipeline/src/lib/claude.ts`    | `createClaudeClient`, `trackUsage` | ✓ WIRED | Both imported and called                                                 |
| `pipeline/src/agents/category.ts` | `pipeline/src/lib/supabase.ts`  | Inserts into categories table    | ✓ WIRED  | `.from('categories').insert(...)`                                        |
| `pipeline/src/agents/knowledge.ts` | `pipeline/src/lib/wikipedia.ts` | `getArticleText`, `searchArticles` | ✓ WIRED | Both imported and called                                                |
| `pipeline/src/agents/knowledge.ts` | `pipeline/src/lib/supabase.ts`  | Inserts into sources table       | ✓ WIRED  | `.from('sources').insert(...)`                                           |
| `pipeline/src/agents/questions.ts` | `pipeline/src/lib/supabase.ts`  | Reads sources, inserts questions | ✓ WIRED  | `.from('sources')...` and `.from('questions').insert(...)`               |
| `pipeline/src/agents/questions.ts` | `pipeline/src/lib/claude.ts`    | `createClaudeClient`, `trackUsage` | ✓ WIRED | Both imported and called                                                |
| `pipeline/src/agents/fact-check.ts` | `pipeline/src/lib/supabase.ts` | Reads questions, updates scores  | ✓ WIRED  | `.from('questions').select(...)` and `.from('questions').update(...)`    |
| `pipeline/src/agents/fact-check.ts` | `pipeline/src/lib/claude.ts`   | `HAIKU_INPUT`, `HAIKU_OUTPUT`    | ✓ WIRED  | Both imported and used in `trackUsage` call                              |
| `pipeline/src/run-pipeline.ts`    | `pipeline/src/agents/category.ts` | `runCategoryAgent`             | ✓ WIRED  | Imported and called first in sequence                                    |
| `pipeline/src/run-pipeline.ts`    | `pipeline/src/agents/knowledge.ts` | `runKnowledgeAgent`           | ✓ WIRED  | Imported and called second in sequence                                   |
| `pipeline/src/run-pipeline.ts`    | `pipeline/src/agents/questions.ts` | `runQuestionsAgent`           | ✓ WIRED  | Imported and called third in sequence                                    |
| `pipeline/src/run-pipeline.ts`    | `pipeline/src/agents/fact-check.ts` | `runFactCheckAgent`          | ✓ WIRED  | Imported and called fourth in sequence                                   |
| `pipeline/src/run-pipeline.ts`    | `pipeline/src/lib/supabase.ts`  | Creates and updates pipeline_runs | ✓ WIRED | `.from('pipeline_runs').insert(...)` and `.update(...)` on success/fail |
| `.github/workflows/question-pipeline.yml` | `pipeline/src/run-pipeline.ts` | `npx tsx src/run-pipeline.ts` | ✓ WIRED | Line 71 of workflow file                                                |

---

### Data-Flow Trace (Level 4)

The pipeline is code that writes to Supabase — it does not render UI. Data-flow tracing applies to the question publication path:

| Artifact                          | Data Variable         | Source                                      | Produces Real Data | Status       |
|-----------------------------------|-----------------------|---------------------------------------------|--------------------|--------------|
| `pipeline/src/agents/questions.ts` | `parsedBatch.questions` | Claude API call against stored Wikipedia content | Yes — real Claude responses validated by Zod | ✓ FLOWING |
| `pipeline/src/agents/fact-check.ts` | `result.verification_score` | Claude Haiku against source text, parsed via `FactCheckBatchSchema` | Yes — RAG against stored content | ✓ FLOWING |
| `pipeline/src/agents/knowledge.ts` | `content`             | Real Wikipedia API (MediaWiki Action API)   | Yes — confirmed by live integration test | ✓ FLOWING |
| `pipeline/src/run-pipeline.ts`    | `tokenAccumulator`    | Shared across all agents via `trackUsage`   | Yes — accumulates real API response usage tokens | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior                                 | Command                                  | Result                          | Status  |
|------------------------------------------|------------------------------------------|---------------------------------|---------|
| All 63 unit + integration tests pass     | `cd pipeline && npx vitest run`          | 7 test files, 63 tests, 0 failures | ✓ PASS |
| TypeScript compiles with strict mode     | `cd pipeline && npx tsc --noEmit`        | No output (exit 0)              | ✓ PASS  |
| Wikipedia API returns real data          | Integration test (live)                  | searchArticles + getArticleText both return non-null data | ✓ PASS |
| GitHub Actions workflow is valid YAML    | Grep key fields                          | schedule, workflow_dispatch, timeout-minutes, npm ci, tsx all present | ✓ PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description                                                                             | Status      | Evidence                                                                               |
|-------------|-------------|-----------------------------------------------------------------------------------------|-------------|----------------------------------------------------------------------------------------|
| DB-01       | 01-01       | Supabase PostgreSQL schema for questions, categories, wrong answers, explanations, sources, and difficulty ratings | ✓ SATISFIED | `00001_initial_schema.sql` has all required tables; wrong answers as `distractors JSONB`; explanation column; difficulty CHECK constraint |
| DB-02       | 01-01       | Row-level security enforced from first migration                                        | ✓ SATISFIED | 4 ENABLE ROW LEVEL SECURITY statements; public read for categories + published questions; no public write |
| PIPE-01     | 01-01, 01-04 | Pipeline runs as an independent cloud service decoupled from the app                  | ✓ SATISFIED | `pipeline/` is a standalone Node project; GitHub Actions workflow is the execution environment; writes to Supabase, app reads independently |
| PIPE-04     | 01-02       | Category Agent — discovers and proposes categories/subcategories from 12 seed themes   | ✓ SATISFIED | `category.ts` proposes subcategories via Claude structured output; depth enforcement; 50-leaf cap; 11 tests |
| PIPE-05     | 01-02       | Knowledge Agent — finds quality reference material per category (Wikipedia)             | ✓ SATISFIED | `knowledge.ts` uses MediaWiki Action API; SHA-256 dedup; stores in sources table; live API confirmed |
| PIPE-06     | 01-03       | Questions Agent — generates MCQ with correct answer, 3 wrong answers, explanation, difficulty | ✓ SATISFIED | `questions.ts` generates via Claude Sonnet; validates distractors via Zod + collision check; status='pending' |
| PIPE-07     | 01-03       | Fact-Check Agent — independently verifies using RAG (not LLM-on-LLM)                  | ✓ SATISFIED | `fact-check.ts` system prompt explicitly says "ONLY on the provided reference text, Do NOT use your own knowledge"; uses stored Wikipedia source text |
| PIPE-08     | 01-01       | Wikipedia integration strategy researched and implemented                               | ✓ SATISFIED | MediaWiki Action API implemented per D-09; note in `wikipedia.ts` code comment; D-09 decision documented |
| PIPE-09     | 01-04       | Pipeline execution environment decided and implemented                                  | ✓ SATISFIED | GitHub Actions with daily cron + manual dispatch; npm ci with lockfile; 30-min timeout; Health check step |
| COST-03     | 01-01, 01-04 | Pipeline cost controls — rate limiting, budget caps, monitoring                        | ✓ SATISFIED | `BudgetExceededError` with `budgetCapUsd` checked after every Claude call; `pipeline_runs.estimated_cost_usd` tracked; `PIPELINE_BUDGET_USD` env var configurable in workflow |

**All 10 required requirements satisfied.**

No orphaned requirements detected — all 10 IDs declared across plans are accounted for.

---

### Anti-Patterns Found

Scanning for stubs, placeholder text, and hardcoded empty returns in modified files:

| File | Pattern | Assessment | Severity |
|------|---------|------------|----------|
| `pipeline/src/agents/questions.ts` (line 220) | `as never` cast workaround on Supabase insert | TypeScript type workaround for complex JSONB insert; insert still functions correctly; tests confirm behaviour | ℹ️ Info |
| `pipeline/src/agents/fact-check.ts` (lines 133, 157, 183) | `as never` cast workaround on Supabase updates | Same pattern — workaround for Supabase generic type inference with status literals; functionally correct | ℹ️ Info |

No blocker or warning anti-patterns found. No TODO/FIXME/placeholder comments in production code. No empty return stubs. No hardcoded empty arrays flowing to rendering. The `as never` casts are TypeScript type inference workarounds, not functional gaps — the underlying operations are correct and tested.

---

### Human Verification Required

The following cannot be verified programmatically:

#### 1. Pipeline End-to-End Against Live Supabase

**Test:** Set real `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` in `pipeline/.env` and run `cd pipeline && npx tsx src/run-pipeline.ts`.
**Expected:** All 4 agents run in sequence; `pipeline_runs` record appears in Supabase with `status='success'`; new categories, sources, and questions rows visible in dashboard; at least some questions reach `status='verified'` or `status='published'`.
**Why human:** Requires live Supabase project with applied migration — cannot test without external service credentials.

#### 2. GitHub Actions Workflow Execution

**Test:** In the GitHub repository, navigate to Actions > Question Pipeline > Run workflow.
**Expected:** Workflow completes with green checkmark; logs show all 4 agents starting and completing; Supabase health check passes; no pipeline failure.
**Why human:** Requires GitHub repository with secrets configured (`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).

#### 3. Supabase Migration Applied to Remote Project

**Test:** Run `supabase db push` against a linked Supabase project.
**Expected:** All 4 tables created; RLS enabled; seed data visible in Table Editor.
**Why human:** Requires a real Supabase project linked via `supabase link --project-ref`.

---

### Gaps Summary

No gaps. All 5 observable truths from the ROADMAP.md success criteria are verified. All 10 requirement IDs are satisfied. TypeScript compiles clean. All 63 tests pass including live Wikipedia integration tests. No blocker anti-patterns found.

The three items in Human Verification are operational readiness checks requiring external service access — they do not block goal achievement in the codebase. The code is correct and complete.

---

_Verified: 2026-04-04T19:30:00Z_
_Verifier: Claude (gsd-verifier)_
