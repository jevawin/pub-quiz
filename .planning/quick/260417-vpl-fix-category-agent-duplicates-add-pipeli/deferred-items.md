# Deferred Items — 260417-vpl

Pre-existing issues found while running the full test suite during this quick task. Not caused by this task's changes; out of scope.

## Typecheck

- `pipeline/src/scripts/seed-web-quiz-topup.ts:80` — TS2554: Expected 0-1 arguments, but got 2. Pre-existing before this task.

## Test failures (unrelated files)

- `tests/run-pipeline.test.ts` — Test 3 (pipeline_runs update) and Test 10 (log() usage).
- `tests/agents/fact-check.test.ts` — tracks tokens with Haiku cost rates.
- `tests/agents/qa.test.ts` — four failures around QA rewrite/publish/token tracking.

All `tests/agents/category.test.ts` tests (including the two new ones for this task) pass.
