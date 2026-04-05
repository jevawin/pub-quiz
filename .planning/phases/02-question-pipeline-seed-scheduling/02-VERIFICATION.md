---
phase: 02-question-pipeline-seed-scheduling
verified: 2026-04-05T09:55:00Z
status: human_needed
score: 2/3 must-haves verified automatically
re_verification: false
human_verification:
  - test: "Confirm the seed pipeline has actually run and produced 1000+ verified questions in Supabase"
    expected: "SELECT COUNT(*) FROM questions WHERE verification_score >= 3 returns 1000 or more rows, distributed across at least the 12 core categories"
    why_human: "The code infrastructure for seeding is complete and correct, but populating the database requires the GitHub Actions workflow to have actually executed against the live Supabase instance. No programmatic check of the live database count is possible here."
---

# Phase 2: Question Pipeline -- Seed & Scheduling Verification Report

**Phase Goal:** The pipeline has produced a seed question database and runs on a sustainable daily schedule
**Verified:** 2026-04-05T09:55:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Initial seed run has populated 1000+ verified questions across the 12 core categories (high-frequency schedule for first 48 hours) | ? UNCERTAIN | Code infrastructure is complete and correct: `seed-pipeline.yml` runs every 30 minutes, `checkThreshold` gates at 1000 verified questions, `getEligibleCategoriesOrdered` distributes evenly. Whether the live Supabase DB has actually crossed 1000 requires human verification. |
| 2 | Daily scheduled pipeline runs add new questions without manual intervention | ✓ VERIFIED | `.github/workflows/question-pipeline.yml` has `cron: '23 4 * * *'` (daily at 04:23 UTC). Confirmed completely unchanged from Phase 1 -- git diff shows zero modifications between Phase 1 and Phase 2 commits. |
| 3 | Pipeline cost per run is tracked and within budget caps established in Phase 1 | ✓ VERIFIED | `PIPELINE_BUDGET_USD` env var accepted by `loadConfig()` and enforced via `checkBudget()` + `BudgetExceededError` in `pipeline/src/lib/claude.ts`. Seed workflow applies `PIPELINE_BUDGET_USD: ${{ inputs.budget_usd || '2.00' }}`. Daily workflow unchanged at $1.00 default. |

**Score:** 2/3 truths verified programmatically (1 requires human confirmation of live database state)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `pipeline/src/seed-threshold-check.ts` | Pre-run threshold check for seed auto-disable | ✓ VERIFIED | Exports `checkThreshold(supabase)`. Contains `VERIFIED_THRESHOLD = 1000`, `::notice::SEED COMPLETE:`, `GITHUB_OUTPUT`, `seed_complete=true`. 69 lines, fully substantive. |
| `pipeline/src/lib/category-selection.ts` | Least-covered-first category ordering | ✓ VERIFIED | Exports `getEligibleCategoriesOrdered(supabase, batchSize, minQuestionsThreshold?)`. Sorts `eligible.sort((a, b) => a.questionCount - b.questionCount)`. Filters no-source and above-threshold categories. 83 lines. |
| `pipeline/tests/seed-threshold-check.test.ts` | Threshold check unit tests | ✓ VERIFIED | 5 test cases: seedComplete true/false, GITHUB_OUTPUT file write, GitHub Actions notice annotation, process.exit(1) on error. All pass. |
| `pipeline/tests/lib/category-selection.test.ts` | Category selection unit tests | ✓ VERIFIED | 5 test cases: ascending sort, no-source exclusion, threshold exclusion, empty result, batch size limit. All pass. |
| `.github/workflows/seed-pipeline.yml` | GitHub Actions workflow for high-frequency seed runs | ✓ VERIFIED | Contains `cron: '*/30 * * * *'`, `id: threshold`, `npx tsx src/seed-threshold-check.ts`, `if: steps.threshold.outputs.seed_complete != 'true'`, `PIPELINE_BUDGET_USD: 2.00`, batch sizes 10/20/40, `timeout-minutes: 30`. |
| `pipeline/src/agents/questions.ts` (modified) | Questions Agent using shared category selection | ✓ VERIFIED | Imports `getEligibleCategoriesOrdered from '../lib/category-selection.js'`. No inline category selection loop remains. `MIN_QUESTIONS_THRESHOLD = 10` kept as local constant passed as argument. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `pipeline/src/seed-threshold-check.ts` | `pipeline/src/lib/supabase.ts` | `createSupabaseClient` import | ✓ WIRED | Import present on line 4; used in self-execution guard to create client. |
| `pipeline/src/lib/category-selection.ts` | `pipeline/src/agents/questions.ts` | `getEligibleCategoriesOrdered` import | ✓ WIRED | Imported line 6 of `questions.ts`; called on line 37 replacing the former inline selection block. |
| `.github/workflows/seed-pipeline.yml` | `pipeline/src/seed-threshold-check.ts` | `npx tsx src/seed-threshold-check.ts` step | ✓ WIRED | Step `Check seed completion threshold` (id: threshold) runs the script; output `seed_complete` consumed by `if:` condition on next step. |
| `.github/workflows/seed-pipeline.yml` | `pipeline/src/run-pipeline.ts` | `npx tsx src/run-pipeline.ts` conditional step | ✓ WIRED | `Run pipeline (seed batch)` step runs pipeline only when `steps.threshold.outputs.seed_complete != 'true'`. Correct conditional gate. |
| `.github/workflows/question-pipeline.yml` | (unchanged) | daily cron unchanged | ✓ VERIFIED | Git diff confirms zero modifications to daily workflow in this phase. Cron remains `23 4 * * *`. |

### Data-Flow Trace (Level 4)

These artifacts do not render dynamic UI data -- they are pipeline scripts and a YAML workflow. Level 4 data-flow trace is not applicable.

However, tracing the operational data flow:

| Step | Source | Produces | Status |
|------|--------|----------|--------|
| `checkThreshold` queries questions table | `supabase.from('questions').select('*', {count:'exact', head:true}).gte('verification_score', 3)` | Real verified count from DB | ✓ REAL QUERY |
| `checkThreshold` writes GitHub output | `appendFileSync(process.env.GITHUB_OUTPUT, 'seed_complete=true\n')` | Actual file write to GH Actions output | ✓ REAL WRITE |
| Seed workflow `if:` condition reads output | `steps.threshold.outputs.seed_complete` | Gates whether pipeline step runs | ✓ REAL GATE |
| `getEligibleCategoriesOrdered` reads DB | `supabase.from('categories').select(...)` + per-category question/source counts | Real category + count data | ✓ REAL QUERIES |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| seed-threshold-check.ts has no import/syntax errors | `npx tsx --no-cache src/seed-threshold-check.ts` (without env) | Would exit non-zero on missing env vars -- untestable without credentials | ? SKIP |
| Full test suite passes | `npx vitest run` | 74 tests passing across 9 test files, 0 failures | ✓ PASS |
| Seed threshold tests pass | `npx vitest run tests/seed-threshold-check.test.ts` | 5/5 tests pass | ✓ PASS |
| Category selection tests pass | `npx vitest run tests/lib/category-selection.test.ts` | 5/5 tests pass | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PIPE-02 | 02-01, 02-02 | Initial bulk seed run -- high-frequency schedule for first 48h | ✓ SATISFIED (code) / ? NEEDS HUMAN (DB count) | Seed workflow at `*/30 * * * *` with threshold gate exists and is fully wired. Whether 1000+ questions have actually been generated requires checking live DB. |
| PIPE-03 | 02-01, 02-02 | Ongoing daily scheduled update | ✓ SATISFIED | `question-pipeline.yml` with `cron: '23 4 * * *'` confirmed unchanged. |

No orphaned requirements: both PIPE-02 and PIPE-03 are claimed in both plan frontmatters and traced in REQUIREMENTS.md traceability table as Phase 2 / Complete.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | - | - | - | - |

Scanned all phase-modified files for TODO/FIXME, placeholder returns, empty implementations, hardcoded empty data. None found. All return values carry real data from Supabase queries or real computed state.

### Human Verification Required

#### 1. Confirmed Seed Database Population

**Test:** Connect to the Supabase dashboard (or run a SQL query) and check:
```sql
SELECT COUNT(*) FROM questions WHERE verification_score >= 3;
SELECT COUNT(DISTINCT category_id) FROM questions WHERE verification_score >= 3;
```
**Expected:** First query returns >= 1000. Second query returns >= 12 (one per core category seeded in Phase 1).
**Why human:** The code that generates questions runs as a GitHub Actions workflow against the live Supabase instance. Its output exists in the database, not in the codebase. There is no programmatic way to check the live question count from within this verification.

### Gaps Summary

No code gaps. All phase deliverables exist, are substantive, and are correctly wired. The single outstanding item is an operational outcome -- the actual seeding of 1000+ questions into the live database -- which depends on:

1. GitHub Actions having successfully triggered and run the `seed-pipeline.yml` workflow at least enough times to cross the 1000 verified question threshold.
2. The Fact-Check Agent having assigned verification_score >= 3 to at least 1000 questions.

The pipeline infrastructure is correct and complete. Success Criterion 1 is a runtime outcome, not a code outcome.

---

_Verified: 2026-04-05T09:55:00Z_
_Verifier: Claude (gsd-verifier)_
