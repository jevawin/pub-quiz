---
quick_id: 260424-tla
phase: quick
plan: 260424-tla
subsystem: pipeline
tags: [migrations, observability, pipeline, feedback]
dependency_graph:
  requires: []
  provides:
    - questions.knowledge_sourced_at
    - questions.fact_checked_at
    - questions.qa_passed_at
    - questions.enriched_at
    - questions.fun_fact_checked_at
    - question_feedback.resolved_at
    - question_feedback.resolved_note
  affects:
    - pipeline/src/agents/fact-check.ts
    - pipeline/src/agents/qa.ts
    - pipeline/src/agents/enrichment.ts
tech_stack:
  added: []
  patterns:
    - "Agent update payloads include tracking timestamp alongside business fields"
    - "Backfill migration uses criteria-based UPDATE with IS NULL guard for idempotency"
key_files:
  created:
    - supabase/migrations/00019_feedback_resolution.sql
    - supabase/migrations/00020_questions_pipeline_tracking.sql
    - supabase/migrations/00021_pipeline_tracking_backfill.sql
  modified:
    - pipeline/src/agents/fact-check.ts
    - pipeline/src/agents/qa.ts
    - pipeline/src/agents/enrichment.ts
    - pipeline/tests/agents/qa.test.ts
decisions:
  - "knowledge.ts not modified: Knowledge Agent has no question ID at source-fetch time; backfill migration covers existing data, agents downstream (fact-check, qa) will stamp future questions"
  - "qa_passed_at stamped unconditionally for pass path — fires for all scores, not just score >= 3 — because QA passed regardless of whether the question was published"
metrics:
  duration: 18min
  completed: 2026-04-24
  tasks_completed: 2
  files_changed: 7
---

# Quick 260424-tla: Pipeline Tracking Columns + Feedback Resolution Summary

One-liner: Five nullable TIMESTAMPTZ pipeline-stage columns on questions + resolved_at/resolved_note on question_feedback, with agents stamping their column on every successful update.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write three migrations | f1e248c | 00019, 00020, 00021 SQL files |
| 2 | Wire tracking timestamps into agents | 8fb242e | fact-check.ts, qa.ts, enrichment.ts, qa.test.ts |

## What Was Built

**00019_feedback_resolution.sql** — Adds `resolved_at TIMESTAMPTZ` and `resolved_note TEXT` to `question_feedback`. Operators can now mark actioned feedback as resolved with an optional note.

**00020_questions_pipeline_tracking.sql** — Adds five nullable TIMESTAMPTZ columns to `questions`: `knowledge_sourced_at`, `fact_checked_at`, `qa_passed_at`, `enriched_at`, `fun_fact_checked_at`. All null by default (null = stage not yet run on this question). `fun_fact_checked_at` is reserved for a future fact-check agent on fun facts.

**00021_pipeline_tracking_backfill.sql** — Approximate backfill for existing data:
- Sets `enriched_at = now()` for questions with `fun_fact IS NOT NULL`
- Sets `knowledge_sourced_at`, `fact_checked_at`, `qa_passed_at = now()` for questions at `verification_score = 3` (native pipeline, all three steps ran). OpenTDB imports at score=2 stay null — they bypassed the pipeline.

**fact-check.ts** — `fact_checked_at: new Date().toISOString()` added to both verified-outcome update blocks: Wikipedia path (line 161) and own-knowledge path (line 239). Rejection paths unchanged.

**qa.ts** — `qa_passed_at: new Date().toISOString()` added to the rewrite `updateData` object (line 237) and initialised unconditionally in the pass `passUpdateData` object (line 283). The pass path previously only ran a DB update when there was something to change; it now always fires for passed questions (to stamp the timestamp). Score 1-2 pass questions get `qa_passed_at` stamped but status stays `verified` (not published).

**enrichment.ts** — `enriched_at: new Date().toISOString()` added to the `fun_fact` update payload (line 135).

## Migrations Pushed to Remote

All three migrations applied via `supabase db push`. Verified on remote:
- `questions` table: `enriched_at`, `fact_checked_at`, `fun_fact_checked_at`, `knowledge_sourced_at`, `qa_passed_at` all present
- `question_feedback` table: `resolved_at`, `resolved_note` both present

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] QA test "leaves score 1-2 questions as verified after QA pass (no DB update)" broken by design change**
- Found during: Task 2 verification
- Issue: Adding `qa_passed_at` unconditionally to `passUpdateData` caused the DB update to always fire for passed questions, breaking the test assertion that expected no update for score 1-2 questions.
- Fix: Updated the test to assert the new correct behavior — update now fires, contains `qa_passed_at`, but `status` is undefined (no publish). Renamed test to "stamps qa_passed_at, no publish".
- Files modified: pipeline/tests/agents/qa.test.ts
- Commit: 8fb242e

### Known Pre-existing Failures (Out of Scope)

The worktree at `.claude/worktrees/agent-a4674321/` causes the vitest discovery to pick up duplicate test files that fail with `ERR_MODULE_NOT_FOUND` (the worktree has no installed `node_modules`). This is pre-existing and unrelated to this task. The canonical pipeline test suite (96 tests) passes in full.

## Self-Check

Files created:
- supabase/migrations/00019_feedback_resolution.sql: FOUND
- supabase/migrations/00020_questions_pipeline_tracking.sql: FOUND
- supabase/migrations/00021_pipeline_tracking_backfill.sql: FOUND

Commits:
- f1e248c (migrations): FOUND
- 8fb242e (agent wiring): FOUND

## Self-Check: PASSED
