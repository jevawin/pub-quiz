---
phase: 01-question-pipeline-agents-schema
plan: 03
subsystem: pipeline
tags: [claude, haiku, sonnet, agents, fact-check, questions, mcq, zod, supabase]

# Dependency graph
requires:
  - phase: 01-question-pipeline-agents-schema/plan-01
    provides: shared libraries (claude.ts, supabase.ts, schemas.ts, config.ts, logger.ts, database.types.ts)
provides:
  - Questions Agent that generates MCQ from Wikipedia sources via Claude Sonnet
  - Fact-Check Agent that verifies answers against source text via Claude Haiku
  - Verification scoring system (0-3) with auto-publish threshold at score >= 3
affects: [01-question-pipeline-agents-schema/plan-04, pipeline-orchestrator]

# Tech tracking
tech-stack:
  added: []
  patterns: [per-item-error-handling, source-only-generation, dedup-cap-20, auto-publish-threshold-3]

key-files:
  created:
    - pipeline/src/agents/questions.ts
    - pipeline/src/agents/fact-check.ts
    - pipeline/tests/agents/questions.test.ts
    - pipeline/tests/agents/fact-check.test.ts
  modified: []

key-decisions:
  - "Rejected questions (is_correct=false) count as 'failed' in return value but don't trigger error throw -- only actual processing errors cause agent-level failure"
  - "Used type assertions (as never + as unknown as Promise) for Supabase query builder chain types that resolve to never with supabase-js v2"
  - "Fact-check results use UUID format for question_id to match Zod schema validation (z.string().uuid())"

patterns-established:
  - "Agent return type: AgentResult { processed: number; failed: number } -- consistent across all agents"
  - "Per-item try/catch: each question insert/update wrapped individually so one failure doesn't crash the batch"
  - "Budget guard: checkBudget() called after each Claude API call, BudgetExceededError propagated to orchestrator"
  - "Source-only generation: system prompt explicitly instructs Claude to use ONLY provided text, not general knowledge"
  - "Dedup cap at 20: prevents unbounded prompt growth as question library expands"

requirements-completed: [PIPE-06, PIPE-07]

# Metrics
duration: 14min
completed: 2026-04-04
---

# Phase 01 Plan 03: Questions and Fact-Check Agents Summary

**Questions Agent generates MCQ from Wikipedia sources via Claude Sonnet with dedup cap and distractor validation; Fact-Check Agent verifies answers against source text via Claude Haiku with score-based auto-publish (>= 3 only)**

## Performance

- **Duration:** 14 min
- **Started:** 2026-04-04T18:55:46Z
- **Completed:** 2026-04-04T19:09:46Z
- **Tasks:** 2
- **Files created:** 4

## Accomplishments
- Questions Agent generates multiple-choice questions from stored Wikipedia source content, validates distractors against correct answers, caps dedup context at 20 questions, and instructs Claude to use only provided text
- Fact-Check Agent independently verifies answers against source text using Claude Haiku, assigns verification scores 0-3, auto-publishes only score >= 3, rejects incorrect answers
- Both agents handle per-item errors gracefully (individual failures don't crash the batch), track token usage, and respect budget caps
- 26 unit tests passing across both agents with mocked Claude and Supabase dependencies

## Task Commits

Each task was committed atomically (TDD: test then implementation):

1. **Task 1: Questions Agent (RED)** - `7648caa` (test)
2. **Task 1: Questions Agent (GREEN)** - `7ee481c` (feat)
3. **Task 2: Fact-Check Agent (RED)** - `4f11da6` (test)
4. **Task 2: Fact-Check Agent (GREEN)** - `5a00a68` (feat)

_TDD flow: failing tests committed first, then implementation to make them pass_

## Files Created/Modified
- `pipeline/src/agents/questions.ts` - Questions Agent: generates MCQ from sources via Claude Sonnet, validates distractors, dedup cap 20
- `pipeline/src/agents/fact-check.ts` - Fact-Check Agent: verifies answers via Claude Haiku, score-based status updates, auto-publish >= 3
- `pipeline/tests/agents/questions.test.ts` - 13 unit tests covering generation, validation, dedup, error handling
- `pipeline/tests/agents/fact-check.test.ts` - 13 unit tests covering scoring, publishing thresholds, rejection, error handling

## Decisions Made
- Rejected questions (is_correct=false) count as `failed` in return value but don't trigger the "all failed" error throw -- only actual processing errors (DB failures, parse errors) cause agent-level failure. This prevents the agent from erroneously throwing when all questions are legitimately rejected by the fact-checker.
- Used `as never` + `as unknown as Promise<...>` type assertions for Supabase insert/update calls. The supabase-js v2 PostgREST type system resolves to `never` through chained method calls. This is a known issue; type assertions are the pragmatic fix.
- Test data uses proper UUIDs for question_id fields to satisfy the Zod `z.string().uuid()` validation in FactCheckResultSchema.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed "all failed" error for legitimate rejections**
- **Found during:** Task 2 (Fact-Check Agent implementation)
- **Issue:** When all questions were legitimately rejected (is_correct=false), the agent threw "All N fact-checks failed" even though it processed them correctly
- **Fix:** Added separate `errors` counter tracking actual processing errors vs rejection outcomes. Only throw when `processed === 0 && errors > 0`.
- **Files modified:** pipeline/src/agents/fact-check.ts
- **Verification:** Test "rejects incorrect answers with status=rejected and score=0" passes without throwing
- **Committed in:** 5a00a68 (Task 2 commit)

**2. [Rule 3 - Blocking] Fixed Zod UUID validation in test data**
- **Found during:** Task 2 (Fact-Check Agent tests)
- **Issue:** Test used `q-1` and `q-2` as question IDs, but FactCheckResultSchema requires `z.string().uuid()`. Parse failed silently.
- **Fix:** Changed test data to use proper UUID format (`11111111-1111-1111-1111-111111111111`)
- **Files modified:** pipeline/tests/agents/fact-check.test.ts
- **Committed in:** 5a00a68 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes essential for correctness. No scope creep.

## Issues Encountered
- Supabase-js v2 TypeScript types resolve to `never` when chaining `.from().select().eq().limit()` or `.from().update().eq()`. Resolved with type assertions. This is a known limitation of the PostgREST type system in supabase-js v2.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both agents are ready to be called by the pipeline orchestrator (Plan 04)
- Exported functions: `runQuestionsAgent(config, tokenAccumulator)` and `runFactCheckAgent(config, tokenAccumulator)`
- Both return `AgentResult { processed, failed }` and throw `BudgetExceededError` when budget exceeded

---
## Self-Check: PASSED

All 4 files verified present. All 4 commit hashes verified in git log.

---
*Phase: 01-question-pipeline-agents-schema*
*Completed: 2026-04-04*
