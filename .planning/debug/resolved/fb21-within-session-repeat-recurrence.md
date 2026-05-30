---
status: resolved
trigger: "question_feedback FB21 (2026-05-08): 'Repeat question, we need to check the question memory logic.' Within-session repeat resurfaced AFTER two prior fixes."
created: 2026-05-30T00:00:00Z
updated: 2026-05-30T00:00:00Z
source_feedback:
  question_id: 00356aeb-8a66-4858-bca3-a2b19240ab89
  created_at: 2026-05-08T20:44:57
  question: "If you were to write software using 1s and 0s, what would you be writing in? (Binary)"
priors:
  - .planning/debug/quiz-cutoff-and-repeats.md  # 2026-04-17, status awaiting_human_verify
  - .planning/quick/260426-pxh-260427-dup-within-session-question-dedup  # 2026-04-26, marked complete
---

## Current Focus

hypothesis: CONFIRMED. The seen-set that feeds server-side exclusion is not durably written.
  Two gaps, both untouched by the prior two passes (which hardened batch dedupe + seen-ID threading,
  not the write that populates the seen set):
  (G1) recordView fires only on onConfirm — "seen" means "answered", not "shown". A question shown
       then abandoned before confirm is never recorded and can resurface next quiz.
  (G2) seen-store.save() has NO try/catch (unlike quiz-persist.ts). If localStorage.setItem throws
       (Safari private mode / ITP, quota), recordView throws inside the un-awaited onConfirm callback;
       React swallows the error, the write is lost, getSeenIds() returns a stale set, the question repeats.
  G2 is the primary root cause: it directly yields a confirmed-then-repeated question (matches FB21)
  and explains survival across both prior fixes.

test: see Evidence — code-path trace, no live repro needed.
expecting: durable seen-write + record-on-show closes the repeat path.
next_action: apply fix to apps/web/src/lib/seen-store.ts (guard save) and apps/web/src/screens/Play.tsx
  (record view on question render, not only on confirm).

## Symptoms

expected: Within a single session, no question repeats until the eligible pool is exhausted.
actual: A repeat question surfaced mid-session (FB21, binary question).
errors: None reported.
reproduction: Unknown — single user report, no steps. Live web.
started: Reported 2026-05-08.

## Eliminated

- random_published_questions_excluding (00032): p_exclude_ids applied correctly via
  `NOT (q.id = ANY(p_exclude_ids))`. Multi-category questions collapse to one row via
  DISTINCT ON (question_id). No server-side fan-out / repeat source.
- fetchRandomQuestions within-batch dedupe: dedupeAndPickFreshest + final Set pass are airtight.
  A single loaded quiz cannot contain a duplicate ID. Covered by questions.test.ts.
- Mid-quiz refetch: a quiz loads all questions once at Setup.onPlay; Play.tsx never refetches.
  No pagination path that could reintroduce a seen ID.

## Evidence

- timestamp: 2026-05-30
  checked: feedback queue reconciliation (260530-feedback-fixes)
  found: FB21 is the only app-behaviour report in the open queue; all other 28 rows were content/taxonomy.
  implication: Isolated recurrence, not a widespread breakage — but the memory-logic invariant needs re-verifying.

- timestamp: 2026-05-30
  checked: apps/web/src/lib/questions.ts (fetchRandomQuestions, fetchForRange) + supabase migration 00032
  found: seen-exclusion threads getSeenIds() into every per-slug fetch's p_exclude_ids; SQL applies it.
    Batch dedupe + no-fallback invariants from the pxh fix still hold.
  implication: the repeat does not come from the fetch/exclusion logic itself. The seen SET must be
    incomplete at fetch time.

- timestamp: 2026-05-30
  checked: apps/web/src/screens/Play.tsx onConfirm (line 135) — recordView(q.id)
  found: a view is recorded only when the user CONFIRMS an answer. Showing a question is not recorded.
  implication: (G1) abandon-before-confirm leaves a shown question unrecorded → eligible to repeat.

- timestamp: 2026-05-30
  checked: apps/web/src/lib/seen-store.ts save() (lines 14-16) vs apps/web/src/lib/quiz-persist.ts
  found: seen-store.save() calls localStorage.setItem with NO try/catch. quiz-persist wraps every
    storage call in try/catch. recordView is called un-awaited in the React onConfirm handler.
  implication: (G2 — PRIMARY) a throwing setItem (Safari private/ITP, quota) loses the write and is
    swallowed by React's event dispatch. getSeenIds() then returns a stale set and the just-answered
    question can resurface — exactly FB21. Untouched by both prior fixes.

## Resolution

root_cause: The within-session seen set that feeds server-side exclusion is not durably or completely
  populated. Primary: seen-store.save() has no error guard, so a failed localStorage write (private
  mode / quota) silently drops the just-answered question from the seen set, letting it repeat.
  Secondary: views are recorded only on answer-confirm, so a shown-then-abandoned question is never
  excluded. Both gaps sit upstream of the fetch-side dedupe that the two prior fixes hardened.
fix: APPLIED (branch fix/fb21-seen-store-repeat).
  G2 (primary) — apps/web/src/lib/seen-store.ts save(): wrapped localStorage.setItem in try/catch,
    matching quiz-persist.ts. A failed write no longer throws into the un-awaited onConfirm handler.
    Regression test added: apps/web/src/lib/seen-store.test.ts asserts recordView does not throw when
    setItem throws (QuotaExceededError).
  G1 (secondary) — apps/web/src/screens/Play.tsx: moved recordView from onConfirm to a playing-phase
    effect keyed on question index, so a view is recorded on show, not only on Lock-In. recordView is
    idempotent so re-firing on restore is safe.
verification: tsc --noEmit clean; new seen-store tests green (3/3); no new test failures introduced
  (suite had 5 pre-existing failures on HEAD — End/Play fun_fact/happyPath test debt, unrelated; with
  the fix applied 4 remain, net -1). Live-web confirmation of no-repeat is awaiting deploy/UAT.
files_changed:
  - apps/web/src/lib/seen-store.ts
  - apps/web/src/lib/seen-store.test.ts
  - apps/web/src/screens/Play.tsx
commits:
  - fix(web): guard seen-store save() against localStorage write failures
  - fix(web): record question view on show, not only on Lock-In

## Notes

Routed out of the 260530-feedback-fixes content roadmap (content-only scope). The FB21 feedback row
was resolved pointing at this file. Pick up via /gsd:debug.
