---
phase: quick-260426-ow2
plan: 01
subsystem: db-rpc
tags: [supabase, rpc, category-filter, question-categories, bug-fix]
status: awaiting-human-verify
requirements: [SPT-01]
dependencies:
  requires:
    - migration 00022 (question_categories join table)
    - migration 00024 (fun_fact return column)
    - Phase 999.8 Plan 04 backfill (in progress, ~88% complete)
  provides:
    - Accurate Sports filter (and all root categories) using join-table truth.
  affects:
    - apps/web Setup → fetchRandomQuestions / count display
key_files:
  created:
    - supabase/migrations/00025_category_filter_uses_join_table.sql
    - pipeline/src/scripts/investigate-sport-leak.ts
    - .planning/quick/260426-ow2-260427-spt-fix-sport-category-filter-bug/INVESTIGATION.md
  modified: []
decisions:
  - Compatibility shim: legacy category_id fallback used only when a question has zero question_categories rows. Removable after backfill reaches 100% (Phase 999.8 Plan 05).
  - Did NOT switch to a pure join filter because 348 of 2848 published questions still lack join rows; pool would collapse for several roots.
metrics:
  tasks_completed: 2_of_3
  duration: 12min
  completed_date: 2026-04-26
commits:
  - 4de92ff chore(260426-ow2-01): investigate sport category leak
  - 731785c feat(260426-ow2-02): filter category quizzes via question_categories with legacy fallback
---

# Quick Task 260426-ow2: Fix Sport Category Filter Bug — Summary

Sport pill in Setup was returning non-sport questions. Investigation traced the bug to RPCs filtering by the legacy `questions.category_id` column instead of the new `question_categories` join table written by the Phase 999.8 pipeline. Fix: rewrite both filter RPCs to consult the join table, falling back to legacy only for un-backfilled rows.

## Investigation findings

Captured in `INVESTIGATION.md`. Headline numbers:

- 130 published questions linked to the sports subtree via `question_categories`.
- 144 published questions whose legacy `category_id` is in the sports subtree.
- 10 join-sport questions whose legacy `category_id` is NOT sport (recovered after fix — e.g. snooker, World Cup, Olympics tagged under tv/music/geography).
- 0 backfilled questions disagree with sports in the legacy direction; the 14-row gap is entirely the un-backfilled set + agent over-tags.
- 348 of 2848 published questions still have no `question_categories` rows (~12.2% un-backfilled). Legacy fallback is essential.

Conclusion: leak confirmed. Approach validated — proceed with migration.

## Migration applied

`supabase/migrations/00025_category_filter_uses_join_table.sql` recreates:

- `random_published_questions_excluding(TEXT, TEXT, INT, UUID[])`
- `count_available_questions(TEXT, TEXT, UUID[])`

New filter clause:

```sql
AND (
  p_category_slug IS NULL
  OR p_category_slug = 'general'
  OR EXISTS (
    SELECT 1 FROM question_categories qc
    WHERE qc.question_id = q.id
      AND qc.category_id IN (SELECT id FROM cat_tree)
  )
  OR (
    NOT EXISTS (SELECT 1 FROM question_categories qc WHERE qc.question_id = q.id)
    AND q.category_id IN (SELECT id FROM cat_tree)
  )
)
```

`general` short-circuit, exclude-ids logic, and `fun_fact TEXT` return column from 00024 are preserved. `EXECUTE` re-granted to `anon` and `authenticated`.

Untouched (out of scope): `random_general_knowledge_questions_rpc`, `counts_by_root_category`.

## Verification result

**Task 3 awaiting human action.** The migration has not been pushed to remote. The user must:

1. Run `npx supabase db push` from the repo root (or the project's standard command) to apply migration 00025 to the live Supabase project.
2. Start the web dev server (`pnpm --filter web dev` or equivalent).
3. Open Setup, deselect All, select only the Sports pill, click Play, play a 10-question quiz.
4. Confirm every question is sports-related.
5. Repeat for one or two other roots (Science, Music) to check no regression.
6. Reply with "approved" or describe which question slipped through and from which category.

Until that human-verify checkpoint passes, this plan is **NOT COMPLETE**.

## Feedback row resolution

Feedback row `2ddac7cc-778a-44be-b4ea-8c792c79f01c` (sport filter complaint) is **NOT YET resolved** — wait for live verification before marking it.

## Deviations from Plan

None. Plan executed as written. The investigation produced one extra query (Q2b — un-backfilled legacy-sport rows) to fully characterize the fallback path, which strengthened the confidence in the migration.

## Self-Check: PASSED

- supabase/migrations/00025_category_filter_uses_join_table.sql — FOUND
- pipeline/src/scripts/investigate-sport-leak.ts — FOUND
- .planning/quick/260426-ow2-260427-spt-fix-sport-category-filter-bug/INVESTIGATION.md — FOUND
- Commit 4de92ff — FOUND
- Commit 731785c — FOUND
