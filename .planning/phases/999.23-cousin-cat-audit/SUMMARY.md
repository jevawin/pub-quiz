---
phase: 999.23-cousin-cat-audit
status: COMPLETE
completed: 2026-05-10
plans: 5/5
requirements_locked: [R1, R2, R3, R4, R5]
acceptance_criteria_pass: 8/8
verification: 999.23-VERIFICATION.md
next_phase: 999.18
---

# Phase 999.23 — Cousin / Category Audit — SUMMARY

## One-liner

Resolved all 19 cap-5 collision Qs from 999.22 and reviewed every 999.22-flagged mistag candidate (35 entries, 23 fix / 11 keep / 1 defer) via batched conversational service-role writes — cap-5 invariant intact, chain ancestors complete, no protected files touched.

## Outcome

- **Cap-5 collisions:** 19/19 resolved across batches `cap5-001` (10 Qs), `cap5-002` (9 Qs), `cap5-003` (9 corrective fixes after a misapplication). `build-chain-backfill-worklist.ts` now reports 0 remaining Qs needing chain ancestors (verified end-of-phase, AC1).
- **Mistag review:** 35/35 candidates decided (≥ 30 required). Split 23 fix / 11 keep / 1 defer. All 23 fixes have at least one corresponding line in `data/audit-changes.jsonl` (AC3).
- **Cousin tags:** strict ROADMAP §999.23 rule held — only one non-chain insert across the phase (a primary-domain `language-and-words` add for a Spanish vocabulary Q on 3488dea5), carrying a `cousin_reason`. No `pop-culture` cousins added in this phase — opportunities did not arise within the worklist.
- **Cap-5 invariant:** project-wide scan returns 0 Qs over 5 rows (8373 rows / 2868 distinct Qs) — AC4.
- **Format:** batched conversational pass with user-confirmation on every batch. Service-role writes via `apply-cousin-changes.ts` (built in plan 01).

## Stats

- Audit log lines: **88** (`data/audit-changes.jsonl`)
  - cap5-001: 27 lines
  - cap5-002: 19 lines
  - cap5-003: 17 lines
  - mistag-001: 25 lines
- Ops by type: **52 deletes / 36 inserts / 0 set_primary**
- Chain-ancestor inserts: **35** (cap-5 batches restoring chain rows after pruning)
- Non-chain (cousin/primary) inserts: **1** (language-and-words for the Spanish vocabulary Q)
- `pop-culture` cousin adds: **0**
- Primary `set_primary` moves: **0**
- Commits per batch: cap5-001 → 1 commit; cap5-002 + cap5-003 → 1 shared commit (corrective same-session); mistag-001 → 1 commit. 4 batch IDs across 3 batch-execution commits + 4 plan-level docs/summary commits.

## Files added (this phase)

- `pipeline/src/scripts/apply-cousin-changes.ts` — service-role applier for delete/insert/set_primary ops with cap-5 trigger ordering (commit `be95be2`, tested in `d7e0350`).
- `pipeline/src/scripts/seed-mistag-worklist.ts` — heuristic seeder for mistag candidates (commit `b836108`).
- `data/audit-changes.jsonl` — append-only audit trail of every DB write in the phase (88 lines).
- `.planning/phases/999.23-cousin-cat-audit/999.23-smoke-payload.json` — smoke-test payload for the applier dry-run.
- `.planning/phases/999.23-cousin-cat-audit/data/mistag-worklist.json` — 35-entry consolidated worklist with decisions.
- `.planning/phases/999.23-cousin-cat-audit/999.23-VERIFICATION.md` — AC1-AC8 evidence (commit `a1384e8`).
- Per-plan SUMMARYs: `999.23-01-SUMMARY.md`, `999.23-03-SUMMARY.md`, `999.23-04-SUMMARY.md`, this file.

## Files NOT changed (per AC7 / AC8)

Verified via `git diff --stat 18a13ce..HEAD` — 0 files changed under each path:

- `supabase/migrations/` (AC7)
- `pipeline/src/agents/calibrator.ts` (AC8)
- `pipeline/src/lib/category-chain.ts` (AC8)

## Decisions exercised

- **D1 — heuristic seeding (mistag worklist):** plan 02 ran `seed-mistag-worklist.ts` to surface 4 heuristic patterns (90s-music-hits misuse, classic-sitcoms misuse, traditional-pub-games misuse, world-cuisine misuse) plus 7 manual entries from PROGRESS.md → 35 total candidates.
- **D2 — apply mechanism:** all writes via `apply-cousin-changes.ts` (service-role, dry-run-safe, cap-5-aware ordering). No raw SQL run by hand. No new migrations.
- **D3 — batch table format:** each batch presented as a markdown table with current tags / proposed deletes / proposed inserts / reasoning, user-confirmed inline.
- **D4 — prune heuristic:** strict — only delete cousin rows where slug is genuinely off-domain or the chain ancestor is the better representative. Judgment calls on `general-knowledge` removal (kept where it carries useful signal as in space-exploration Qs scored 88+, removed where it was a generic catch-all on niche Qs).
- **D5 — audit log shape:** one JSONL line per DB write with `ts`, `batch_id`, `question_id`, `op`, `slug`, `prev_score`, `new_score`, `reason`, `cousin_reason` (when applicable), `chain_ancestor` flag. Append-only, 88 lines total.
- **D6 — pop-culture additions:** opportunity scan in cap-5 + mistag worklist found no Qs that warranted a `pop-culture` cousin under the strict rule (the V for Vendetta, Batman, Black Mirror Qs were already on the appropriate movies-and-tv chain). Zero `pop-culture` adds this phase.
- **D7 — set_primary moves:** none required. Schema lacks a separate `questions.category_id` primary column — primary identity is inferred from the highest `estimate_score` in `question_categories`. The Aladdin "literature → movies-and-tv" example anticipated in CONTEXT did not appear in the surfaced worklist; if it arises later it is a `delete literature + insert movies-and-tv` pattern, captured by the standard ops.
- **D8 — no pipeline diffs confirmed:** `git diff` against phase-base `18a13ce` returns 0 changed files for `supabase/migrations/`, `calibrator.ts`, and `category-chain.ts`.

## Deferred items

1. **Ouagadougou (`7ab8a974`) score raise** — needs a SQL one-liner; the apply-script does not currently support score updates (only delete/insert/set_primary). Tracked as the single `defer` entry in mistag-worklist.json.
2. **Q dedup pass** — near-duplicate Sputnik Q pairs (`7de67f33` / `f862b7cf`) and other near-dupes from 999.22. Out of scope per SPEC ("Removing or re-classifying near-duplicate Q pairs flagged by 999.22 — defer to a separate dedup quick task").
3. **Bulk cousin sweep** — across all 2848 published Qs. Out of scope per SPEC ("Broad audit of all 2848 published Qs — only the surfaced 19 + ~30 + opportunistic cousins encountered in those batches").
4. **Slug-tree extension** — board-games / electronic-music / 2010s-music / pizza / alternative-medicine / fashion-and-clothing. Some mistag fixes hit the absence of these slugs (e.g. Monopoly resolved to `gaming` rather than a more specific `board-games`). Belongs in a future categories-tree phase, not 999.23.
5. **Automated cousin suggester** — Phase 999.18+ candidate; beyond scope here.

## Commits (full 999.23 history)

```
a1384e8 verify(999.23-05): VERIFICATION.md — 9 PASS / 0 FAIL across AC1-AC8 + sample audit
35c1328 docs(999.23-04): SUMMARY — mistag review (23 fix / 11 keep / 1 defer)
dd37303 phase(999.23): mistag-001 — 23 fix / 11 keep / 1 defer (all 35 decisions set)
db8f102 docs(999.23-03): SUMMARY — cap-5 review complete (19/19, 0 remaining)
aa1891c phase(999.23): cap5-002+003 — 9 Qs reviewed + 9 corrective fixes, 0 cap-5 remaining
5259294 phase(999.23): cap5-001 — 10 Qs cousin pruned, chain ancestors backfilled
b836108 feat(999.23-02): seed mistag worklist (35 entries, 4 heuristics + 7 manual)
65cbbf7 docs(999.23-01): SUMMARY — apply-cousin-changes script + smoke payload
3618622 feat(999.23-01): smoke-test apply-cousin-changes via dry-run + offline-safe dry-run path
be95be2 feat(999.23-01): implement apply-cousin-changes script with delete/insert/set_primary ops
d7e0350 test(999.23-01): add failing tests for apply-cousin-changes script
33374fa docs(999.23): create phase plan — 5 plans, 5 waves (cousin/cat audit)
210d2ab docs(999.23): capture phase context (auto mode)
53ae731 spec(phase-999.23): add SPEC.md for cousin-cat-audit — 5 requirements
```

(Plus the phase-final commit closing this SUMMARY.)

## Next phase

Per ROADMAP §C2: **999.18** (next sequenced library work after 999.23).

## Self-Check

- VERIFICATION.md: present at `.planning/phases/999.23-cousin-cat-audit/999.23-VERIFICATION.md` (committed `a1384e8`).
- All 8 ACs PASS + sample audit PASS = 9/9 PASS, 0 FAIL.
- Audit log line count matches expected (88).
- Decision IDs D1–D8 referenced above.

**Self-Check: PASSED**
