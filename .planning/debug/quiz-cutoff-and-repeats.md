---
status: awaiting_human_verify
trigger: "Two bugs on live web (trivia-quiz.pages.dev): 1) 20-question game ended after only a few questions. 2) Repeat questions appear despite seen-question memory."
created: 2026-04-17T00:00:00Z
updated: 2026-04-17T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED. Bug 1 = count/actual divergence + Play mount order. Bug 2 = no server-side seen filter.
test: Apply Option C: server-side exclusion RPC, client passes seen IDs, Setup warns when pool < requested, End shows actual played, Play prefers router state over sessionStorage.
expecting: Short quizzes show correct denominator, warning surfaced, repeats eliminated until pool exhausted.
next_action: Implement migration + client changes

## Symptoms

expected:
  1. 20-question game returns 20 questions
  2. Seen-question memory prevents cross-session repeats
actual:
  1. 20-question game ended after only a few questions on mobile web 2026-04-16
  2. Repeat questions appear despite seen-question memory
errors: None reported. Check console/server logs/DB.
reproduction: Unknown. Phone (mobile web). Recent commits 07ffbcc, 20c9bf0 may or may not be related.
started: Noticed 2026-04-16 live play testing

## Eliminated

(none yet)

## Evidence

- timestamp: 2026-04-17
  checked: apps/web/src/lib/questions.ts fetchRandomQuestions
  found: Function over-fetches 4x (n*4), dedupes, orders by view-count (lowest first), slices top n. Returns whatever is available — no guard against `<n`. Throws only if pool is completely empty.
  implication: If pool has fewer than n questions (narrow category+difficulty), function silently returns a short array.

- timestamp: 2026-04-17
  checked: apps/web/src/screens/Setup.tsx onPlay
  found: Calls fetchRandomQuestions with user-selected count, navigates to /play with `config: { count }` and `questions`. No check that `questions.length === count`.
  implication: User-configured count and actual questions.length can diverge. Quiz ends when questions.length reached, but End shows "X / count".

- timestamp: 2026-04-17
  checked: apps/web/src/screens/End.tsx
  found: Renders "You scored {score} / {config.count}" — uses requested count, not actual played count.
  implication: If fetch returned 5 of 20, user sees "You scored X / 20" after only 5 questions. Matches user report of "stopped after only a few questions."

- timestamp: 2026-04-17
  checked: apps/web/src/lib/seen-store.ts
  found: localStorage key `pq_seen_questions` stores view-count map. Persists across sessions on same browser.
  implication: Storage works correctly; seen data persists. Not a persistence bug.

- timestamp: 2026-04-17
  checked: apps/web/src/lib/questions.ts dedupeAndPickFreshest
  found: Re-orders by view count — prefers unseen — but does NOT exclude seen. Picks top n from fetched batch.
  implication: Seen questions are eligible for replay if they're in the fetched batch and unseen ones aren't.

- timestamp: 2026-04-17
  checked: supabase/migrations/00008_rpc_return_root_category.sql random_published_questions RPC
  found: RPC does `ORDER BY random() LIMIT p_limit`. Server has no knowledge of seen questions.
  implication: Over-fetch is 4x per call (perCombo ≈ 29 for n=20, mixed, single slug). With ~140 rows per difficulty, only ~21% of pool is sampled per call. High collision probability with previously-played questions in a small fetched batch.

- timestamp: 2026-04-17
  checked: Recent commit 20c9bf0 added sessionStorage quiz-persist
  found: Play.tsx loads quiz from sessionStorage BEFORE checking router state has fresh data. If a stale partial quiz exists, it restores that instead of the newly-configured one.
  implication: Possible secondary cause of Bug 1 — but only if user had an unfinished earlier quiz. Likely contributor, not primary cause.

- timestamp: 2026-04-17
  checked: DB content per memory snapshot 2026-04-11
  found: 420 published questions, 12 categories, 3 difficulties → ~12 per category+difficulty average. "Mixed + all categories" uses slug `general`, pools ~140 per difficulty. Narrow category+single difficulty could drop to single digits.
  implication: For narrow selections, pool is small enough that fetch can return <20. Also explains repeats: narrow pools exhaust fast.

## Resolution

root_cause: Two-part bug. (1) Setup silently returned fewer questions than requested when the filtered pool was small, and End/Play used the requested count as the denominator — so "20-question" games displayed "X / 20" even when only a handful of questions were fetched. Play also restored a stale sessionStorage quiz before checking router state, so starting a new quiz could replay an old short one. (2) The seen-store only re-ordered a random 4x over-fetch client-side; the server had no knowledge of seen IDs. On narrow category + difficulty pools, seen questions frequently reappeared because the whole fetched batch was already-seen.

fix: Option C — server-side exclusion + UX guardrails.
- New migration `00015_random_published_questions_excluding.sql` adds `random_published_questions_excluding(diff, slug, limit, exclude_ids[])` and `count_available_questions(diff, slug, exclude_ids[])` RPCs.
- `fetchRandomQuestions` now passes `getSeenIds()` to the server RPC so seen questions are excluded at the DB level. Falls back to an unfiltered fetch if the unseen pool can't fill the request.
- `seen-store.ts` exports `getSeenIds()`.
- Setup recounts available (seen+unseen and unseen-only) whenever filters change, surfaces an amber warning when the match count is below the requested quiz length (distinguishing "pool small" vs "some may repeat"), and disables Play when zero match.
- Setup passes `count: questions.length` (actual returned) to Play instead of the requested count, so End shows the correct denominator.
- Play prefers fresh router state over stale sessionStorage quiz-persist and clears the saved state when a new quiz starts. The restore path now only fires when there is no router state (page refresh case).

verification: `npx tsc --noEmit` passes. `npm run build` succeeds. Browser/E2E verification pending — requires the migration to be applied to Supabase before the new RPCs exist. The client falls back gracefully only for the seen-exclusion path; pool-size counts will error in the UI until the migration is deployed.

files_changed:
  - supabase/migrations/00015_random_published_questions_excluding.sql
  - apps/web/src/lib/seen-store.ts
  - apps/web/src/lib/questions.ts
  - apps/web/src/screens/Setup.tsx
  - apps/web/src/screens/Play.tsx
