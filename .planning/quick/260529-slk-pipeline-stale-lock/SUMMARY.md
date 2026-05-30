---
slug: 260529-slk
title: Fix pipeline stale-lock + observed-score-refresh failure
status: complete
completed: 2026-05-29
commits:
  - 285b6c5 fix(pipeline): reclaim stale pipeline_runs lock
  - 53f552a fix(ci): pass ANTHROPIC_API_KEY to observed-score-refresh
---

# Summary

Diagnosed why questions stopped growing and GitHub showed daily failures.

## Root causes

1. Stale `pipeline_runs` lock from a 2026-05-01 run that never completed
   (job timeout) blocked every daily Seed Pipeline run for 28 days.
2. `observed-score-refresh` workflow missing `ANTHROPIC_API_KEY`, required by
   the global `loadConfig()`.

## Actions

- Reclaimed the stuck run in prod (`9d6f6576…` → `failed`) to unblock now.
- Added a 40-min staleness threshold to the concurrent-run guard so a
  crashed/timed-out run self-reclaims instead of locking forever.
- Added `ANTHROPIC_API_KEY` to the score-refresh workflow env.

## Verification

- `tsc`: no new errors from `run-pipeline.ts`.
- `vitest` observed-score job: 4/4 passed.
- Prod: zero `running` rows remain.

## Recovery confirmed live

Triggered the Seed Pipeline on main after merge (run 26665598734). With the
lock cleared it ran for real (~10 min, all 6 agents) instead of the 0.4s
no-op — log shows bulk "Question published" / "recalibrated" lines. The
`verification_score >= 3` count (the seed-threshold metric) went 594 -> 612.
Zero `running` rows remain afterward. Lock fix proven end-to-end.

DB after run (verified counts): total ~3076 | score>=3 612 | published 2869 |
verified 45 | rejected 159 | pending 0 | parked 3.

## Count mismatch resolved (not a bug)

seed-threshold-check.ts counts `verification_score >= 3` (= 612). The "52"
seen during triage was a `status=eq.verified` query — a different filter. Most
high-score rows are `status=published`, not `verified`. Two filters, no
discrepancy. (Aside: 2869 published vs 612 score>=3 means many published rows
carry score<3 — pre-existing, unrelated to this task.)

## The run still exited 1 — two causes, both pre-existing, NOT the lock

1. **Budget cap.** Final log: `Budget exceeded: $1.0033 spent, budget is
   $1.00`. The pipeline stops-and-reports at the $1 cap via the catch path and
   exits 1, tripping the failure notifier. This (re)opened rolling issue #3
   "Seed Pipeline failing".
2. **Schema drift.** Repeated `Could not find the 'difficulty' column of
   'questions' in the schema cache` from the calibrator/QA agents. The
   `difficulty` column was dropped (see deferred 260426-bkf legacy-column
   cleanup) but those agents still UPDATE it, so their writes silently fail.

Note: on the budget-failure path the pipeline_runs row keeps
questions_generated=0 even though agents did publish — stats are only written
on the success path.

## Budget — DONE (commits ee9a96a, 72cf093)

Replaced the per-run-only $1 cap with month-to-date budgeting ($20/mo, clean
hard-stop), per user request "$15-20/mo".

- New `lib/budget.ts` sums `estimated_cost_usd` across all pipeline_runs in the
  current UTC calendar month (no cumulative tracking existed before).
- `PIPELINE_MONTHLY_BUDGET_USD` = $20 (env-overridable). Per-run ceiling
  `PIPELINE_BUDGET_USD` raised $1 → $5 so one run can't drain the month;
  effective cap = min(per-run ceiling, monthly remaining).
- run-pipeline gates at start: month exhausted → exit 0 clean (no work until
  the 1st). Mid-run BudgetExceededError → record run success-with-note + exit 0
  instead of failed/exit 1, so the cap no longer trips the failure notifier.
- 9 unit tests for the helper; full suite 201 passed.
- State at ship (2026-05-30): May spend $1.00, ~$19 of $20 remaining. Next
  scheduled run passes the gate and, being a clean exit 0, auto-closes the
  rolling failure issue #3 via the workflow's success step.

## Follow-ups (still not done)

- Fix calibrator/QA agents writing the dropped `difficulty` column (260426-bkf)
  — logged as per-question ERROR, non-fatal (doesn't throw), but writes fail.
- Seed still generating (612/1000); no action needed for growth right now.
- No unit test for the staleness branch (verified by typecheck + live run).
- Node 20 action deprecation warnings (checkout@v4 / setup-node@v4) — bump v5.
