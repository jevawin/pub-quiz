# Calibration Backfill Tracker

Started 2026-04-24. Total published questions needing `question_categories` rows: 2848.

Approach: Claude Code (subscription, Opus 1M) scores each question inline — audience-specific estimates per category. GK applied selectively (not mandatory) per migration 00023. Max 4 rows per question, 1 minimum.

## Session 1 progress

| Batch | Questions | Rows | Cumulative done | Notes |
|-------|-----------|------|-----------------|-------|
| 1     | 50        | 115  | 50              | setup + migration 00023 |
| 2     | 50        | 108  | 100             | heavy gaming batch |
| 3     | 50        | 112  | 150             | science/football heavy |
| 4     | 50        | 117  | 200             | music-heavy |
| 5     | 50        | 108  | 250             | sitcoms/animated |
| 6     | 50        | 101  | 300             | mixed |
| 7     | 50        | 114  | 350             | literature-heavy |
| 8     | 50        | 103  | 400             | film-heavy |
| 9     | 50        | 88   | 450             | film/gaming |
| 10    | 50        | 90   | 500             | film/marvel |

Session 1 done: 500/2848 questions, 1056 rows. Remaining: 2348.

Note on paginated DB queries: Supabase `select` default limit is 1000 rows. `backfill-question-categories.ts` in `pipeline/src/scripts/` uses the same pattern and will miss "done" questions once the qc table exceeds 1000 rows. Fix before next session — paginate the existing-ids fetch.

## Session 2 progress

| Batch | Questions | Rows | Cumulative done | Notes |
|-------|-----------|------|-----------------|-------|
| 11    | 50        | 94   | 550             | new paginated `fetch-qc-batch.mjs` |
| 12    | 50        | 108  | 600             | music-heavy |
| 13    | 50        | 108  | 650             | rock/pop heavy |
| 14    | 50        | 109  | 700             | mixed music + Greek myth |
| 15    | 50        | 111  | 750             | rock + sitcoms |
| 16    | 50        | 98   | 800             | sitcoms + sci-fi |
| 17    | 50        | 99   | 850             | board games + science |
| 18    | 50        | 116  | 900             | science/anatomy heavy |
| 19    | 50        | 113  | 950             | science + gaming |
| 20    | 50        | 104  | 1000            | mixed |

Session 2 done: 500 questions, 1060 rows. Cumulative 1000/2848 (35.1%), 2116 rows.

New helper: `pipeline/scripts/fetch-qc-batch.mjs` — paginated done-id fetch, handles >1000 qc rows.

## Session 3 progress

| Batch | Questions | Rows | Cumulative done | Notes |
|-------|-----------|------|-----------------|-------|
| 21    | 50        | 115  | 1050            | sci/sports |
| 22    | 50        | 117  | 1100            | tech/space |
| 23    | 50        | 96   | 1150            | computing-heavy |
| 24    | 50        | 106  | 1200            | computing/games |
| 25    | 50        | 101  | 1250            | math/Pokemon/games |

Session 3 done so far: 250 questions, 535 rows. Cumulative 1250/2848 (43.9%), 2651 rows.

Also fixed second pagination bug in `fetch-qc-batch.mjs`: was using `.limit(done.size + 200)` which capped fetch below total published once done-set was large. Now paginates ALL published.

## Session 3 continued

| Batch | Questions | Rows | Cumulative done | Notes |
|-------|-----------|------|-----------------|-------|
| 26    | 50        | 119  | 1300            | mixed/world geography |
| 27    | 50        | 126  | 1350            | trivia variety |
| 28    | 50        | 139  | 1400            | literature-heavy |
| 29    | 50        | 120  | 1450            | re-fetched after dup bug; mixed |
| 30    | 50        | 128  | 1500            | mixed |

**Third pagination bug fixed:** `select` without `.order()` returns rows in non-deterministic order. With ranges + no order, .range(0,999) and .range(1000,1999) can overlap or miss rows entirely. Added `.order('question_id')` to done-id fetch and `.order('id')` to questions fetch. This was masking real progress count earlier sessions — we were actually further along than counted.

Session 3 done: 500 questions, 1167 rows. Cumulative 1500/2848 (52.7%), 3283 rows. **Halfway.**

## Session 3 continued (batches 31-35)

| Batch | Questions | Rows | Cumulative done | Notes |
|-------|-----------|------|-----------------|-------|
| 31    | 50        | 126  | 1550            | mixed history/animation |
| 32    | 50        | 136  | 1600            | art/geography heavy |
| 33    | 50        | 119  | 1650            | mixed |
| 34    | 50        | 128  | 1700            | superheroes + history |
| 35    | 50        | 133  | 1750            | mixed/literature |

Cumulative: 1750/2848 (61.4%), 3925 rows. 1098 remaining.

## Session 3 continued (batches 36-40)

| Batch | Questions | Rows | Cumulative done | Notes |
|-------|-----------|------|-----------------|-------|
| 36    | 50        | 118  | 1800            | history/landmarks |
| 37    | 50        | 127  | 1850            | WW2/sports |
| 38    | 50        | 138  | 1900            | sports/cuisine |
| 39    | 50        | 123  | 1950            | mixed |
| 40    | 50        | 128  | 2000            | history/landmarks |

Cumulative: **2000/2848 (70.2%)**, 4559 rows. 848 remaining (~17 batches).

## Session 3 continued (batches 41-45)

| Batch | Questions | Rows | Cumulative done | Notes |
|-------|-----------|------|-----------------|-------|
| 41    | 50        | 134  | 2050            | mixed history |
| 42    | 50        | 134  | 2100            | art/sports |
| 43    | 50        | 134  | 2150            | mixed |
| 44    | 50        | 136  | 2200            | history/cuisine |
| 45    | 50        | 127  | 2250            | mixed |

Cumulative: **2250/2848 (79.0%)**, 5224 rows. 598 remaining (~12 batches).

## Outstanding

- Apply pagination fix (paginate + order) to `pipeline/src/scripts/backfill-question-categories.ts` lines 26-29.
- 598 questions remaining.

## Files

- `supabase/migrations/00023_general_knowledge_optional.sql` — added GK category, loosened trigger
- `pipeline/scripts/insert-qc-batch.mjs` — batch insert helper
- `.planning/debug/calibration-backfill-flags.md` — category-mismatch review list
