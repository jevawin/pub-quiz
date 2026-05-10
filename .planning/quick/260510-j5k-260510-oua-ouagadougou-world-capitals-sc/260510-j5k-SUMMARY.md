---
phase: 260510-j5k
plan: 01
subsystem: data-fix
tags: [quick-task, category-scores, 999.23-followup]
requires: []
provides:
  - "Ouagadougou question correctly weighted under world-capitals"
affects:
  - data/audit-changes.jsonl
tech-stack:
  added: []
  patterns: [optimistic-update-guard, jsonl-audit-append]
key-files:
  created: []
  modified:
    - data/audit-changes.jsonl
decisions:
  - "Used real schema columns (estimate_score, category_id) rather than the plan's flat-schema interface (Rule 3 — fix blocking issue)"
metrics:
  duration_seconds: 113
  completed_date: "2026-05-10"
  tasks_completed: 3
  files_modified: 1
---

# Phase 260510-j5k Plan 01: Ouagadougou world-capitals score bump Summary

One-liner: Bumped Ouagadougou question's `world-capitals` `estimate_score` from 45 to 70 via guarded Supabase UPDATE and appended a `260510-oua` audit row.

## Outcome

| Field | Value |
|---|---|
| question_id | `7ab8a974-7e33-4420-92cc-5047169efe45` |
| Question text | "What is the capital of Burkina Faso?" |
| Slug changed | `world-capitals` |
| Previous score | 45 |
| New score | 70 |
| Audit timestamp | `2026-05-10T12:51:24.647Z` |
| Audit batch_id | `260510-oua` |
| Commit | `b5f950d` |

Other category rows for the same question were left untouched:

| Slug | estimate_score (unchanged) |
|---|---|
| african-geography | 50 |
| geography | 30 |

## Tasks

1. **Task 1 — Find question + confirm row.** Located exactly one matching row (`7ab8a974…`); pre-update `world-capitals` score = 45 confirmed.
2. **Task 2 — UPDATE with optimistic guard.** Ran `UPDATE … SET estimate_score = 70 WHERE question_id = '…' AND category_id = (SELECT id FROM categories WHERE slug='world-capitals') AND estimate_score = 45 RETURNING …` — returned exactly 1 row, new value 70.
3. **Task 3 — Append audit row.** One JSON line appended to `data/audit-changes.jsonl` (line 89). Validated as parseable JSON.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Plan's interface assumed a flat `question_categories(question_id, category_slug, score)` schema; real schema is `(question_id, category_id, estimate_score, observed_score, observed_n, …)`.**
- Found during: Task 1 (initial SELECT failed with `column "category_slug" does not exist`).
- Fix: Joined `question_categories` to `categories` on `category_id` to filter by `slug`. UPDATE used `category_id = (SELECT id FROM categories WHERE slug='world-capitals')`. Audit JSON still uses the abstract `slug` field per the plan's interface (matches existing 999.23 entries).
- Files modified: none beyond planned (`data/audit-changes.jsonl` only).
- Commit: `b5f950d`.

**2. [Rule 3 — Blocking] macOS `date -u +"…%3N…"` does not support millisecond precision.**
- Found during: Task 3 (first append produced `12:51:15.3NZ`, an invalid ISO timestamp).
- Fix: Removed the malformed line via `sed -i '' '$d'`, regenerated using `node -e "console.log(new Date().toISOString())"`.
- Files modified: `data/audit-changes.jsonl` (rolled back then re-appended).
- Commit: `b5f950d` contains the corrected line only.

### Auth Gates

None.

## Verification

- `SELECT estimate_score FROM question_categories qc JOIN categories c ON c.id=qc.category_id WHERE qc.question_id='7ab8a974…' AND c.slug='world-capitals'` → `70.00`. PASS
- All other rows for that `question_id` unchanged (african-geography 50, geography 30). PASS
- `tail -1 data/audit-changes.jsonl | grep -c '"batch_id":"260510-oua"'` → `1`. PASS
- `node -e "JSON.parse(require('fs').readFileSync('data/audit-changes.jsonl','utf8').trim().split('\n').pop())"` → exits 0. PASS
- `git diff --stat 25ed2d3..HEAD -- supabase/migrations/` → empty. PASS

## Self-Check: PASSED

- Commit `b5f950d` exists in git log.
- `data/audit-changes.jsonl` contains 89 lines (was 88), last line carries `batch_id=260510-oua` and `new_score=70`.
- No diffs under `supabase/migrations/`.
