---
phase: 260418-st9
plan: 01
subsystem: web-setup-screen
tags: [supabase, rpc, migration, web, react, ux]
requires:
  - categories table with parent_id chain
  - questions table with status + difficulty + category_id
provides:
  - counts_by_root_category RPC (one round-trip per-root per-difficulty counts)
  - fetchCountsByRootCategory helper returning grouped CategoryCounts
  - live per-pill counts + summed selection pool on Setup screen
affects:
  - apps/web/src/screens/Setup.tsx
  - apps/web/src/lib/questions.ts
tech_stack:
  added: []
  patterns:
    - recursive CTE walking UP categories.parent_id to the root slug
    - single-RPC fetch on mount, derive Mixed totals locally from {easy, normal, hard}
key_files:
  created:
    - supabase/migrations/00016_counts_by_category_difficulty_rpc.sql
  modified:
    - apps/web/src/lib/questions.ts
    - apps/web/src/lib/questions.test.ts
    - apps/web/src/screens/Setup.tsx
    - apps/web/src/screens/Setup.test.tsx
decisions:
  - CategoryCounts shape carries raw easy/normal/hard plus precomputed total so the UI can switch difficulty without recomputing sums.
  - Pool-count suffix reuses the same live state — does not replace the existing seen-exclusion-aware `availableTotal` warning logic.
metrics:
  duration_seconds: 243
  tasks: 2
  files_touched: 5
completed_at: 2026-04-18T19:51:42Z
---

# Phase 260418-st9 Plan 01: Live Category Question Counts Summary

One-liner: Adds a `counts_by_root_category` Postgres RPC and wires the Setup screen to render live per-pill question counts plus a summed selection pool total.

## Commits

- `3c20584` feat(260418-st9-01): add counts_by_root_category RPC migration
- `b8b04c8` test(260418-st9-02): add failing tests for fetchCountsByRootCategory
- `305d35a` test(260418-st9-02): add failing tests for live category counts in Setup
- `81288e6` feat(260418-st9-02): add fetchCountsByRootCategory and wire live counts into Setup

## What Changed

### Task 1: `counts_by_root_category` RPC (migration 00016)
- Recursive CTE `ancestors` seeds every category as its own walker node, then steps UP the `parent_id` chain.
- `root_of` picks the row where `cur_parent IS NULL` — that's the root for every descendant category id.
- Joins questions filtered to `status = 'published'`, groups by `(root_slug, q.difficulty)`, returns `INT` counts.
- `SECURITY INVOKER`, `STABLE`, `search_path = public`. Granted to `anon` + `authenticated`.

### Task 2: `fetchCountsByRootCategory` + Setup wiring
- `CategoryCounts = Record<slug, { easy, normal, hard, total }>`.
- Single `supabase.rpc('counts_by_root_category')` call on mount.
- Missing `(slug, difficulty)` rows default to 0; `total = easy + normal + hard`.
- `countForSlug(counts, slug, 'Mixed')` returns the precomputed `total`; other UI difficulties map to the matching bucket key.
- Every category pill now renders its count as a subtle subscript span inside the button.
- Both summary lines append ` · {N} in pool` using the summed count across selected (or all) roots at the active difficulty.
- `countAvailableQuestions` / `availableTotal` / pool-warning logic is untouched — it uses different semantics (seen-exclusion aware).

## Verification

- `npx vitest --run src/lib/questions.test.ts src/screens/Setup.test.tsx` — all 14 new/kept tests pass.
- `npx tsc --noEmit` — clean, no type errors.
- Migration file reviewed for idempotency (`CREATE OR REPLACE`, standard `GRANT`).
- Browser preview NOT run: the worktree has no `.env` with Supabase credentials, so the RPC would fail at runtime. Unit tests + tsc provide the fast feedback; live verification belongs in a branch with env wired.
- Local `supabase db reset` NOT run: Docker daemon is not running in this environment. The SQL is straightforward (mirrors the CTE pattern from migration 00015) and will apply on next deploy.

## Deviations from Plan

**[Rule 3 - Mock staleness propagation]** The Setup test previously only mocked `fetchRandomQuestions` from `@/lib/questions`. Adding a new `useEffect` that imports `fetchCountsByRootCategory` forced a full module mock, which also re-surfaced `countAvailableQuestions` usage. Added hoisted mocks for both to keep the Play-button happy path working.

**[Rule 3 - Mock initial value]** Initial `mockCountAvailableQuestions.mockResolvedValue(0)` disabled the Play button (the component guards against `availableTotal === 0`). Bumped to 100 so the pre-existing Play test keeps asserting navigation.

## Deferred Issues

See `deferred-items.md`:
- 7 pre-existing tests in `apps/web/src/lib/questions.test.ts` were already failing on `main` (stale RPC name `random_published_questions` instead of `random_published_questions_excluding`; missing `getSeenIds` mock). Out of scope per SCOPE BOUNDARY rule.

## Known Stubs

None.

## Self-Check

Files:
- FOUND: supabase/migrations/00016_counts_by_category_difficulty_rpc.sql
- FOUND: apps/web/src/lib/questions.ts
- FOUND: apps/web/src/lib/questions.test.ts
- FOUND: apps/web/src/screens/Setup.tsx
- FOUND: apps/web/src/screens/Setup.test.tsx

Commits:
- FOUND: 3c20584
- FOUND: b8b04c8
- FOUND: 305d35a
- FOUND: 81288e6

## Self-Check: PASSED
