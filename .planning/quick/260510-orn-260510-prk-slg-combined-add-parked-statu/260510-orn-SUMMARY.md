---
phase: 260510-orn
plan: 01
subsystem: data-fix+schema
tags: [quick-task, parking-lane, category-extension, status-widen, 999.23-followup]
requires: []
provides:
  - "Parking lane: questions.parked_reason column + status='parked' allowed via widened CHECK"
  - "4 new leaf categories under existing parents (board-games, electronic-music, 2010s-music, pizza)"
  - "3 outlier questions parked with awaiting-category reasons (deferred to 260510-fas-altmed)"
affects:
  - data/audit-changes.jsonl
  - supabase/migrations/00036_add_parked_reason.sql
  - supabase/migrations/00037_categories_extension.sql
tech-stack:
  added: []
  patterns: [check-constraint-widen, optimistic-update-guard, jsonl-audit-append, parking-lane-status, leaf-category-insert]
key-files:
  created:
    - supabase/migrations/00036_add_parked_reason.sql
    - supabase/migrations/00037_categories_extension.sql
  modified:
    - data/audit-changes.jsonl
decisions:
  - "Widened questions_status_check (Option 1) to allow 'parked' — plan assumed unconstrained text but real schema has CHECK constraint. Honors plan's 'no enum' intent."
  - "Did NOT fix categories.depth=0 drift on the 4 new leaves — known issue tracked under 260510-dpd; out of scope here."
metrics:
  duration_seconds: 240
  completed_date: "2026-05-10"
  tasks_completed: 1
  files_modified: 3
---

# Phase 260510-orn Plan 01: Parking lane + 4-leaf category extension + park 3 outliers Summary

One-liner: Shipped two Supabase migrations — 00036 adds the parking lane (parked_reason column, widened status CHECK to include 'parked', parks 3 outlier questions awaiting alternative-medicine/fashion-and-clothing categories) and 00037 adds 4 new leaf categories (board-games, electronic-music, 2010s-music, pizza) under existing parents — and appended 8 audit rows under batch `260510-prk-slg`.

## Outcome

| Field | Value |
|---|---|
| Migration 00036 | parked_reason text col + widened status_check + 3 parks (1 → alternative-medicine, 2 → fashion-and-clothing) |
| Migration 00037 | 4 inserts: board-games (under gaming), electronic-music + 2010s-music (under music), pizza (under food-and-drink) |
| Parked Qs | 8843ae93 (Japanese shiatsu), a56a93d2 (Inditex/Zara HQ), ce1c631c (Scotsman/kilt) — all status=parked + parked_reason set |
| New leaf cats | board-games, electronic-music, 2010s-music, pizza — all 4 present, parent_id set correctly |
| Audit batch_id | 260510-prk-slg |
| Audit rows appended | 8 (lines 94-101 in data/audit-changes.jsonl); 1 schema_change + 3 status_change + 4 insert |
| Commit | fd02fe4 |

## Tasks

1. **Edited 00036** to add CHECK widening between the column-add and the 3 UPDATE statements (Option 1, per user). DROP + ADD CONSTRAINT questions_status_check with array now including 'parked'.
2. **`supabase db push --linked`** — succeeded; both 00036 and 00037 applied to remote.
3. **Verified post-state** via service-role Supabase client (Node):
   - 3 questions: all `status=parked` with correct `parked_reason`. PASS
   - 4 categories present, parents resolve to gaming/music/music/food-and-drink. PASS
   - depth=0 on all 4 new leaves (expected drift per 260510-dpd; NOT fixed here).
4. **Appended 8 audit rows** under batch `260510-prk-slg` matching line 89 shape (`cousin_reason:null, chain_ancestor:false`).
5. **Combined commit** `fd02fe4` staged: 00036, 00037, audit-changes.jsonl (no docs).
6. **Audit grep** captured below.

## Deviations from Plan

### Auto-fixed Issues

**1. [User-chosen — Option 1] Widened existing `questions_status_check` to include 'parked'.**
- Plan assumed `questions.status` was unconstrained text.
- Actual: schema has `questions_status_check CHECK (status = ANY (ARRAY['pending','verified','rejected','published']))` — first push hit checkpoint because UPDATE … SET status='parked' would violate.
- Fix: in 00036, added `ALTER TABLE questions DROP CONSTRAINT questions_status_check; ALTER TABLE questions ADD CONSTRAINT questions_status_check CHECK (status = ANY (ARRAY['pending','verified','rejected','published','parked']));` between the column-add and the parks. Honors plan's "no enum migration" intent — stays as text + array CHECK.

**2. [Out-of-scope, NOT fixed] Categories `depth=0` instead of `depth=1` on the 4 new leaves.**
- Verification SELECT showed all 4 new leaves at depth=0 even though they have non-null parent_id pointing to a depth-0 parent.
- Per instructions and ROADMAP §C1 260510-dpd, this is a known taxonomy drift; do NOT fix here.

### Auth Gates

None (Supabase CLI already linked; service-role key from `pipeline/.env`).

## Verification

Question parks (Supabase, service-role Node client):
```
[
  {"id":"8843ae93-…","status":"parked","parked_reason":"awaiting category: alternative-medicine"},
  {"id":"a56a93d2-…","status":"parked","parked_reason":"awaiting category: fashion-and-clothing"},
  {"id":"ce1c631c-…","status":"parked","parked_reason":"awaiting category: fashion-and-clothing"}
]
```
PASS — all 3 rows present, status=parked, parked_reason set as expected.

Category leaves:
```
board-games        depth=0  parent=gaming
electronic-music   depth=0  parent=music
2010s-music        depth=0  parent=music
pizza              depth=0  parent=food-and-drink
```
PASS on presence + parent linkage. depth=0 drift NOT fixed (260510-dpd scope).

Audit file: `wc -l data/audit-changes.jsonl` → 101 (was 93 + 8 appended). All 8 new lines parse as JSON.

CHECK constraint widening: not directly queryable via PostgREST (no exec_sql RPC), but proven by the fact that the 3 `UPDATE … SET status='parked'` statements in 00036 succeeded during `supabase db push --linked` — they would have raised `23514 check_violation` against the old CHECK.

## Audit: `status = 'published'` references (informational, NO refactor)

Captured per task — in-tree references to `status = 'published'` filter (these are the live-quiz reads that auto-exclude `parked` rows without code changes):

- supabase/migrations: 00001 (RLS USING + index), 00004 (calibrator partial index), 00006/00007/00008/00015/00016/00017/00022/00024/00025/00026/00027/00029/00032/00033 — all RPC `WHERE q.status = 'published'` filters.
- pipeline/src/agents/qa.ts:259, 305 — sets `updateData.status = 'published'` after QA pass (writes only; no read filter to update).
- pipeline/src/agents/calibrator.ts:342 — comment only.

No refactor needed: `status='published'` filters naturally exclude `parked` rows. No code in tree currently reads `parked` rows (the parking lane is by design dormant until 260510-fas-altmed).

## Self-Check: PASSED

- supabase/migrations/00036_add_parked_reason.sql — FOUND.
- supabase/migrations/00037_categories_extension.sql — FOUND.
- data/audit-changes.jsonl — FOUND, 101 lines.
- Commit fd02fe4 — FOUND in `git log --oneline`.
