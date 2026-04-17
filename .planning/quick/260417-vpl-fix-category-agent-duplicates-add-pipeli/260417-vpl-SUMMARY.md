---
phase: 260417-vpl-fix-category-agent-duplicates
plan: 01
subsystem: pipeline
tags: [pipeline, category-agent, ci, notifications]
requires: []
provides:
  - existing-slugs-prompt-block
  - all-duplicates-soft-handle
  - pipeline-failure-issue-on-fail
affects:
  - pipeline/src/agents/category.ts
  - pipeline/tests/agents/category.test.ts
  - .github/workflows/seed-pipeline.yml
tech-stack:
  added: []
  patterns:
    - "Duplicate slugs tracked separately from failures (skippedDuplicates counter)"
    - "failure()-gated workflow step using actions/github-script for issue creation"
key-files:
  created:
    - .planning/quick/260417-vpl-fix-category-agent-duplicates-add-pipeli/deferred-items.md
  modified:
    - pipeline/src/agents/category.ts
    - pipeline/tests/agents/category.test.ts
    - .github/workflows/seed-pipeline.yml
decisions:
  - "All-duplicates is benign: return {processed:0, failed:0} without throwing (consistent with Phase 01 decision on rejected-questions vs processing errors)"
  - "Per-duplicate log downgraded warn -> info; duplicates are expected behaviour, not warnings"
  - "No issue-dedupe on workflow failure: one issue per failure is acceptable for low-frequency runs (nightly)"
metrics:
  duration: ~10min
  tasks: 2
  files: 3
  completed: 2026-04-17
---

# 260417-vpl Quick Task: Fix Category Agent Duplicates + Add Pipeline Failure Notification Summary

Teaches the Category Agent which slugs already exist, stops it throwing when Claude returns only duplicates, and opens a GitHub issue when the Seed Pipeline workflow fails.

## What Changed

**Category Agent (`pipeline/src/agents/category.ts`):**
- `existingSlugs` Set now built before the Claude call so it can feed both the prompt and the duplicate check.
- User prompt gains a new block: `Do NOT propose any of these existing slugs (they are already in the database): <comma-separated list>`. Only emitted when the set is non-empty.
- New `skippedDuplicates` counter splits benign duplicates from real `failed` errors.
- Per-duplicate log: `warn` -> `info`.
- New terminal branch: `processed === 0 && failed === 0 && skippedDuplicates > 0` logs an info message and returns `{processed:0, failed:0}` without throwing.
- Existing `processed === 0 && failed > 0` throw preserved for real per-item errors.
- `Category Agent complete` log now includes `skippedDuplicates`.

**Tests (`pipeline/tests/agents/category.test.ts`):**
- Replaced the older "skips duplicates -> throws all 1 failed" assertion with the new contract: all-duplicates returns `{0,0}` and does not throw.
- Added `passes existing slugs to Claude prompt` test: asserts the user message contains `Do NOT propose any of these existing slugs` and each existing slug.
- All 12 tests pass.

**Workflow (`.github/workflows/seed-pipeline.yml`):**
- New final step `Notify on failure` gated on `if: failure()`.
- Uses `actions/github-script@v7`, calls `github.rest.issues.create` with title `Seed Pipeline failed <date>`, body containing run URL, workflow name, and trigger event, labels `['pipeline-failure']`.
- Placed last so it catches failure of any prior step.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 (RED) | Add failing tests for existing-slugs prompt + all-duplicates no-throw | 9d2b513 | pipeline/tests/agents/category.test.ts |
| 1 (GREEN) | Fix Category Agent -- pass existing slugs, soft-handle all-duplicates | 60a4cad | pipeline/src/agents/category.ts |
| 2 | Add failure-notification step to Seed Pipeline workflow | c6feb95 | .github/workflows/seed-pipeline.yml |

## Verification

- `cd pipeline && npx vitest run tests/agents/category.test.ts` -> 12/12 passing, including both new tests.
- Workflow YAML validated: parses as valid YAML, final step is `if: failure()`, uses `actions/github-script@v7`, calls `issues.create`.
- Manual re-read of `runCategoryAgent`: the throw fires only when `processed === 0 && failed > 0`, i.e. real errors -- NOT when duplicates are the sole skip reason.

## Deviations from Plan

None. Plan executed as written.

## Deferred Issues

Out-of-scope pre-existing issues logged to `.planning/quick/260417-vpl-fix-category-agent-duplicates-add-pipeli/deferred-items.md`:
- `pipeline/src/scripts/seed-web-quiz-topup.ts` TS2554 typecheck error.
- Pre-existing failures in `run-pipeline.test.ts`, `fact-check.test.ts`, `qa.test.ts` (unrelated agents).

None touch `category.ts`. All `category.test.ts` tests pass.

## Success Criteria

- [x] Category Agent prompt tells Claude which slugs already exist.
- [x] A run where Claude proposes only already-existing slugs returns `{processed:0, failed:0}` and does not exit 1.
- [x] Any failure of the Seed Pipeline workflow opens a GitHub issue with a link to the run log.
- [x] Existing Category Agent tests still pass.

## Self-Check: PASSED

All declared files exist on disk. All three commit hashes present in git history.
