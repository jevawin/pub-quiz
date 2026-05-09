# Phase 999.21 — Categories Cleanup

**Status:** COMPLETE 2026-05-09. Migration `00030_categories_cleanup.sql` applied to remote.

## Outcome

- Tree: 139 → **163 cats** (6 dropped, 30 added).
- Q reassignments via `INSERT ... ON CONFLICT DO NOTHING` + `DELETE` from drop cats. Lots of pre-existing dups (Qs tagged at both pair members) were cleaned up as a side effect.

## Dup pair merges

| Drop | Keep | Note |
|------|------|------|
| `the-sixties` (5 Qs) | `the-1960s` | Naming consistency w/ `the-1980s` |
| `formula-one` (22 Qs) | `formula-one-racing` | User pick |
| `classic-westerns` (12 Qs) | `classic-western-films` | User pick |
| `italian-food` (14 Qs) | `italian-cuisine` | Convention: `-cuisine` |
| `mexican-food` (10 Qs) | `mexican-cuisine` | Convention: `-cuisine` |
| `international-cuisine` (28 Qs) | `world-cuisine` | Semantic dup; `world-cuisine` already parent of `mexican-cuisine` |

## Re-parent

- `mexican-cuisine` flattened from `world-cuisine` → `food-and-drink` (consistent w/ `french-cuisine`/`indian-cuisine`/`italian-cuisine`/`mediterranean-cuisine` siblings).

## New categories (30)

**3 new ROOTs:** `politics`, `religion-and-mythology`, `language-and-words`.

**Tier 1 sub-cats (6):** `classical-music` (music), `mathematics` (science), `golf` (sports), `boxing` (sports), `the-1970s` (history), `the-1990s` (history).

**Tier 2 sub-cats (10):** `eurovision` (music), `soundtracks-and-film-music` (music), `north-american-geography` (geography), `oceans-and-seas` (geography), `british-cuisine` (food-and-drink), `cocktails` (wine-and-spirits, 3-level), `poetry` (literature), `card-games` (gaming), `winter-sports` (sports), `athletics` (sports).

**Tier 3 sub-cats (11):** `chemistry`, `physics` (science), `mobile-tech`, `ai-and-machine-learning` (technology), `british-sitcoms`, `reality-tv` (movies-and-tv), `plants-and-trees`, `insects` (nature-and-animals), `industrial-revolution`, `ancient-greece-history` (history), `rivers-and-mountains` (geography).

All new cats start empty. Populated during 999.22 chain backfill, only when Qs genuinely fit.

## Reassignment evidence

| Cat | Pre-cleanup | Post-cleanup | Net new (rest were dups) |
|-----|-------------|--------------|--------------------------|
| `formula-one-racing` | 23 | 24 | 1 (21 were dups) |
| `italian-cuisine` | 17 | 17 | 0 (all 14 were dups) |
| `mexican-cuisine` | 10 | 11 | 1 (9 were dups) |
| `world-cuisine` | 11 | 36 | 25 (3 were dups) |
| `the-1960s` | 5 | 10 | 5 (no overlap) |
| `classic-western-films` | 6 | 14 | 8 (4 were dups) |

## Helper scripts (preserved)

- `pipeline/src/scripts/dump-cat-tree-with-counts.ts` — tree + Q counts per cat
- `pipeline/src/scripts/table-sizes.ts` — row counts per table
- `data/cat-tree-with-counts.json` — post-cleanup tree snapshot

## Next: Phase 999.22 — Chain tagging architecture + backfill

With clean tree in place, ready to spec 999.22:
- Calibrator emits row per ancestor in chain (~2h)
- RPC: difficulty band uses chosen-pill row, not leaf (~1h)
- Backfill all ~3056 published Qs with chain rows + per-tier scores
- Backfill mode TBD (API-backed Sonnet recommended; manual = months)
