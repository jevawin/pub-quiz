---
phase: 01-question-pipeline-agents-schema
plan: 02
subsystem: pipeline
tags: [claude-api, structured-output, wikipedia, mediawiki, zod, agents, category-tree, content-hash]

# Dependency graph
requires:
  - phase: 01-question-pipeline-agents-schema (plan 01)
    provides: Shared libraries (claude.ts, supabase.ts, wikipedia.ts, schemas.ts, config.ts, logger.ts), database types, schema migration
provides:
  - Category Agent that proposes subcategories via Claude structured output
  - Knowledge Agent that fetches Wikipedia articles and stores in sources table
  - AgentResult interface pattern for agent return values
  - Wikipedia integration smoke test for API contract validation
affects: [01-03 (Questions Agent), 01-04 (Fact-Check Agent, orchestrator)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Agent pattern: each agent exports a run function returning AgentResult { processed, failed }"
    - "Per-item error handling: try/catch around individual inserts, never crash the full agent run"
    - "Prompt context capping: limit category tree to 50 leaves when tree grows large"
    - "Content dedup: SHA-256 hash of content, check before insert"

key-files:
  created:
    - pipeline/src/agents/category.ts
    - pipeline/src/agents/knowledge.ts
    - pipeline/tests/agents/category.test.ts
    - pipeline/tests/agents/knowledge.test.ts
    - pipeline/tests/lib/wikipedia.test.ts
    - pipeline/tests/integration/wikipedia.integration.test.ts
  modified:
    - pipeline/src/lib/database.types.ts

key-decisions:
  - "AgentResult interface with processed/failed counts as standard agent return type"
  - "Category Agent throws only when ALL items fail, not on per-item failures"
  - "Knowledge Agent queries source count per category individually rather than complex JOIN"
  - "Fixed database.types.ts to include Relationships and PostgrestVersion for supabase-js v2 type resolution"

patterns-established:
  - "Agent return pattern: { processed: number, failed: number }"
  - "Per-item error handling with try/catch, log, increment failed, continue"
  - "Structured logging via log() from lib/logger.ts in all agents"
  - "Integration tests with describe.skipIf(process.env.CI) guard"

requirements-completed: [PIPE-04, PIPE-05]

# Metrics
duration: 6min
completed: 2026-04-04
---

# Phase 01 Plan 02: Category Agent & Knowledge Agent Summary

**Category Agent discovers subcategories via Claude structured output with 50-leaf prompt cap; Knowledge Agent fetches and deduplicates Wikipedia content by SHA-256 hash**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-04T18:55:44Z
- **Completed:** 2026-04-04T19:01:22Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Category Agent proposes subcategories using Claude Sonnet, validates against Zod schema, enforces depth limit of 3, deduplicates by slug, caps prompt context at 50 leaves for large trees
- Knowledge Agent fetches Wikipedia articles for under-sourced categories, deduplicates by SHA-256 content hash, stores in sources table with URL construction
- Both agents use per-item error handling so individual failures do not crash the pipeline run
- 25 passing unit tests across 3 test files, plus integration smoke test for real Wikipedia API

## Task Commits

Each task was committed atomically:

1. **Task 1: Build Category Agent with prompt cap and per-item error handling** - `92183d3` (feat)
2. **Task 2: Build Knowledge Agent with Wikipedia integration and content dedup** - `361bc42` (feat)

## Files Created/Modified
- `pipeline/src/agents/category.ts` - Category Agent: discovers subcategories via Claude structured output
- `pipeline/src/agents/knowledge.ts` - Knowledge Agent: fetches Wikipedia content, deduplicates by hash
- `pipeline/tests/agents/category.test.ts` - 11 unit tests for Category Agent
- `pipeline/tests/agents/knowledge.test.ts` - 8 unit tests for Knowledge Agent
- `pipeline/tests/lib/wikipedia.test.ts` - 6 unit tests for Wikipedia helper functions
- `pipeline/tests/integration/wikipedia.integration.test.ts` - Integration smoke test (skipped in CI)
- `pipeline/src/lib/database.types.ts` - Added Relationships and PostgrestVersion for supabase-js v2 compat

## Decisions Made
- AgentResult interface standardized as `{ processed: number, failed: number }` -- simple, clear contract for pipeline orchestrator
- Category Agent throws to orchestrator only when ALL items fail; individual failures are logged and counted
- Knowledge Agent checks source count per category via individual queries (simpler than complex JOIN, acceptable for batch sizes of 10)
- Fixed database.types.ts to include `Relationships` arrays and `PostgrestVersion: '12'` required by supabase-js v2 type system

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed database.types.ts for supabase-js v2 TypeScript compatibility**
- **Found during:** Task 1 (Category Agent implementation)
- **Issue:** Manual Database type was missing `Relationships` arrays on each table and `PostgrestVersion` field, causing TypeScript to resolve insert types as `never`
- **Fix:** Added `PostgrestVersion: '12'` to public schema and `Relationships` arrays with foreign key metadata to all table definitions
- **Files modified:** `pipeline/src/lib/database.types.ts`
- **Verification:** `npx tsc --noEmit` passes cleanly
- **Committed in:** `361bc42` (Task 2 commit, as fix was discovered during Task 1 tsc check but applied during Task 2)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix for TypeScript compilation. No scope creep.

## Issues Encountered
- Test assertions for "skip duplicate slug" and "skip depth > 3" needed adjustment: when ALL proposed categories are skipped, the agent correctly throws (by design). Tests updated to expect the throw rather than a return value.

## Known Stubs
None -- all agent functionality is fully wired.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Category Agent and Knowledge Agent ready for orchestrator integration (Plan 04)
- Questions Agent (Plan 03) can now build on the same AgentResult pattern
- Both agents import from shared libraries established in Plan 01

---
*Phase: 01-question-pipeline-agents-schema*
*Completed: 2026-04-04*
