---
phase: 260510-jsh
plan: 01
subsystem: data-fix
tags: [quick-task, near-duplicate, category-backfill, 999.23-followup]
requires: []
provides:
  - "Sputnik 1 near-duplicate pair resolved (B retired, A's category coverage rebalanced)"
affects:
  - data/audit-changes.jsonl
tech-stack:
  added: []
  patterns: [optimistic-update-guard, jsonl-audit-append, near-duplicate-retire+backfill]
key-files:
  created: []
  modified:
    - data/audit-changes.jsonl
decisions:
  - "Option 1 (user-chosen): bumped A's existing space-exploration row 88→90 instead of plan's INSERT (audit op=update)"
  - "Option 2 (user-chosen): dropped A's the-solar-system@25 to free a slot for technology@85, due to DB 5-category-per-question cap. Sputnik fits technology/space-exploration better than the-solar-system (orbited Earth, not solar system)"
  - "Used real schema columns (estimate_score, category_id) rather than the plan's flat-schema interface (Rule 3 — fix blocking issue, inherited from sibling 260510-j5k)"
metrics:
  duration_seconds: 180
  completed_date: "2026-05-10"
  tasks_completed: 4
  files_modified: 1
---

# Phase 260510-jsh Plan 01: Sputnik near-duplicate retire + backfill Summary

One-liner: Retired duplicate question B (`f862b7cf`, status published→rejected) and rebalanced canonical question A (`7de67f33`) category coverage — bumped `space-exploration` 88→90, dropped `the-solar-system`@25, inserted `technology`@85 — to absorb B's better category signal within the 5-category-per-question cap.

## Outcome

| Field | Value |
|---|---|
| Question A (kept) | `7de67f33-b1f1-44d8-8036-e53ed58820c6` ("...launched into orbit") |
| Question B (retired) | `f862b7cf-65ba-4722-97f1-17f4238fe09e` ("...launched into space") |
| B status change | `published` → `rejected` |
| A categories before | space-exploration=88, history=80, general-knowledge=80, science=50, the-solar-system=25 (5 rows) |
| A categories after | space-exploration=90, technology=85, history=80, general-knowledge=80, science=50 (5 rows) |
| Audit batch_id | `260510-dup` |
| Audit rows appended | 4 (lines 90-93 in `data/audit-changes.jsonl`) |

## Tasks

1. **B retire (durable from prior session).** `UPDATE questions SET status='rejected' WHERE id='f862b7cf…' AND status='published'` — 1 row.
2. **A space-exploration bump (durable from prior session).** Existing row updated 88→90 (Option 1, deviation from plan's INSERT — A already had the slug).
3. **A the-solar-system DELETE@25.** `DELETE FROM question_categories WHERE question_id='7de67f33…' AND category_id=(SELECT id FROM categories WHERE slug='the-solar-system') AND estimate_score=25 RETURNING …` → 1 row deleted. Frees a slot under the 5-category cap.
4. **A technology INSERT@85.** Guarded INSERT (NOT EXISTS) → 1 row inserted.
5. **Append 4 audit rows.** `260510-dup` batch — 1 status_change on B, 1 update + 1 delete + 1 insert on A. Shape matches line 89 (`cousin_reason:null, chain_ancestor:false`). All 4 lines validated as parseable JSON.

## Deviations from Plan

### Auto-fixed Issues

**1. [User-chosen — Option 1] A already had a `space-exploration` row at 88, not absent.**
- Plan called for INSERT `space-exploration`@90 on A.
- Actual: pre-state had A.space-exploration = 88 (not the plan's assumed null).
- User decision: UPDATE 88→90 instead of INSERT (audit logged as `op=update`, prev=88, new=90, reason references "option 1: existing row updated").

**2. [User-chosen — Option 2] DB enforces a 5-category-per-question cap; A was already at 5 rows.**
- Plan called for INSERT `technology`@85 (would have made 6).
- Actual: A had 5 rows after step 2 (space-exploration=90, history=80, general-knowledge=80, science=50, the-solar-system=25).
- User decision: DROP A's `the-solar-system`@25 (Sputnik orbited Earth — solar-system is tangential), then INSERT `technology`@85. Net rows: still 5. Audit logged as `op=delete` for the-solar-system + `op=insert` for technology.

**3. [Rule 3 — Blocking, inherited from 260510-j5k] Plan's interface assumed flat `question_categories(question_id, category_slug, estimate_score)`; real schema is `(question_id, category_id, estimate_score, …)` with `category_id` FK to `categories(id, slug)`.**
- Fix: All UPDATE/DELETE/INSERT used `category_id = (SELECT id FROM categories WHERE slug='…')`. Audit JSON keeps `slug` field per plan interface.
- Files modified: none beyond planned (`data/audit-changes.jsonl` only).

### Auth Gates

None (Supabase CLI already linked via `supabase projects list`).

## Verification

Final SELECT against Supabase:
```sql
SELECT c.slug, qc.estimate_score
FROM question_categories qc JOIN categories c ON c.id=qc.category_id
WHERE qc.question_id='7de67f33-b1f1-44d8-8036-e53ed58820c6'
ORDER BY qc.estimate_score DESC;
```
Returned exactly 5 rows: space-exploration=90.00, technology=85.00, history=80.00, general-knowledge=80.00, science=50.00. PASS

Question status SELECT:
```sql
SELECT id, status FROM questions WHERE id IN ('7de67f33…','f862b7cf…');
```
Returned: 7de67f33 → published, f862b7cf → rejected. PASS

Audit file: `wc -l data/audit-changes.jsonl` → 93 (was 89 + 4 appended). All 4 new lines pass `JSON.parse`. PASS

## Self-Check: PASSED

- File `data/audit-changes.jsonl` exists with 93 lines (verified via `wc -l`).
- Final commit hash will be recorded in git log after this commit lands.
