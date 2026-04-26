---
quick_id: 260424-tla
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/00019_feedback_resolution.sql
  - supabase/migrations/00020_questions_pipeline_tracking.sql
  - supabase/migrations/00021_pipeline_tracking_backfill.sql
  - pipeline/src/agents/knowledge.ts
  - pipeline/src/agents/fact-check.ts
  - pipeline/src/agents/qa.ts
  - pipeline/src/agents/enrichment.ts
autonomous: true

must_haves:
  truths:
    - "question_feedback rows can be marked resolved with a timestamp and optional note"
    - "questions table has five nullable TIMESTAMPTZ pipeline tracking columns"
    - "all agents stamp their tracking column on every successful question update"
    - "backfill gives approximate timestamps to existing data that has evidence of pipeline completion"
  artifacts:
    - path: "supabase/migrations/00019_feedback_resolution.sql"
      provides: "resolved_at + resolved_note columns on question_feedback"
    - path: "supabase/migrations/00020_questions_pipeline_tracking.sql"
      provides: "five pipeline tracking TIMESTAMPTZ columns on questions"
    - path: "supabase/migrations/00021_pipeline_tracking_backfill.sql"
      provides: "approximate backfill for existing data"
    - path: "pipeline/src/agents/knowledge.ts"
      provides: "sets knowledge_sourced_at on successful source insert"
    - path: "pipeline/src/agents/fact-check.ts"
      provides: "sets fact_checked_at on verified questions"
    - path: "pipeline/src/agents/qa.ts"
      provides: "sets qa_passed_at on published/pass questions"
    - path: "pipeline/src/agents/enrichment.ts"
      provides: "sets enriched_at on enriched questions"
  key_links:
    - from: "pipeline/src/agents/knowledge.ts"
      to: "questions.knowledge_sourced_at"
      via: "supabase .update() on source insert success"
      pattern: "knowledge_sourced_at.*now"
    - from: "pipeline/src/agents/fact-check.ts"
      to: "questions.fact_checked_at"
      via: "supabase .update() on verified status"
      pattern: "fact_checked_at.*now"
    - from: "pipeline/src/agents/qa.ts"
      to: "questions.qa_passed_at"
      via: "supabase .update() on pass/rewrite published"
      pattern: "qa_passed_at.*now"
    - from: "pipeline/src/agents/enrichment.ts"
      to: "questions.enriched_at"
      via: "supabase .update() on fun_fact written"
      pattern: "enriched_at.*now"
---

<objective>
Add pipeline tracking timestamps to questions and resolution columns to question_feedback, then wire agents to stamp their column on successful completion.

Purpose: Enables observability into which pipeline steps a question has passed through, and lets operators mark actioned feedback as resolved.
Output: Three migrations + updated agent update payloads.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

<!-- Key patterns for migrations in this project -->
<!-- Migration convention: ADD COLUMN (no IF NOT EXISTS needed — migrations run once via supabase db push) -->
<!-- BUT: idempotency constraint requires IF NOT EXISTS — use ALTER TABLE ... ADD COLUMN IF NOT EXISTS -->
<!-- Agent update pattern: existing .update({ ... }) calls, add new column to the same object -->
<!-- knowledge.ts: stamps per-source, not per-question — no question update exists; need a separate question update after source insert -->
<!-- fact-check.ts: two update sites — Wikipedia path (line 158-162) and own-knowledge path (lines 235-238) -->
<!-- qa.ts: two publish sites — rewrite path (updateData object, line 244-246) and pass path (passUpdateData object, line 288-290) -->
<!-- enrichment.ts: one update site — line 133-136, update { fun_fact } -->
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write three migrations (feedback resolution + pipeline tracking + backfill)</name>
  <files>
    supabase/migrations/00019_feedback_resolution.sql
    supabase/migrations/00020_questions_pipeline_tracking.sql
    supabase/migrations/00021_pipeline_tracking_backfill.sql
  </files>
  <action>
Create three migration files in order.

**00019_feedback_resolution.sql**
```sql
-- supabase/migrations/00019_feedback_resolution.sql
-- Allow actioned feedback to be marked resolved with optional note.

ALTER TABLE question_feedback
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_note TEXT;
```

**00020_questions_pipeline_tracking.sql**
```sql
-- supabase/migrations/00020_questions_pipeline_tracking.sql
-- Per-question pipeline stage timestamps for observability.
-- All columns nullable: null = stage has not run on this question.
-- fun_fact_checked_at reserved for a future fact-check agent on fun_facts.

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS knowledge_sourced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fact_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qa_passed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fun_fact_checked_at TIMESTAMPTZ;
```

**00021_pipeline_tracking_backfill.sql**
```sql
-- supabase/migrations/00021_pipeline_tracking_backfill.sql
-- Approximate backfill for existing questions. Timestamps are now(), not exact run times.
-- Criteria:
--   enriched_at    <- questions WHERE fun_fact IS NOT NULL (enrichment agent ran)
--   knowledge_sourced_at, fact_checked_at, qa_passed_at
--                  <- questions WHERE verification_score = 3 (native pipeline, all steps ran)
--   OpenTDB imports (score=2) stay null — they bypassed the pipeline.

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
```
  </action>
  <verify>
    <automated>ls /Users/jamiepersonal/Developer/pub-quiz/supabase/migrations/00019_feedback_resolution.sql /Users/jamiepersonal/Developer/pub-quiz/supabase/migrations/00020_questions_pipeline_tracking.sql /Users/jamiepersonal/Developer/pub-quiz/supabase/migrations/00021_pipeline_tracking_backfill.sql && echo "All three migration files exist"</automated>
  </verify>
  <done>Three migration files exist. 00019 adds resolved_at + resolved_note to question_feedback. 00020 adds five nullable TIMESTAMPTZ columns to questions. 00021 backfills enriched_at for questions with fun_fact and the three pipeline columns for questions at verification_score=3.</done>
</task>

<task type="auto">
  <name>Task 2: Wire pipeline tracking timestamps into agent update calls</name>
  <files>
    pipeline/src/agents/knowledge.ts
    pipeline/src/agents/fact-check.ts
    pipeline/src/agents/qa.ts
    pipeline/src/agents/enrichment.ts
  </files>
  <action>
Add `column_name: new Date().toISOString()` to existing `.update({ ... })` calls in each agent. Do NOT add separate queries.

**knowledge.ts** — Knowledge Agent does not update `questions` directly; it inserts into `sources`. After a successful source insert (around line 204, after `log('info', 'Inserted source', ...)`), find questions linked to this category and source, then stamp them. Actually — knowledge.ts fetches Wikipedia sources per category, not per question. The Knowledge Agent does not have a question ID to update. Skip `knowledge_sourced_at` stamping here; it will be set by a downstream agent or by the backfill migration for existing data. No change needed in knowledge.ts.

Wait — re-read the task details: "knowledge.ts — set `knowledge_sourced_at = now()` on questions after successful source fetch/store." The Knowledge Agent stores sources, not questions. Questions are generated later by the Questions Agent. There is no question ID available in knowledge.ts to update. The instruction cannot be implemented as described — do not add fabricated logic. Instead, leave knowledge.ts unchanged and note this in a comment in the migration.

**fact-check.ts** — Two update sites:

1. Wikipedia path (~line 158): the `.update({ verification_score, status: 'verified' })` call. Add `fact_checked_at: new Date().toISOString()` to the update object.

2. Own-knowledge path (~line 235): the `.update({ verification_score, status: 'verified' })` call. Add `fact_checked_at: new Date().toISOString()` to the update object.

Do NOT add it to the rejection updates (lines 87, 217, 227, 245, 259) — only stamp on verified (passed) outcomes.

**qa.ts** — Two publish sites:

1. Rewrite path (~line 230): the `updateData` object. Add `qa_passed_at: new Date().toISOString()` to `updateData` before the `if (originalQuestion.verification_score >= 3)` block so it is always set when a rewrite succeeds, regardless of publish status.

2. Pass path (~line 281): the `passUpdateData` object. Add `qa_passed_at: new Date().toISOString()` to `passUpdateData` unconditionally (not inside the `if (originalQuestion.verification_score >= 3)` block). This means the `if (Object.keys(passUpdateData).length > 0)` block will always execute for passed questions — that is correct.

Do NOT add to the reject path (~line 193).

**enrichment.ts** — One update site (~line 133):
Change `.update({ fun_fact: funFact } as never)` to `.update({ fun_fact: funFact, enriched_at: new Date().toISOString() } as never)`.
  </action>
  <verify>
    <automated>cd /Users/jamiepersonal/Developer/pub-quiz && grep -n "fact_checked_at" pipeline/src/agents/fact-check.ts && grep -n "qa_passed_at" pipeline/src/agents/qa.ts && grep -n "enriched_at" pipeline/src/agents/enrichment.ts && echo "All three agents have tracking column references"</automated>
  </verify>
  <done>fact-check.ts stamps fact_checked_at on both verified update paths. qa.ts stamps qa_passed_at in the rewrite updateData object and in the pass passUpdateData object. enrichment.ts stamps enriched_at alongside fun_fact. No new queries added — only additions to existing update payloads. Return types and test mocks unchanged.</done>
</task>

</tasks>

<verification>
Run the pipeline test suite to confirm no regressions:

```
cd /Users/jamiepersonal/Developer/pub-quiz && npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: all 94 tests pass (or same count as current baseline). TypeScript compile check:

```
cd /Users/jamiepersonal/Developer/pub-quiz/pipeline && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.
</verification>

<success_criteria>
- Three migration files present with correct filenames (00019, 00020, 00021)
- fact_checked_at appears in both verified-outcome update blocks in fact-check.ts
- qa_passed_at appears in both the rewrite updateData and pass passUpdateData objects in qa.ts
- enriched_at appears in the fun_fact update call in enrichment.ts
- `npx vitest run` passes with no new failures
- `npx tsc --noEmit` in pipeline/ reports no new errors
</success_criteria>

<output>
After completion, create `.planning/quick/260424-tla-add-pipeline-tracking-columns-and-feedba/260424-tla-SUMMARY.md`
</output>
