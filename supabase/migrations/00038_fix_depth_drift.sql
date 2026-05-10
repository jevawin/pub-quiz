-- 260510-dpd: Backfill depth=1 on all child categories with stored depth=0.
--
-- Audit on 2026-05-10 found 31 cats with parent_id IS NOT NULL but depth=0
-- (should be 1). Pre-existing drift on 27 cats (chemistry, mathematics, poetry,
-- the-1970s, the-1990s, winter-sports, etc.) plus 4 from migration 00037
-- (board-games, electronic-music, 2010s-music, pizza — depth not set on INSERT).
--
-- This is a one-shot backfill. Future drift prevention is tracked in 260510-dtg
-- (BEFORE INSERT/UPDATE trigger to auto-compute depth from parent chain).
--
-- The current cat tree is 2-tier (depth 0 = root, depth 1 = leaf). 8 rows live
-- at depth=2 already and are excluded from this UPDATE (the WHERE clause only
-- targets depth=0 children).

UPDATE categories
SET depth = 1
WHERE parent_id IS NOT NULL
  AND depth = 0;

-- Post-state expectation: 0 rows where parent_id IS NOT NULL AND depth=0.
