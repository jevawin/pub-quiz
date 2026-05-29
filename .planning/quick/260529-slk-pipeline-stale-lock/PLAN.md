---
slug: 260529-slk
title: Fix pipeline stale-lock + observed-score-refresh failure
created: 2026-05-29
mode: quick
---

# Fix pipeline stale-lock + observed-score-refresh failure

## Problem

Questions stopped growing and GitHub showed daily red runs. Two root causes:

1. **Stale pipeline lock.** The Seed Pipeline's concurrent-run guard in
   `pipeline/src/run-pipeline.ts` skipped a run whenever any `pipeline_runs`
   row had `status='running'`, with no staleness check. A run that crashes or
   hits the 30-min GitHub job timeout never marks itself failed, so its
   `running` row becomes a permanent lock. A run started 2026-05-01 left such a
   row, no-op'ing every daily seed run for 28 days. Questions stuck (~594 per
   the seed-threshold log).

2. **observed-score-refresh fails daily.** The job died with
   `Missing required environment variable: ANTHROPIC_API_KEY`. The global
   `loadConfig()` in `pipeline/src/lib/config.ts` requires the key even though
   the score refresh never calls Claude. The workflow passed only Supabase
   secrets.

## Changes

- **Ops (done first, live):** marked the stuck run
  `9d6f6576-5801-4634-83c4-edeb9195c971` as `failed` in prod so the next seed
  run is unblocked immediately.
- **`run-pipeline.ts`:** treat `running` rows older than 40 min (> the 30-min
  job timeout) as dead — reclaim them (mark `failed`) and only let a genuinely
  live run block the current one.
- **`observed-score-refresh.yml`:** pass `ANTHROPIC_API_KEY` from secrets.

## Verification

- `tsc` clean on `run-pipeline.ts` (pre-existing errors elsewhere unchanged).
- `vitest run src/__tests__/observed-score-job.test.ts` → 4 passed.
- Prod query confirms no `running` rows remain after reclaim.
