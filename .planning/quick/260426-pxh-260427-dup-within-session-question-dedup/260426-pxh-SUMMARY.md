---
phase: quick-260426-pxh
plan: 01
subsystem: web/quiz-loading
tags: [bug-fix, dedupe, interleave, web]
status: awaiting-human-verify
key-files:
  modified:
    - apps/web/src/lib/questions.ts
    - apps/web/src/lib/questions.test.ts
commits:
  - 36fd85d test(quick-260426-pxh-01): add failing tests for dedupe + interleave
  - 9eb505d fix(quick-260426-pxh-01): harden within-session dedupe, drop stale-repeat fallback
  - 1b7b54c feat(quick-260426-pxh-02): interleave questions by category to break adjacency
metrics:
  duration: ~10min
  tasks_completed: 2
  tasks_pending: 1 (human-verify)
  tests_added: 6
  tests_total: 18 (all passing)
completed: 2026-04-26
---

# Quick 260426-pxh: Within-Session Question Dedup Summary

Within-session repeat-question bug fixed. The silent stale-repeat fallback in `fetchRandomQuestions` was the real culprit — it refetched without `p_exclude_ids` when the unseen pool was small, pulling cross-session seen questions back in. Removed the fallback, added a final Set-based dedupe pass for explicit ID uniqueness, and added a greedy interleave helper to break same-category adjacency.

## Diagnosis

The user reported "half the questions were repeats" (feedback ef374940) and "two Van Gogh questions in a row" (f65afa50). The plan traced the load flow and found:

1. `fetchRandomQuestions` is called once upfront in `Setup.onPlay`. Within-session dedup is therefore implicit in a single batch.
2. `dedupeAndPickFreshest` already deduped via a `Set<string>` on `row.id`. So the happy path was clean.
3. The actual bug was at lines 162–169: when `limited.length < n` after server-side seen-exclusion, the code silently refetched with `p_exclude_ids: []`. Cross-session seen questions came back into the pool. Within the session each ID still appeared once, but the user (correctly) perceived them as repeats from earlier sessions.
4. No category-adjacency logic existed at all — same-category clustering was unconstrained.

## Changes

### Task 1 — Harden dedupe and drop stale-repeat fallback (`fix(quick-260426-pxh-01)`)

`apps/web/src/lib/questions.ts`:
- Removed the `if (limited.length < n && excludeIds.length > 0)` block that refetched with empty exclude list.
- Added a final authoritative `Set<string>` dedupe pass on returned rows just before the `toLoadedQuestion` map. Belt-and-braces — `dedupeAndPickFreshest` already enforces uniqueness, but the second pass makes the within-session contract explicit.
- Exported the `RpcRow` type for use in tests.

Behaviour change: a request for n=20 against a small pool now returns however many unseen questions exist. `Setup.onPlay` already uses the actual returned length as the authoritative count, and the Setup screen surfaces a pool-size warning before play, so this is honest rather than disruptive.

### Task 2 — Interleave by category_slug (`feat(quick-260426-pxh-02)`)

`apps/web/src/lib/questions.ts`:
- Added `interleaveByCategory(rows: RpcRow[]): RpcRow[]` — greedy O(n²) helper that picks the first remaining row whose `category_slug !== lastSlug`. If none differ (tail shares one slug), takes the first remaining.
- Wired in after `dedupeAndPickFreshest` slice(n), before the final dedupe sanity pass.

Pipeline order: dedupe → pick freshest → slice n → interleave → final-dedupe → map.

## Tests

`apps/web/src/lib/questions.test.ts` extended with 6 new tests (3 per task):

Task 1:
- Sub-batches sharing IDs return each ID at most once.
- Final array has no duplicate IDs (`new Set(ids).size === ids.length`).
- Short pool returns a short array; no follow-up RPC is made with `p_exclude_ids: []`.

Task 2:
- Mixed-category input has no two adjacent items sharing a slug.
- Single-category input is a no-op (order preserved).
- Length and ID set preserved (no drops, no dupes).

All 18 tests in the file pass. TypeScript compiles clean (`npx tsc --noEmit`).

## Nuances

- Interleave is best-effort: when the user picks a single category, it does nothing. That's correct — the user explicitly asked for that category.
- The greedy algorithm doesn't guarantee perfect alternation if the pool is heavily skewed (e.g., 18 of 20 items share one slug). It still does the best possible local rearrangement.
- No DB migrations, no schema changes. RPC `random_published_questions_excluding` already accepts `p_exclude_ids` — server side was always fine.

## Awaiting human verify (Task 3)

Per plan checkpoint:

1. Run `cd apps/web && npm run dev`.
2. Optional: clear seen memory via Setup footer link.
3. All categories, Mixed difficulty, 20 questions, Play.
4. Confirm: no question_text repeats; same category does not appear back-to-back.
5. Optional pool-warning check: pick a niche single category with a small pool, set count to 20. Setup shows pool warning. Quiz starts with the actual available count (e.g. "Question 1 of 8") rather than padding to 20 with cross-session repeats.

## Self-Check: PASSED

- apps/web/src/lib/questions.ts: FOUND
- apps/web/src/lib/questions.test.ts: FOUND
- Commit 36fd85d: FOUND
- Commit 9eb505d: FOUND
- Commit 1b7b54c: FOUND
