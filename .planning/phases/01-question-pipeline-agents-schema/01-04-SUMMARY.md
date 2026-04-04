---
phase: 01-question-pipeline-agents-schema
plan: 04
subsystem: pipeline
tags: [orchestrator, github-actions, cron, sequential-pipeline, budget-cap, concurrent-guard]

requires:
  - phase: 01-question-pipeline-agents-schema (plans 01-03)
    provides: 4 agents (category, knowledge, questions, fact-check), shared libraries (config, claude, supabase, logger), database schema
provides:
  - Sequential pipeline orchestrator (runPipeline) wiring all 4 agents
  - Concurrent run guard preventing overlapping pipeline executions
  - GitHub Actions workflow for daily automated and manual pipeline runs
affects: [pipeline-operations, cost-monitoring, ci-cd]

tech-stack:
  added: []
  patterns:
    - "Self-execution guard using process.argv check for testability"
    - "Concurrent run mutex via pipeline_runs status check"
    - "Shared TokenAccumulator across all agents for cumulative budget enforcement"

key-files:
  created:
    - pipeline/src/run-pipeline.ts
    - pipeline/tests/run-pipeline.test.ts
    - .github/workflows/question-pipeline.yml
  modified: []

key-decisions:
  - "Self-execution guard via process.argv[1] check instead of import.meta.url for compatibility with vitest module mocking"
  - "Concurrent run guard exits 0 (not 1) because a skip is not a failure -- avoids false CI alerts"
  - "Cron at 04:23 UTC (odd time) to avoid GitHub Actions queue congestion"

patterns-established:
  - "Pipeline orchestrator pattern: load config -> check mutex -> create run record -> execute agents sequentially -> update run record"

requirements-completed: [PIPE-09, PIPE-01, COST-03]

duration: 3min
completed: 2026-04-04
---

# Phase 1 Plan 4: Pipeline Orchestrator & GitHub Actions Summary

**Sequential pipeline orchestrator wiring 4 agents with concurrent-run guard, budget enforcement, and daily GitHub Actions cron workflow**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-04T19:14:35Z
- **Completed:** 2026-04-04T19:17:55Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments
- Pipeline orchestrator runs all 4 agents in sequence (category -> knowledge -> questions -> fact-check) with shared budget tracking
- Concurrent run guard prevents overlapping executions by checking pipeline_runs for active status, exiting 0 on skip
- GitHub Actions workflow enables daily automated execution at 04:23 UTC and manual trigger with configurable batch sizes and budget
- 10 unit tests covering all orchestrator behaviors pass; full suite of 63 tests across all agents and libraries pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Build pipeline orchestrator with concurrent-run guard and structured logging** - `ed77ccc` (test: failing tests), `eb0e8fa` (feat: implementation passing all tests)
2. **Task 2: Create GitHub Actions workflow** - `af1ef44` (feat: workflow file)

## Files Created/Modified
- `pipeline/src/run-pipeline.ts` - Sequential pipeline orchestrator with concurrent-run guard, pipeline_runs tracking, and budget enforcement
- `pipeline/tests/run-pipeline.test.ts` - 10 unit tests covering agent sequencing, failure handling, concurrent guard, BudgetExceededError, config snapshot, structured logging
- `.github/workflows/question-pipeline.yml` - GitHub Actions workflow with daily cron, manual dispatch, Supabase health check, and configurable inputs

## Decisions Made
- Self-execution guard uses process.argv[1] check rather than import.meta.url to avoid vitest module mocking issues
- Concurrent run guard exits 0 (not 1) because overlapping cron + manual dispatch is not an error condition
- Cron scheduled at 04:23 UTC -- odd minute avoids GitHub Actions congestion at round hours

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed module-level self-execution causing test pollution**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Plan specified `runPipeline()` as a bare call at module bottom, but this executes during vitest import, causing double-execution in tests
- **Fix:** Added process.argv[1] guard to only self-execute when run directly as a script
- **Files modified:** pipeline/src/run-pipeline.ts
- **Verification:** All 10 tests pass, including agent ordering test
- **Committed in:** eb0e8fa

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minimal -- necessary for testability without changing runtime behavior.

## Issues Encountered
None beyond the self-execution guard fix documented above.

## User Setup Required
None - no external service configuration required. GitHub Actions secrets (ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) must be configured in the repository settings before the workflow will succeed.

## Next Phase Readiness
- Phase 1 is now complete: all 4 agents, shared libraries, database schema, and pipeline orchestrator are built and tested
- 63 total tests pass across the full pipeline test suite
- Pipeline is ready for end-to-end testing once Supabase secrets are configured in GitHub

## Self-Check: PASSED

All 3 files exist. All 3 commits found in git log.

---
*Phase: 01-question-pipeline-agents-schema*
*Completed: 2026-04-04*
