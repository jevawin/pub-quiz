---
phase: 260419-oxa-fix-pipeline-test-suite-drift
verified: 2026-04-19T18:05:00Z
status: passed
score: 4/4 must-haves verified
---

# Quick Task 260419-oxa: Pipeline Test Drift Verification Report

**Task Goal:** Fix 7 failing pipeline tests (run-pipeline Test 3 + Test 10; fact-check Haiku token args; qa.test qa_rewritten flag, distractor-length shape, Haiku token args, rewritten score>=3 verdict). All 7 green, zero regressions.

**Verified:** 2026-04-19T18:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All 7 previously-failing pipeline tests now pass | VERIFIED | `npm test -- --run` reports `Test Files 10 passed (10)` / `Tests 94 passed (94)` — matches SUMMARY claim exactly. |
| 2 | No previously-passing pipeline test regresses | VERIFIED | 94/94 passing, 0 failing. SUMMARY baseline was 87 passing + 7 failing = 94 total; now 94 passing = +7 net, 0 regressions. |
| 3 | Test expectations match current production agent behaviour (prod is source of truth) | VERIFIED | `git diff HEAD~1 HEAD -- pipeline/src/` empty; only `pipeline/tests/` touched in commit 8c0e007. |
| 4 | Contract drift flagged and preserved (qa_rewritten, rewritten score>=3 verdict) | VERIFIED | `qa_rewritten` still written by `pipeline/src/agents/qa.ts` and read by `pipeline/src/agents/calibrator.ts`. Drift-repair comments present in all 3 test files. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `pipeline/tests/run-pipeline.test.ts` | Updated Test 3 + Test 10 | VERIFIED | Contains `Drift repair 260419-oxa` marker; calibrator + createClaudeClient mocks added; all Test 3 / Test 10 assertions pass. |
| `pipeline/tests/agents/fact-check.test.ts` | Updated Haiku token assertions | VERIFIED | Contains drift-repair marker; Haiku→Opus token tracking rename present (OPUS_INPUT/OPUS_OUTPUT). 13 tests pass. |
| `pipeline/tests/agents/qa.test.ts` | qa_rewritten, distractor-length, Haiku args, score>=3 verdict | VERIFIED | Contains drift-repair marker; Sonnet rewrite mock added; distractor-length reshape to `{processed,failed,rewritten}`; score>=3 still asserts `published`. 12 tests pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `qa.test.ts` | `qa.ts` | mocked Anthropic + Supabase | WIRED | Test imports and mocks qa module; qa_rewritten flag contract preserved (qa.ts line ~231) and read by calibrator.ts. |
| `fact-check.test.ts` | `fact-check.ts` | mocked Anthropic token tracking | WIRED | Token tracking now uses Opus constants matching fact-check.ts Opus upgrade (commit 14edd7f). |
| `run-pipeline.test.ts` | `run-pipeline.ts` | mocked agents + logger | WIRED | Calibrator agent mock added; createClaudeClient mock added to claude.js; pipeline completes through success path. |

### Data-Flow Trace (Level 4)

Not applicable — task is test suite repair, not data-rendering code.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full pipeline test suite passes | `cd pipeline && npm test -- --run` | `Test Files 10 passed (10)` / `Tests 94 passed (94)` / exit 0 | PASS |
| Integration tests (Wikipedia real API) pass | Included in run above | 2/2 passing | PASS |
| Agent source unchanged | `git diff HEAD~1 HEAD -- pipeline/src/` | Empty diff | PASS |
| qa_rewritten contract intact | Grep `qa_rewritten` in `pipeline/src/` | Present in qa.ts, calibrator.ts, database.types.ts, run-pipeline.ts | PASS |
| Drift-repair decision log present | Grep `Drift repair 260419-oxa` in `pipeline/tests/` | 3 files matched (all three touched tests) | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| QUICK-260419-OXA-01 | 260419-oxa-PLAN.md | Restore pipeline test suite as regression signal | SATISFIED | 94/94 tests green, agent code untouched, decision logs recorded. |

### Anti-Patterns Found

None. Test file changes are narrow and documented with inline `// Drift repair 260419-oxa: ...` comments explaining each substantive change. No TODOs, stubs, or hardcoded empties introduced.

### Human Verification Required

None. Test suite behavior is fully programmatically verifiable (exit code + pass counts).

### Gaps Summary

No gaps. The task achieved its goal:
- Baseline 87 passing + 7 failing repaired to 94 passing + 0 failing (+7 net, 0 regressions).
- Every repair is test-side; production agents untouched.
- Contract risks (qa_rewritten, score>=3 publish path) were investigated, found to be real contracts, and preserved in both agent code and test assertions.
- Commits 8c0e007 (test fixes) and 61b25de (docs) recorded on main.

---

_Verified: 2026-04-19T18:05:00Z_
_Verifier: Claude (gsd-verifier)_
