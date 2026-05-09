# Phase 999.22 — PLAN

7 waves. Test scaffolding first (red), then code, then trigger, then backfill, then verify.

## Wave 0 — Test scaffolding (red)

**Goal:** Failing tests for new behaviour, before implementation. Establishes the contract.

- `pipeline/src/agents/calibrator.test.ts` — add cases:
  - Q assigned to a leaf slug with a 3-deep chain → calibrator returns 3 qc rows (leaf + parent + root), each with distinct estimate_score.
  - Q assigned to a root-only slug (e.g. `general-knowledge`) → 1 row.
  - Existing rows preserved on re-run (insert-only).
- `supabase/tests/rpc.test.sql` (or pgTAP equivalent) — add cases:
  - `random_published_questions_excluding('hard', root_slug, ...)` filters by ROOT row's score, not leaf.
  - Legacy Q with only leaf row + no root row → falls back to leaf row's score.
- All red.

**Files:** ~2 test files. ~30 min.

## Wave 1 — Calibrator chain emission

**Goal:** Calibrator change. Wave 0 calibrator tests green.

- `pipeline/src/agents/calibrator.ts`:
  - For each `assigned_slug`, walk up `parent_id` chain to root via a categories tree fetch (cache for batch run).
  - Score each ancestor as a separate Claude turn OR single-prompt JSON keyed by slug.
  - Upsert with `ON CONFLICT (question_id, category_id) DO NOTHING` (insert-only per locked decision 5).
- System prompt rewrite for tier-specific scoring (locked decision 8). Anchor examples:
  ```
  Example chain scoring for "Who won The International 2016 (Dota 2)?":
  - gaming: 15 (broad gamers don't follow esports tournaments)
  - esports-and-competitive-gaming: 50 (esports fans know top events)
  - (no leaf — esports is the deepest applicable cat for this Q)
  ```
- GK rule: only add GK row when proposer/calibrator deems Q pub-table-knowable (locked decision 4). Drop the auto-GK behaviour from `calibrateQuestion`.
- Tests green.

**Files:** `calibrator.ts`, `calibrator.test.ts`. ~2-3h.

## Wave 2 — RPC chosen-pill score

**Goal:** RPC change. Wave 0 RPC tests green.

- New migration `00032_rpcs_chosen_pill_score.sql` rewrites:
  - `random_published_questions_excluding`
  - `count_available_questions`
  - `counts_by_root_category`
- Logic per SPEC §Code changes / RPC sketch:
  - `WITH chosen_cat AS (SELECT id FROM categories WHERE slug = p_category_slug)`
  - `effective` CTE flags `is_chosen` per qc row
  - `preferred` CTE picks chosen-pill row first via `DISTINCT ON (question_id) ORDER BY is_chosen DESC`
  - Filter on preferred row's score
- Apply via `supabase db push`. Run migration verify queries.

**Files:** `00032_rpcs_chosen_pill_score.sql`, RPC tests. ~3-4h.

## Wave 3 — Trigger cap bump (4 → 5)

**Goal:** Trigger allows 5 rows per Q. Locked decision 1.

- New migration `00033_trigger_cap_bump_5.sql`:
  - `CREATE OR REPLACE FUNCTION enforce_question_categories_rules()` with `IF row_count > 5 THEN RAISE EXCEPTION ...`.
- Apply.

**Files:** `00033_trigger_cap_bump_5.sql`. ~30 min.

## Wave 4 — Backfill driver + dry-run

**Goal:** Backfill orchestration scaffold. Validate on small sample before full run.

### Backfill design (subagent dispatch)

- New script `pipeline/src/scripts/backfill-chain-tags.ts`:
  - Phase 1: query published Qs missing chain rows. A Q is "missing chain" if for any assigned cat, an ancestor row in `question_categories` does not exist.
  - Phase 2: dump full work-list to `.planning/phases/999.22-chain-tagging-architecture/data/backfill-worklist.json` (id, question_text, correct_answer, distractors, existing_slugs[] with scores, ancestors_to_add[]).
  - Phase 3: chunk into batches of 100 → `data/batches/batch-NNN.json`.
- New orchestration doc `BACKFILL-RUNBOOK.md` describes:
  - How to spawn subagent per batch (general-purpose Agent tool, fresh context).
  - Subagent prompt template: tree, rubric, anchor examples, batch IDs, instructions to apply via service-role insert + return summary JSON.
  - Main loop reads PROGRESS.md, dispatches next batch, commits per batch.
- **Dry-run:** spawn 1 subagent on `batch-001.json` (first 100 Qs). Inspect output: rows added, score distribution, time taken, any failures. Adjust rubric if scores look off.

**Files:** `backfill-chain-tags.ts`, `BACKFILL-RUNBOOK.md`, dry-run output review. ~1-2h dev + 1h review.

## Wave 5 — Full backfill execution

**Goal:** Chain rows for all ~3056 published Qs.

- Run main loop. ~31 batches.
- Per batch: dispatch subagent, await result, apply (subagent does inserts itself), update PROGRESS.md with batch summary, commit.
- Estimated: ~10-15 min per subagent batch (subagent reasons through 100 Qs + applies inserts). Total ~5-8h wall time across multiple sessions.
- Resume: if interrupted, PROGRESS.md tracks completed batches; next session continues from next pending.

**Estimated rows added:**
- Avg chain depth ~2 (most cats are root + sub). Some 3-deep. Plus optional GK.
- Per Q: ~1-3 new rows (existing leaf already there).
- Total new rows: ~3000-9000.

**Files:** PROGRESS.md continuously updated, commits per batch. ~5-8h wall time.

## Wave 6 — Verification + cleanup

**Goal:** Confirm chain tagging applied correctly. Spot-check.

- Re-dump `cat-tree-with-counts.json`. Diff vs pre-backfill.
- Sample 50 random published Qs across roots. Manually verify:
  - Has root row with reasonable estimate_score for tier
  - Sub row score >= root row score (sub audience generally better-versed)
  - GK row absence/presence matches rule
- SQL audit query: count Qs missing root-tier row. Should approach 0.
- Update `STATE.md` + `ROADMAP.md`. Mark 999.22 complete. Promote 999.23 (cousin pass) to NEXT.

**Files:** verification report in `VERIFICATION.md`, STATE/ROADMAP updates. ~2h.

## Risks + mitigations

- **Subagent variance.** Different subagents may score same-tier audiences differently. Mitigate: rubric with anchor examples + post-backfill sample audit. If drift severe, re-run drift-affected batches.
- **Subagent failures mid-batch.** If subagent crashes after partial inserts, batch becomes inconsistent. Mitigate: subagent applies all inserts in single transaction; main loop retries failed batches.
- **Cap-5 exceeded.** Q with chain (3) + GK (1) + existing cousin (1) = 5 = at cap. New cousin proposal → reject. Mitigate: backfill skips cousins (locked decision 3); 999.23 handles cousins explicitly.
- **Backfill cost (subagent runtime).** 31 batches × ~15 min = ~8h Opus runtime. Free per user's plan.

## Order of operations

1. Wave 0 (tests, ~30 min)
2. Wave 1 (calibrator, ~2-3h)
3. Wave 2 (RPC, ~3-4h)
4. Wave 3 (trigger, ~30 min)
5. Wave 4 (backfill driver + dry-run, ~2-3h)
6. Wave 5 (full backfill, ~5-8h wall, may span sessions)
7. Wave 6 (verification, ~2h)

**Total dev:** ~10-13h across waves 0-4 + 6.
**Backfill wall:** ~5-8h Opus subagent runtime (free).
