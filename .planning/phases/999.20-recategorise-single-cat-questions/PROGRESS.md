# Phase 999.20 — Recategorise Progress

Source: `data/single-cat.json` (dumped 2026-05-04)

**Total:** 453 questions, 139 categories
**Batch size:** 50
**Total batches:** 10 (9×50 + 1×3)

## Strategy (forward-compat row layout)

For each Q, write rows for:
1. **Parent root** — score for broader pill audience. Always.
2. **`general-knowledge`** — only if pub-table audience genuinely has a knowledge shot (strict: "average person might have a chance of knowing"). 1-in-4 random guess does NOT qualify.
3. **0-2 cousin sub-categories** — where the Q fits a different audience subtree.

Cap: 4 rows max (D-15 trigger enforces).

## Distribution by root

| Root | Count |
|------|-------|
| gaming | 175 |
| movies-and-tv | 109 |
| geography | 37 |
| history | 32 |
| literature | 25 |
| music | 18 |
| science | 16 |
| sports | 15 |
| food-and-drink | 9 |
| art-and-design | 6 |
| technology | 6 |
| nature-and-animals | 4 |
| general-knowledge | 1 |

## Batch log

| Batch | Range | Status | Inserts | Commit |
|-------|-------|--------|---------|--------|
| 1 | 1–50 | pending | — | — |
| 2 | 51–100 | pending | — | — |
| 3 | 101–150 | pending | — | — |
| 4 | 151–200 | pending | — | — |
| 5 | 201–250 | pending | — | — |
| 6 | 251–300 | pending | — | — |
| 7 | 301–350 | pending | — | — |
| 8 | 351–400 | pending | — | — |
| 9 | 401–450 | pending | — | — |
| 10 | 451–453 | pending | — | — |

## Notes

- Sort order: by `root_slug` then `existing_slug` (so each batch is topically clustered).
- Batch 1 supersedes the prior strict-rule batch 1 (re-drafted under forward-compat).
- Apply mode: inline service-role insert per Q on user confirmation.
