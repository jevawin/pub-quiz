# Phase 999.22 — Chain Tagging Architecture + Backfill

**Status:** SPEC. Awaiting decisions before PLAN.

**Absorbs:** Phase 999.20 (Recategorise 453 single-cat questions). Setup work from 999.20 preserved as input data.

**Depends on:** Phase 999.21 (Categories cleanup) — COMPLETE 2026-05-09.

## Goal

Adopt chain tagging across the question library. Every published question is tagged at every applicable level of its category chain (root → sub → optional sub-sub), with a per-tier audience score on each row. This unlocks per-cat scoring today (manual) and per-cat observed-score over time (as plays accumulate), and lays the substrate for future niche-pill UX.

## Vision recap

A question lives at multiple tiers of the tree, each with its own audience score:

```
Q: "What was David Bowie's first album?"
Tagged at:
  music              → score 35 (broad music audience: niche fact)
  classical-music    → N/A (not tagged here)
  rock-and-roll-legends → score 50 (rock audience: more recognisable)
  david-bowie        → score 70 (Bowie fans: should know)
```

Player picks `music + hard`: checks `music` row's score (35) → in (hard band 0-33 excludes; medium 34-66 includes).
Player picks `david-bowie + hard`: checks `david-bowie` row's score (70) → out (hard 0-33).

Same question, same scores, different audiences, different filtering.

## Current state

Schema (`question_categories`) already supports per-row scoring. RPC walks parent_id chain so a question tagged only at a sub-cat surfaces under its root pill. **Per-tier scoring is NOT yet a rule** — calibrator emits one row per assigned slug (typically leaf), not per ancestor. RPC's score-filter matches any qc row in the chain walk, not specifically the chosen-pill row.

Inputs to backfill (from 999.20 setup):
- `dump-single-cat-for-manual-recat.ts` — fetch script
- `single-cat.json` — 453 single-cat Qs + tree

Tree state after 999.21:
- 163 cats, 13 roots + 3 new roots (`politics`, `religion-and-mythology`, `language-and-words`)
- Mostly 2-level (root → sub). Some 3-level: `cocktails` → `wine-and-spirits` → `food-and-drink`; `quidditch-rules` → `harry-potter` → `literature`; `the-roman-empire` → `ancient-rome` → `history`; etc.
- Max chain depth: 3 ancestors per leaf (root + sub + sub-sub).

## Scope

### In scope

1. **Calibrator change (pipeline):** when scoring a Q assigned to slug X, emit one qc row per ancestor of X (X itself, parent of X, grandparent of X up to root). Each row gets its own audience-appropriate score.
2. **RPC change:** when player picks pill P, score-filter uses the qc row whose `category_id` exactly matches P (not any descendant). Fallback to descendant rows for legacy Qs not yet chain-tagged.
3. **Backfill:** all ~3056 published Qs upgraded to chain rows. Existing rows stay; new ancestor rows added with proposed scores. Trigger 4-cap may need bump if a Q has multiple chains (e.g. cousin tagging) — see open questions.
4. **Tests:** calibrator chain emission, RPC chosen-pill score selection, backfill idempotency.

### Out of scope

- UI changes (sub-pill drilldown, niche-pill picker) — deferred to Phase 999.18.
- `questions_staging` table — backfill published only; staging gets chain rows on publish via the new calibrator.
- Aggregator rewrite (per-audience observed scoring from `question_plays`) — separate phase, defer until enough play volume.
- Auto-cousin tagging — backfill only adds chain rows for the existing tagged sub-cats. Cousin rows added by manual review where genuinely warranted.

## Code changes

### Calibrator (pipeline/src/agents/calibrator.ts)

Today: takes `assigned_slugs`, for each slug calls Claude to score, upserts one qc row per slug, plus mandatory GK row if not opted out.

Change: for each assigned slug, walk up the parent chain to root (collect [slug, parent, grandparent, ..., root]). Score each tier as a separate Claude turn (or in a single-prompt batch returning a scores object keyed by slug). Upsert one qc row per ancestor.

Considerations:
- Cap rule: trigger throws if total qc rows for a Q exceed 4. Chain of 3 + GK + 0 cousins = 4 (at cap). Chain of 3 + 1 cousin chain root = 5 (over cap). Need cap decision.
- GK rule: still optional per `00023_general_knowledge_optional.sql`. Calibrator should NOT auto-add GK; only when assigned.
- Re-runs: idempotent. Use `INSERT ... ON CONFLICT DO UPDATE SET estimate_score = EXCLUDED.estimate_score` so re-running re-scores without dups.

### RPC (random_published_questions_excluding + counts_by_root_category + count_available_questions)

Today: matches questions where ANY qc row in the chain walk passes the score filter. Score "leaks" up — a Q with leaf score 80 surfaces under root pill at "easy" even if root-tier audience would call it hard.

Change: if `p_category_slug` is non-null and not 'general', score-filter uses the qc row whose `category_id` matches the cat with `slug = p_category_slug`. Walk-up still finds the question (so legacy sub-only Qs still surface), but the score check uses the chosen pill's row when present, falling back to any matching descendant row only if the chosen pill has no row.

SQL sketch:

```sql
WITH chosen_cat AS (
  SELECT id FROM categories WHERE slug = p_category_slug
),
effective AS (
  SELECT qc.question_id,
         qc.category_id,
         CASE WHEN qc.observed_n >= 30 THEN qc.observed_score ELSE qc.estimate_score END AS score,
         (qc.category_id = (SELECT id FROM chosen_cat)) AS is_chosen
  FROM question_categories qc
),
-- Pick chosen-pill row when present, else fall back to any tree row.
preferred AS (
  SELECT DISTINCT ON (question_id)
         question_id, category_id, score
  FROM effective e
  WHERE e.category_id IN (SELECT id FROM cat_tree)
  ORDER BY question_id, is_chosen DESC, category_id  -- chosen first, deterministic tiebreak
)
SELECT ... FROM questions q JOIN preferred p ... WHERE p.score BETWEEN p_score_min AND p_score_max;
```

### Trigger (4-cap)

Decision needed. Options:
- **Keep 4-cap.** Chain max 3 + GK = 4. No cousin tagging on chain-tagged Qs (cousin = root only, displaces chain depth).
- **Bump to 5 or 6.** Chain (3) + GK (1) + 1 cousin chain (root only = 1 or full chain = 2-3). 6 covers chain + full cousin chain.

Tradeoff: bigger cap = more rows per Q = bigger backfill output, more table size, more aggregator complexity later. Smaller cap = simpler but no cousin headroom.

## Backfill strategy

~3056 published Qs need chain rows. Two modes:

### Mode A: API-backed (Sonnet)

Use existing calibrator (post-change) as a backfill driver. Iterate published Qs missing chain rows. For each, identify existing tagged slugs, walk up to root, score each ancestor tier, upsert qc rows.

- Cost: ~3056 Qs × ~3 rows × 1 calibrator call ≈ ~$10-20 in Sonnet usage (calibrator already estimates ~$0.50-$1.50 per 453 Qs in the 999.20 script header).
- Time: ~6-12 hours of GH Action runtime, batched.
- Quality: Sonnet's per-tier reasoning probably better than mine in chat; consistent.
- Infra: pipeline already supports rate-limited batched runs (e.g. `pipeline/src/scripts/refresh-observed-scores.ts` pattern).

### Mode B: Manual (no API)

Subscription chat work. Batches of ~50 Qs per turn, propose chain rows + scores, apply via service role.

- Cost: $0 in API.
- Time: ~60-120 hours of dense chat.
- Quality: variable per-turn; risk of fatigue drift.
- Infra: scripts from 999.20 reusable.

**Recommendation: Mode A.** Cost trivial vs time saved. Quality higher. Backfill becomes a one-shot job, not a months-long manual chore. Reserve manual review for spot-checks + cousin tagging on flagged Qs.

## Open questions / decisions to lock before PLAN

1. **Trigger cap: 4 or bump to 5/6?**
2. **Backfill mode: A (API) or B (manual)?**
3. **Cousin tagging: skip in backfill, or include where obvious?** Recommend skip in backfill — add manually post-hoc if surface needed.
4. **GK row policy:** keep optional (current); only add when calibrator deems pub-table-knowable. Confirm.
5. **Re-score existing chain rows on backfill?** Or only insert missing? Recommend: only insert missing (preserve any manual override scores). Use `ON CONFLICT DO NOTHING`.
6. **Backfill scope: published only, or also `questions_staging`?** Recommend: published only.
7. **RPC fallback behaviour for legacy Qs:** if chosen-pill row missing, fall back to any descendant row (current behaviour preserved). Confirm.
8. **Scoring rubric:** does calibrator need a rule update for tier-specific scoring? e.g. "score for `gaming` audience: how would a casual gaming-pill picker fare?" vs "score for `dota-2` audience: how would a Dota player fare?". Probably a system prompt tweak.

## Pitfalls

- **Tree depth inconsistency.** Some chains are 1-deep (`general-knowledge` root only), some 3-deep (`cocktails` → `wine-and-spirits` → `food-and-drink`). Calibrator must handle variable depth.
- **Score interpretation drift.** Across 3056 Qs and 3 tiers each, Sonnet may drift in what "score 50 for `music` audience" means. Mitigate: clear rubric in prompt with anchor examples.
- **Conflict with existing scores.** Pre-existing qc rows have estimate_scores from prior calibration. New ancestor rows added by backfill may have inconsistent scores vs the existing row. Decide: preserve existing or re-calibrate the whole chain.
- **4-cap collisions.** Edge cases: a Q tagged at multiple unrelated leaves (e.g. movie-and-game crossover). Cap may force prioritisation.
- **RPC test surface.** Three RPCs touched. Each has tests; need to add chosen-pill scenarios.
- **Backfill failures partway.** If GH Action job dies mid-batch, resume must be idempotent. Use a checkpoint table or query pattern that skips already-chained Qs.

## Effort estimate

| Item | Effort |
|------|--------|
| Calibrator change + tests | 2-3h |
| RPC change + tests (3 RPCs) | 3-4h |
| Trigger update (if bumping cap) | 30 min |
| Backfill driver script | 1-2h |
| Backfill execution (Mode A) | 6-12h GH Action runtime; ~$15 |
| Backfill execution (Mode B) | 60-120h chat |
| Verification queries + spot-check | 2h |
| **Total (Mode A)** | **~10-15h dev + $15** |
| **Total (Mode B)** | **~70-130h dev** |

## Plan order (waves)

Once PLAN written:

1. **Wave 0:** test scaffolding for calibrator + RPC chosen-pill cases (red).
2. **Wave 1:** calibrator change (chain emission). Tests green.
3. **Wave 2:** RPC change (chosen-pill score). Tests green.
4. **Wave 3:** Trigger cap update (if decided). Migration.
5. **Wave 4:** Backfill driver + dry-run on 100 sample Qs. Verify chain rows + scores look right.
6. **Wave 5:** Full backfill. GH Action runs over hours. Monitor cost.
7. **Wave 6:** Verification — spot-check 50 random Qs across tiers. Re-dump tree + Q-cat counts.

## Inputs preserved from 999.20

- `pipeline/src/scripts/dump-single-cat-for-manual-recat.ts` — useful as a "fetch all single-cat Qs" pattern.
- `.planning/phases/999.20-recategorise-single-cat-questions/data/single-cat.json` — 453 single-cat Qs with their existing slug + root_path. Subset of full backfill input.
