# Phase 999.22 — Chain Tagging Architecture + Backfill

**Status:** COMPLETE 2026-05-09.

**Absorbs:** Phase 999.20.

## What shipped

### Code

- **Chain expansion** (`pipeline/src/lib/category-chain.ts`): pure fn `expandSlugsToChain(parentMap, leafSlugs) → string[]`. Walks parent_id chain to root, dedupes. 7 unit tests.
- **Chain calibrator** (`pipeline/src/agents/calibrator.ts`): new `calibrateQuestionWithChain` function. Walks chain via expansion fn, requests per-tier scores from Sonnet with anchor examples, conditionally emits GK row (threshold = 20), upserts insert-only (`ignoreDuplicates`). 5 unit tests.
- **GK_THRESHOLD constant** = 20: GK row only inserted by new calibrator path when score >= threshold.
- Existing `calibrateQuestion` + tests untouched (used by current pipeline path; can migrate piecemeal).

### Migrations

- `00032_rpcs_chosen_pill_score.sql`: rewrites 4 RPCs to use chosen-pill row's score with descendant fallback.
- `00033_fix_count_available_questions_chosen_pill.sql`: fixes 00032's orphan single-TEXT signature, recreates multi-slug TEXT[] shape with chosen-pill logic.
- `00034_trigger_cap_bump_5.sql`: bumps `enforce_question_categories_rules` row cap from 4 to 5 (chain + GK + cousin headroom).

### Backfill

- **Worklist generator** (`pipeline/src/scripts/build-chain-backfill-worklist.ts`): scans published Qs, identifies missing chain ancestor rows per Q, slices into batches of ~100. No API calls.
- **Apply script** (`pipeline/src/scripts/apply-chain-rows.ts`): stdin JSON of `[{question_id, slug, estimate_score}, ...]` → resolves slugs to ids → upserts with `ignoreDuplicates`. Idempotent.
- **Sample audit** (`pipeline/src/scripts/sample-chain-rows.ts`): dumps qc rows for 10 random Qs for visual inspection.
- **Smoke test** (`pipeline/src/scripts/smoke-test-rpcs.ts`): hits all 4 changed RPCs, confirms returns.

### Subagent dispatch

- **RUNBOOK** (`BACKFILL-RUNBOOK.md`): subagent prompt template + scoring rubric + workflow.
- **PROGRESS** (`PROGRESS.md`): per-batch checklist, fully populated.
- 16 subagents dispatched (1 dry-run + 15 backfill batches), 3 in parallel per wave.

## Tally

| Metric | Value |
|--------|-------|
| Total published Qs | 2848 |
| Qs in initial worklist (missing chain rows) | 1559 |
| Qs successfully chain-tagged | 1540 |
| Qs remaining | 19 (all cap-5 collisions, deferred to 999.23) |
| Total ancestor rows added | ~1620 |
| Subagent runs | 16 (1 dry-run + 15 batches) |
| Cap-5 skips across all batches | 13 |
| Mis-tag candidates flagged for 999.23 | ~30 |

## Sample audit results

10 random Qs inspected:
- "Largest country?" → Russia: world-capitals_n/a, european-geography 75, geography 90, GK 90 (well-known)
- "Mantis shrimp punch heats?" → marine-life 60, nature-and-animals 40, GK 12 (niche fact)
- "Capital of Finland?" → world-capitals 88, european-geography 80, geography 75, GK 80
- "Watergate year?" → us-presidents 70, history 65, GK 60 (well-known)
- "Justice 2016 album?" → classic-rock 30, music 25 (very niche, GK correctly absent)

Per-tier scoring patterns hold: broader pills score lower than niche pills; well-known facts score consistently high across tiers; obscure facts collapse to low at all levels.

## Cap-5 collisions (deferred to 999.23)

19 Qs already at 4-5 existing tags + need 1-4 chain ancestor rows = exceeds cap-5. Subagents skipped these intentionally. List preserved in `data/batches/batch-001.json` (post-rebuild).

These all have over-tagged existing categories (e.g. V for Vendetta tagged at action-heroes + classic-hollywood + british-history + GK = 4). 999.23 cousin/cat audit will prune cousins first, then re-run chain backfill on the 19.

## Subagent flagged Q quality issues for 999.23

Patterns surfaced across batches:
- Wide mis-application of `90s-music-hits` to non-90s electronic music (Aphex Twin, Madeon, AlunaGeorge etc).
- `classic-sitcoms` used as generic TV bucket (Black Mirror, Rick and Morty, M*A*S*H, Inspector Morse).
- Several Qs mis-tagged at `world-cuisine` (Panama hats, Shiatsu, Spanish "donkey").
- `traditional-pub-games` applied to bowling Turkey (closer to sports), Monopoly, etc.
- A few near-duplicate Q pairs (Spirited Away, Frank West, Henry VIII Catherine).

Full list in `PROGRESS.md` under "Subagent observations to feed 999.23".

## Decisions evidence (locked at start)

1. **Cap = 5** — 13 collisions surfaced + handled cleanly via subagent skip.
2. **Subagent backfill** (no API spend) — all 16 batches ran on Opus subagents; zero API cost.
3. **Skip cousins in backfill** — confirmed; subagents only added chain ancestors as instructed.
4. **GK optional, threshold 20** — implemented in `calibrateQuestionWithChain` for new pipeline output. Backfill preserved existing GK rows (some pre-existing rows have score <20 but stayed untouched — insert-only).
5. **Insert-only** — no existing scores overwritten across 1620 row inserts.
6. **Published only** — staging untouched; new pipeline emits chain rows on promote.
7. **RPC fallback** — verified via smoke test on all 4 RPCs (return non-empty).
8. **Rubric tweak** — anchor examples baked into both `CHAIN_SYSTEM_PROMPT` (for live calibrator) and subagent prompts (for backfill).

## Next: Phase 999.23 — Cousin / category audit

Manual conversational pass to:
- Move Qs to better primary cat (Aladdin → movies, not literature).
- Add cousin tags where genuinely warranted (Marvel, Disney → `pop-culture`).
- Reject false cousins.
- Resolve the 19 cap-5 collision Qs (prune existing cousins to make room for chain).
- Address mis-tag candidates flagged by backfill subagents.
