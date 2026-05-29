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

## Follow-ups (not done)

- No unit test added for the new staleness branch (quick mode; logic verified
  by typecheck + reasoning). Worth a test mocking the supabase chain later.
- The seed-threshold log reported 594 verified questions while a REST count of
  `status=eq.verified` returned 52 — definitions differ (likely published vs
  verified, or a view). Confirm the threshold check counts the intended set.
- Both pipeline workflows still warn on Node 20 action deprecation
  (checkout@v4 / setup-node@v4) — bump to v5 when convenient.
