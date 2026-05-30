---
status: open
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

hypothesis: UNCONFIRMED. Within-session repeat-question regression. Two prior passes targeted this:
  (1) 2026-04-17 quiz-cutoff-and-repeats — server-side seen-exclusion RPC + client passes seen IDs.
  (2) 2026-04-26 quick-260426-pxh — removed the silent stale-repeat fallback in `fetchRandomQuestions`,
      added a final Set-based dedupe pass, added category interleave.
This FB21 report (2026-05-08) is AFTER both. Either a new path reintroduced a repeat, or the
seen-ID set is not being threaded on this particular load.

test: Reproduce a single-session run long enough to exhaust the unseen pool for a narrow category;
  confirm whether a repeat appears before the pool is empty, and whether `p_exclude_ids` carries the
  full in-session seen list on every fetch (not just the first page).
expecting: With the pxh fix in place, no repeat until pool exhausted. A repeat before exhaustion = regression.
next_action: Re-read apps/web/src/lib/questions.ts fetchRandomQuestions + its callers; diff against the
  pxh commits (36fd85d, 9eb505d, 1b7b54c) to check the dedupe pass + no-fallback invariant still hold.

## Symptoms

expected: Within a single session, no question repeats until the eligible pool is exhausted.
actual: A repeat question surfaced mid-session (FB21, binary question).
errors: None reported.
reproduction: Unknown — single user report, no steps. Live web.
started: Reported 2026-05-08.

## Eliminated

(none yet)

## Evidence

- timestamp: 2026-05-30
  checked: feedback queue reconciliation (260530-feedback-fixes)
  found: FB21 is the only app-behaviour report in the open queue; all other 28 rows were content/taxonomy.
  implication: Isolated recurrence, not a widespread breakage — but the memory-logic invariant needs re-verifying.

## Notes

Routed out of the 260530-feedback-fixes content roadmap (content-only scope). The FB21 feedback row
was resolved pointing at this file. Pick up via /gsd:debug.
