---
phase: 260426-myq
plan: 01
subsystem: web-quiz + content-feedback
tags: [feedback, css, focus-visible, content-rewrite, supabase]
tech-stack:
  added: []
  patterns:
    - "Tailwind focus-visible:* utilities for keyboard-only focus rings"
key-files:
  created: []
  modified:
    - apps/web/src/screens/Play.tsx
decisions:
  - "Use focus-visible (not focus) for answer button ring — mouse click should not leave a ring; keyboard Tab still does"
  - "Leave isSelected ring-2 ring-neutral-900 intact — it is the intentional selection indicator, not the bug"
metrics:
  duration: ~3min
  completed: 2026-04-26
---

# 260426-myq Plan 01: Fix 3 Open Question Feedback Items Summary

One-liner: Reworded 2 flagged questions (Indonesia population, King Midas) and switched answer-button focus styling to `focus-visible` so mouse clicks no longer leave a stuck ring.

## Tasks Executed

### Task 1: Rewrite 2 questions and resolve feedback rows — DONE

DB-only changes via Supabase REST PATCH (4 PATCHes, all HTTP 204).

**Question 1** (`bd6d71fb-546e-4048-b8bc-3602d40fbd31`):

- Old: (population question without "by population" qualifier)
- New: `By population, which country has the largest Muslim population?`
- Correct answer (Indonesia) and distractors unchanged.

**Question 2** (`c8a909d0-8ab7-4503-86a3-c1287d5a39bc`):

- New: `In Greek myth, what happened to King Midas's food and daughter when he touched them?`
- Correct answer ("They turned to gold") and distractors unchanged.

**Resolved feedback rows:**

| Feedback ID | resolved_at | resolved_note |
|-------------|-------------|---------------|
| 7bf118f1-0df7-4db0-9d52-1ab25d5f6072 | 2026-04-26T15:34:29Z | Reworded to specify population — answer (Indonesia) unchanged. |
| 8897af88-6c97-408a-ab0e-f775ab2763ca | 2026-04-26T15:34:29Z | Reworded for clarity — answer unchanged. |

Both rows confirmed via SELECT — `resolved_at` non-null, `resolved_note` set.

Commit: `ddd6359`

### Task 2: Fix answer button focus-visible styling — DONE

`apps/web/src/screens/Play.tsx`, answer button (~line 261):

```diff
- className={`w-full rounded-lg border p-3 text-left transition-colors ${
+ className={`w-full rounded-lg border p-3 text-left transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-neutral-900 ${
```

`isSelected` branch (`ring-2 ring-neutral-900`) untouched — that is the intentional selection indicator. Lock In / Next buttons untouched.

`npx tsc --noEmit` in `apps/web` passes (no output).

Commit: `b4ca9f0`

### Task 3: Human-verify CSS fix and resolve final feedback row — DONE

Verified in localhost preview via `preview_eval` + `preview_inspect`:

- Mouse click on an answer button: `document.activeElement` reverts to `BODY`; only the selected button shows the intentional `ring-2 ring-neutral-900` (boxShadow `rgb(23,23,23) 0px 0px 0px 2px`). Other buttons clean (`boxShadow: 'none'`).
- Programmatic `.focus()` (matches `:focus-visible`): button shows compound shadow `rgb(255,255,255) 0px 0px 0px 2px, rgb(23,23,23) 0px 0px 0px 4px` — keyboard ring intact.

Feedback `6b5a1b37-3507-4858-afb8-0aff06a88c43` PATCHed (HTTP 204):

- `resolved_at`: 2026-04-26T15:39:07Z
- `resolved_note`: "Switched answer button focus styles to focus-visible — mouse click no longer leaves a ring; keyboard focus still shows one."

`question_feedback` open count after this fix: **0/14**.

## Deviations from Plan

None — plan executed exactly as written. CSS fix scoped strictly to focus utilities; selection ring left intact per constraint.

## Resolved Feedback Summary

| # | Feedback ID | Status |
|---|-------------|--------|
| 1 | 7bf118f1-0df7-4db0-9d52-1ab25d5f6072 | Resolved (Task 1) |
| 2 | 8897af88-6c97-408a-ab0e-f775ab2763ca | Resolved (Task 1) |
| 3 | 6b5a1b37-3507-4858-afb8-0aff06a88c43 | Resolved (Task 3 — verified in localhost) |

## Self-Check: PASSED

- Play.tsx contains `focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-neutral-900`: FOUND
- Commit `ddd6359` (Task 1): FOUND
- Commit `b4ca9f0` (Task 2): FOUND
- Feedback rows 7bf118f1 and 8897af88 have `resolved_at` set: VERIFIED via REST SELECT
