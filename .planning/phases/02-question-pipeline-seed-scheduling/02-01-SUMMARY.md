---
phase: 02-question-pipeline-seed-scheduling
plan: 01
subsystem: pipeline
tags: [supabase, typescript, tdd, github-actions, vitest]

# Dependency graph
requires:
  - phase: 01-question-pipeline-agents-schema
    provides: Pipeline agents, Supabase schema, config, logger
provides:
  - "checkThreshold() function for seed auto-disable at 1000+ verified questions"
  - "getEligibleCategoriesOrdered() for least-covered-first category selection"
  - "Questions Agent integration with shared category selection"
affects: [02-02-seed-scheduling-workflow, pipeline-scheduling]

# Tech tracking
tech-stack:
  added: []
  patterns: [least-covered-first category ordering, GitHub Actions output annotations, seed threshold gating]

key-files:
  created:
    - pipeline/src/seed-threshold-check.ts
    - pipeline/src/lib/category-selection.ts
    - pipeline/tests/seed-threshold-check.test.ts
    - pipeline/tests/lib/category-selection.test.ts
  modified:
    - pipeline/src/agents/questions.ts
    - pipeline/tests/agents/questions.test.ts

key-decisions:
  - "Real temp file approach for testing GITHUB_OUTPUT writes (ESM cannot spy on node:fs exports)"
  - "Category selection uses count queries with head:true for efficiency rather than fetching full rows"
  - "MIN_QUESTIONS_THRESHOLD kept as local constant in questions.ts, passed as parameter to shared module"

patterns-established:
  - "Seed gating pattern: standalone script with checkThreshold() + self-execution guard"
  - "Category ordering: shared getEligibleCategoriesOrdered() used by agents instead of inline selection"

requirements-completed: [PIPE-02, PIPE-03]

# Metrics
duration: 4min
completed: 2026-04-05
---

# Phase 02 Plan 01: Seed Threshold Check & Category Selection Summary

**Seed threshold auto-disable at 1000+ verified questions with least-covered-first category ordering for even distribution across all categories**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-05T08:42:00Z
- **Completed:** 2026-04-05T08:46:30Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- checkThreshold() correctly identifies seed completion at 1000+ verified questions and writes GitHub Actions outputs (seed_complete=true, ::notice:: annotation)
- getEligibleCategoriesOrdered() returns categories sorted by least questions first, filtering out those without sources or above threshold
- Questions Agent refactored to use shared category-selection module instead of inline selection logic
- Full test suite: 74 tests passing across 9 test files, zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create seed threshold check and category selection utility with tests** - `e9e4201` (test) + `831a53d` (feat)
2. **Task 2: Integrate least-covered-first into Questions Agent** - `a6aa18b` (refactor)

_Note: Task 1 followed TDD with separate test and implementation commits_

## Files Created/Modified
- `pipeline/src/seed-threshold-check.ts` - Pre-run threshold check for seed auto-disable with GITHUB_OUTPUT integration
- `pipeline/src/lib/category-selection.ts` - Least-covered-first category ordering shared utility
- `pipeline/src/agents/questions.ts` - Refactored to use getEligibleCategoriesOrdered instead of inline logic
- `pipeline/tests/seed-threshold-check.test.ts` - 5 test cases for threshold detection, GH output, error handling
- `pipeline/tests/lib/category-selection.test.ts` - 5 test cases for ordering, filtering, batch limits
- `pipeline/tests/agents/questions.test.ts` - Updated mocks, added ordering verification test

## Decisions Made
- Used real temp file approach for testing GITHUB_OUTPUT writes because ESM module namespaces are not configurable for vi.spyOn on node:fs exports
- Category selection uses Supabase count queries with head:true for efficiency (avoids fetching full row data)
- Kept MIN_QUESTIONS_THRESHOLD as a local constant in questions.ts passed as parameter to the shared module (maintains backward compatibility)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ESM spy limitation on node:fs appendFileSync**
- **Found during:** Task 1 (TDD GREEN phase)
- **Issue:** Cannot spy on node:fs exports in ESM -- vi.spyOn(fs, 'appendFileSync') throws "Cannot redefine property"
- **Fix:** Changed test to use real temp file with writeFileSync/readFileSync/unlinkSync instead of spying
- **Files modified:** pipeline/tests/seed-threshold-check.test.ts
- **Verification:** All 5 threshold tests pass
- **Committed in:** 831a53d (Task 1 feat commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Test approach changed but coverage identical. No scope creep.

## Issues Encountered
None beyond the ESM spy limitation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Threshold check script ready for GitHub Actions workflow integration (Plan 02)
- Category selection module ready for seed workflow to use with larger batch sizes
- All existing pipeline behavior unchanged (daily workflow unaffected)

---
*Phase: 02-question-pipeline-seed-scheduling*
*Completed: 2026-04-05*

## Self-Check: PASSED
- All 5 created/modified files verified on disk
- All 3 commit hashes verified in git log
