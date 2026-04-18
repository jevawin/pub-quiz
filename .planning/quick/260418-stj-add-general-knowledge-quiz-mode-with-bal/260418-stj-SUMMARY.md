---
phase: 260418-stj
plan: 01
subsystem: supabase-rpc
tags: [supabase, migration, rpc, quiz]
requires: [categories table, questions table]
provides: [random_general_knowledge_questions RPC]
affects: [General Knowledge quiz mode call sites (future plan)]
tech-stack:
  added: []
  patterns:
    - "Recursive CTE ancestry walk from leaf category to root"
    - "Round-robin sampling via ROW_NUMBER() OVER (PARTITION BY root_id ORDER BY random())"
key-files:
  created:
    - supabase/migrations/00016_random_general_knowledge_questions_rpc.sql
  modified: []
decisions:
  - "Used SECURITY INVOKER to match existing RPC convention (RLS already allows public read of published questions)"
  - "Roots discovered dynamically via parent_id IS NULL — no hardcoded root slug list"
  - "Graceful shortfall handled by global ORDER BY rn: roots with surplus fill slots vacated by depleted roots"
metrics:
  duration_seconds: 56
  completed: 2026-04-18
  tasks: 2
  files_changed: 1
---

# Quick Task 260418-stj: Add General Knowledge Quiz Mode (Balanced) — Summary

Added a Supabase RPC `random_general_knowledge_questions(p_limit INT)` that returns up to `p_limit` published questions sampled round-robin across every root category (discovered dynamically via `parent_id IS NULL`), enabling balanced General Knowledge quizzes without biasing toward roots with more questions.

## What Shipped

- New migration `supabase/migrations/00016_random_general_knowledge_questions_rpc.sql`.
- Return shape mirrors `random_published_questions` exactly: `(id, question_text, correct_answer, distractors, explanation, category_id, category_slug)` with `category_slug` being the root ancestor slug.
- `SECURITY INVOKER`, `STABLE`, `SET search_path = public` — matches existing RPC convention.
- `GRANT EXECUTE ... TO anon, authenticated`.

## Implementation Notes

Three-CTE design under a single `WITH RECURSIVE`:

1. `ancestry` (recursive) — maps every category id to its root ancestor (id + slug). Roots map to themselves.
2. `pool` — published questions joined to their root via ancestry.
3. `ranked` — `ROW_NUMBER() OVER (PARTITION BY root_id ORDER BY random())` ranks questions within each root randomly.

Final `SELECT ... ORDER BY r.rn, random() LIMIT p_limit` produces round-robin: every root contributes rank 1 before any contributes rank 2. When a root runs out of questions it simply drops from higher ranks; the global ordering then pulls extras from roots with surplus, giving graceful shortfall up to `p_limit`.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Create balanced general-knowledge RPC migration | 0210ea0 | supabase/migrations/00016_random_general_knowledge_questions_rpc.sql |
| 2 | Validate SQL (deferred) | — | no code changes |

Task 2 performed verification checks only; no file changes so no separate commit.

## Deviations from Plan

None — plan executed as written.

### Validation Status

`supabase db reset` requires Docker which is not running in this environment, and `psql` is not installed. Syntax was reviewed manually against the three existing reference RPCs (00006, 00008, 00015) for:

- `WITH RECURSIVE` placement (single header covers mixed recursive + non-recursive CTEs in PostgreSQL — valid).
- Self-reference in the recursive `ancestry` CTE uses `JOIN ancestry a ON a.cat_id = c.parent_id` to climb leaf → root.
- Column aliases on the recursive branch match the anchor (`cat_id`, `root_id`, `root_slug`).
- Return shape and GRANT syntax copied from 00008.

**Full validation (supabase db reset + smoke query `SELECT COUNT(*), COUNT(DISTINCT category_slug) FROM random_general_knowledge_questions(20)`) is deferred to the local dev machine where Docker is available.** No auto-fix attempts were needed — file verified against plan's automated grep checks (all pass).

## Verification

- [x] `supabase/migrations/00016_random_general_knowledge_questions_rpc.sql` exists
- [x] Function name, signature, and return shape match the contract
- [x] No hardcoded root slugs anywhere in the file
- [x] `GRANT EXECUTE ... TO anon, authenticated` present
- [x] Filters on `status = 'published'`
- [x] Discovers roots via `parent_id IS NULL`
- [ ] SQL applied cleanly against a fresh database (deferred — Docker/psql unavailable in this env)

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: supabase/migrations/00016_random_general_knowledge_questions_rpc.sql
- FOUND commit: 0210ea0
