# 999.20 — Discussion Note (2026-05-04)

**Status: PAUSED pending one more discussion pass.**

We started executing 999.20 (recat 453 single-cat Qs: leaf + parent root + cousins, GK selectively). After dumping data + drafting batch 1 + reviewing edge cases (mis-cat, dup, wrong-answer flags), we surfaced a bigger architectural question and decided to pivot.

## What we agreed (sketch — needs another pass)

1. **999.20 in current form is the wrong shape.** Adding parent root + cousin rows doesn't deliver the per-level scoring vision. Stop the inline run.

2. **Vision: chain tagging.** Every Q tagged at every applicable level of its tree chain (root → sub → optional sub-sub). Each row scored for that tier's audience. Enables:
   - Per-cat scoring (manual now, observed-over-time later).
   - Future niche pills (e.g. `literature → harry-potter → quidditch-rules` model already exists in tree).
   - Difficulty-band filtering matches the pill the player chose, not the leaf.

3. **Tree depth — 2 levels mostly fine.** Don't mass-deepen. Keep some niche leafs (e.g. `david-bowie`) as-is or prune. Add deeper levels only where genuinely useful.

4. **Plumbing largely exists today.**
   - Schema (`question_categories`) supports per-row scoring.
   - RPC walks parent chain — already enables sub-cat-tagged Qs to surface under root pill.
   - Trigger 4-cap probably stays (chain max ~3 + cousin = 4).
   - Sub-pill UI drilldown deferred to Phase 999.18.

5. **Modest code changes needed:**
   - Calibrator: emit row per ancestor in chain (not just leaf). ~2h.
   - RPC: when player picks a pill, score-band-check the row matching the chosen pill level (not the leaf). ~1h.
   - Tests for both.

6. **Backfill is the big lift.** All ~2848 published Qs need chain rows, not just the 453.
   - Manual no-API: months.
   - API-backed (Sonnet ~$15, ~1 day): recommended.

7. **Categories tree needs cleanup before chain pass.** Identified during dump:
   - 5 suspected dup pairs: `the-1960s`/`the-sixties`, `formula-one`/`formula-one-racing`, `classic-western-films`/`classic-westerns`, `italian-cuisine`/`italian-food`, `mexican-cuisine`/`mexican-food`.
   - Some leafs may be too niche (e.g. `david-bowie`).
   - A few obvious gaps to fill.
   - Best done as a back-and-forth session.

## Proposed phase pivot (NOT YET CONFIRMED)

- **999.21 — Categories cleanup.** Back-and-forth session. Merge dupes, prune over-niche, add gaps. Output: clean ~130-cat tree.
- **999.22 — Chain tagging architecture + backfill.** SPEC chain rule, calibrator + RPC updates, backfill all ~2848 Qs (likely API-backed).
- **999.20 retired.** Absorbed into 999.22. Setup work preserved as input data.

## What's preserved from this session

- `pipeline/src/scripts/dump-single-cat-for-manual-recat.ts` — fetch-only dump (no API).
- `data/single-cat.json` — 453 Qs + 139 cats with parent chain + root_path.
- `PROGRESS.md` — batch tracker (batch 1 drafted in chat, NOT applied).
- Edge-case findings: #11 + #15 mis-cat, #17 likely wrong answer, #23/24 dup. Flag candidates for 999.16.

## Open questions for next pass

- Confirm 999.20 retire vs absorb-and-rename.
- Lock taxonomy cleanup scope before chain backfill (so backfill doesn't waste rows on dupe cats).
- Backfill mode: API-backed (Sonnet) vs subscription-only manual. Cost vs time.
- Cousin tagging under chain rule: still wanted? How to handle within 4-cap.
- Trigger 4-cap: keep or bump (5-6) for chain + cousin headroom.
- RPC change scope: which RPCs touched? Test coverage.
- Difficulty-band UX when a Q is too niche for a chosen broad pill (e.g. "easy" filter on `gaming` excludes Dota Q whose `gaming`-row score is hard).
- Category cleanup output format: migration file? Manual SQL?

## Next session

1. Re-read this note + ROADMAP §C2.
2. Re-discuss the pivot (any objections, any missed angles).
3. Confirm phase order: 999.21 cleanup → 999.22 chain + backfill.
4. Spec each properly via `/gsd-discuss-phase` or similar.
