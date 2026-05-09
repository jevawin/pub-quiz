# Phase 999.22 Backfill Progress

**Initial worklist:** 1559 Qs / 1663 ancestor rows / 16 batches.
**After dry-run batch 1 (99 Qs done):** 1460 Qs / 1563 rows / 15 batches (re-numbered).

| Original Batch | Status | Qs Processed | Rows Inserted | Skipped | Commit |
|----------------|--------|--------------|---------------|---------|--------|
| 001 (initial) | ✓ done | 99 | 100 | 1 (cap-5) | 4abfe6e |

**Remaining (post-rebuild, new batch numbering):**

| Batch | Status | Qs Processed | Rows Inserted | Skipped | Commit |
|-------|--------|--------------|---------------|---------|--------|
| 001 | ✓ done | 100 | 101 | 1 (cap-5: 6a535027 history) | (this batch commit) |
| 002 | ✓ done | 100 | 106 | 3 (cap-5) | (this batch commit) |
| 003 | ✓ done | 100 | 103 | 0 | (this batch commit) |
| 004 | ✓ done | 98 | 100 | 2 (cap-5) | (this batch) |
| 005 | ✓ done | 99 | 106 | 1 (cap-5) | (this batch) |
| 006 | ✓ done | 100 | 104 | 0 | (this batch) |
| 007 | ✓ done | 100 | 100 | 0 | (this batch) |
| 008 | ✓ done | 98 | 112 | 2 (cap-5) | (this batch) |
| 009 | ✓ done | 99 | 104 | 1 (cap-5) | (this batch) |
| 010 | ✓ done | 99 | 120 | 1 (cap-5) | (this batch) |
| 011 | ✓ done | 99 | 106 | 1 (cap-5) | (this batch) |
| 012 | ✓ done | 100 | 106 | 0 | (this batch) |
| 013 | pending | — | — | — | — |
| 014 | pending | — | — | — | — |
| 015 | pending | — | — | — | — |

## Notes

- Subagent template + workflow in `BACKFILL-RUNBOOK.md`.
- Apply script: `pipeline/src/scripts/apply-chain-rows.ts` (stdin JSON, upsert ignoreDuplicates).
- Resume safe: re-read this file, skip checked batches.
- Rebuilt after initial dry-run since worklist contracts as Qs complete.
- Apply script idempotent — re-running on already-done Qs = no-op (DO NOTHING on conflict).

## Cap-5 collisions (skipped, defer to 999.23)

Some Qs already at 4 existing tags + need 2+ ancestor rows = exceeds cap. Subagent skips
and flags. Initial batch 1 example: `6a535027` (V for Vendetta) already had `action-heroes`,
`classic-hollywood`, `british-history`, `general-knowledge`. Adding `movies-and-tv` +
`history` ancestors would hit 6. Skipped both. 999.23 cousin/cat audit will prune
cousins to make room.

## Subagent observations to feed 999.23

Initial batch 1 flagged several mis-tags worth investigating:
- `df69b35a` AlunaGeorge — tagged `90s-music-hits` but is 2010s
- `ea75c41d` `8257670d` `a685aa9c` `82fbbb7d` — all `90s-music-hits` but cover Aphex
  Twin / Monstercat / Madeon / Sukiyaki — wrong cat
- `7ab8a974` Ouagadougou — existing `world-capitals` score 45 may be too low for
  capitals-pill audience
- `3ab0252a` bowling Turkey — `gaming` parent feels weak (bowling closer to sports)
