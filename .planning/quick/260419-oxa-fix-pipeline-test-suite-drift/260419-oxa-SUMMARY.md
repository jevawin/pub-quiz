---
phase: 260419-oxa-fix-pipeline-test-suite-drift
plan: 01
subsystem: pipeline/tests
tags: [tests, pipeline, drift-repair, qa, fact-check, run-pipeline]
requirements:
  - QUICK-260419-OXA-01
dependency_graph:
  requires:
    - pipeline/src/agents/qa.ts (current behaviour)
    - pipeline/src/agents/fact-check.ts (current behaviour)
    - pipeline/src/run-pipeline.ts (current behaviour)
  provides:
    - pipeline/tests/** (green regression signal)
  affects: []
tech_stack:
  added: []
  patterns:
    - "Two-step claude.messages.create mocking for QA rewrite path (Haiku flag -> Sonnet rewrite)"
key_files:
  created: []
  modified:
    - pipeline/tests/run-pipeline.test.ts
    - pipeline/tests/agents/fact-check.test.ts
    - pipeline/tests/agents/qa.test.ts
decisions:
  - "Tests updated to match prod behaviour; no agent code changed"
  - "qa_rewritten flag preserved as user-visible contract (calibrator.ts consumes it)"
  - "Rewritten score>=3 publish path preserved (qa.ts still sets status=published)"
metrics:
  duration: 3m
  completed: 2026-04-19
---

# Quick Task 260419-oxa: Fix Pipeline Test Suite Drift Summary

Test suite drift repaired: 7 failing pipeline tests brought back in line with current agent behaviour (QA split, Opus upgrade, calibrator addition). No agent code changed.

## Before / After

- Before: `Test Files  3 failed | 7 passed (10)` / `Tests  7 failed | 87 passed (94)`
- After:  `Test Files  10 passed (10)` / `Tests  94 passed (94)`
- Delta:  +7 passes, 0 regressions.

## Per-Test Decisions (Test-Fix vs Agent-Fix)

All 7 fixes are TEST-SIDE. Production code is the source of truth.

| # | Test | Fix | Reason |
|---|------|-----|--------|
| 1 | `run-pipeline.test.ts` Test 3: metrics/token totals | test-fix | Calibrator agent was added to run-pipeline.ts but never mocked; calibrator transitively imports `createClaudeClient` which was absent from the claude.js mock. Pipeline threw before the success path. Added `vi.mock('../src/agents/calibrator.js')` + `createClaudeClient` to claude mock. Assertion body unchanged (uses `objectContaining`, so extra fields are fine). |
| 2 | `run-pipeline.test.ts` Test 10: logger usage | test-fix | Same root cause as #1. Once the pipeline can complete, `log('info', 'Pipeline complete', ...)` fires and the existing assertions pass. |
| 3 | `fact-check.test.ts` tracks tokens with Haiku | test-fix | Fact-check was upgraded from Haiku to Opus in commit 14edd7f. `trackUsage` is called with `OPUS_INPUT/OPUS_OUTPUT`. Renamed test + updated imports/assertion. |
| 4 | `qa.test.ts` rewrites fixable + qa_rewritten=true | test-fix (contract preserved) | `qa_rewritten` IS a real contract (calibrator.ts reads `qa_rewritten` as a proxy for QA-processed questions). Agent still sets `qa_rewritten: true` (qa.ts line 231). Test failed because the QA split (991ed2f) means rewrites now need a second `claude.messages.create` call (Sonnet). Added a Sonnet rewrite response mock and a `createMockSonnetRewriteResponse` helper. |
| 5 | `qa.test.ts` validates rewritten distractors length is 3 | test-fix | Distractor-length validation moved from `QaBatchSchema` into `rewriteWithSonnet` (qa.ts line 404). When Sonnet returns 2 distractors, the agent returns null → question marked rejected. Test now asserts the `{ processed: 2, failed: 1, rewritten: 0 }` outcome and q1 status=rejected. Old "whole batch throws" behaviour is gone. |
| 6 | `qa.test.ts` tracks tokens with Haiku | test-fix | QA audit upgraded from Haiku to Opus (14edd7f). Updated to `OPUS_INPUT/OPUS_OUTPUT`. |
| 7 | `qa.test.ts` rewritten question with score >= 3 gets published | test-fix (contract preserved) | Same root as #4 — needed Sonnet rewrite mock. Agent still publishes score>=3 rewrites (qa.ts line 243-246). Once Sonnet mock is in place, `status='published'` flows through correctly. |

## Agent Code Changes

None. `git diff pipeline/src/` is empty. All repairs are test-side.

## qa_rewritten Contract Check

Grep confirms `qa_rewritten` is read by `pipeline/src/agents/calibrator.ts`:
> "Fetch published questions that haven't been calibrated yet (use qa_rewritten as a proxy..."

Database migration `00002_qa_agent.sql` adds the column; `database.types.ts` types it. The agent still writes it. No migration needed.

## Decision-Log Comments

Each touched test file has an `// Drift repair 260419-oxa: ...` comment block at the top explaining the root cause, plus inline comments on individual test bodies describing why assertions changed.

## Follow-ups

None. Pipeline test suite is clean and reflects current production behaviour.

## Self-Check: PASSED

- File exists: `pipeline/tests/run-pipeline.test.ts` (modified)
- File exists: `pipeline/tests/agents/fact-check.test.ts` (modified)
- File exists: `pipeline/tests/agents/qa.test.ts` (modified)
- Commit exists: `8c0e007` (verified via `git log --oneline | grep 8c0e007`)
- Test suite exit code 0: 94/94 passing.
