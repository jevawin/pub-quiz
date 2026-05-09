# Phase 999.22 Backfill Progress

**Total:** 1559 Qs across 16 batches. ~1663 ancestor rows to add.

| Batch | Status | Qs Processed | Rows Inserted | Skipped | Commit |
|-------|--------|--------------|---------------|---------|--------|
| 001 | ✓ done | 99 | 100 | 1 (cap-5) | (in this commit) |
| 002 | pending | — | — | — | — |
| 003 | pending | — | — | — | — |
| 004 | pending | — | — | — | — |
| 005 | pending | — | — | — | — |
| 006 | pending | — | — | — | — |
| 007 | pending | — | — | — | — |
| 008 | pending | — | — | — | — |
| 009 | pending | — | — | — | — |
| 010 | pending | — | — | — | — |
| 011 | pending | — | — | — | — |
| 012 | pending | — | — | — | — |
| 013 | pending | — | — | — | — |
| 014 | pending | — | — | — | — |
| 015 | pending | — | — | — | — |
| 016 | pending | — | — | — | — |

## Notes

- Subagent template + workflow in `BACKFILL-RUNBOOK.md`.
- Apply script: `pipeline/src/scripts/apply-chain-rows.ts` (stdin JSON, upsert ignoreDuplicates).
- Resume safe: re-read this file, skip checked batches.

## Cap-5 collisions (skipped, defer to 999.23)

Some Qs already at 4 existing tags + need 2+ ancestor rows = exceeds cap. Subagent skips
and flags. Batch 1 example: `6a535027` (V for Vendetta) already had `action-heroes`,
`classic-hollywood`, `british-history`, `general-knowledge`. Adding `movies-and-tv` +
`history` ancestors would hit 6. Skipped both. 999.23 cousin/cat audit will prune
cousins to make room.

## Subagent observations to feed 999.23

Batch 1 flagged several mis-tags worth investigating:
- `df69b35a` AlunaGeorge — tagged `90s-music-hits` but is 2010s
- `ea75c41d` `8257670d` `a685aa9c` `82fbbb7d` — all `90s-music-hits` but cover Aphex
  Twin / Monstercat / Madeon / Sukiyaki — wrong cat
- `7ab8a974` Ouagadougou — existing `world-capitals` score 45 may be too low for
  capitals-pill audience (audit re-score in 999.23 or future observed)
- `3ab0252a` bowling Turkey — `gaming` parent feels weak (bowling closer to sports)
