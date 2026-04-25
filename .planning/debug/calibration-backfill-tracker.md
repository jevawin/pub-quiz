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

## Outstanding

- Apply pagination fix to `pipeline/src/scripts/backfill-question-categories.ts` lines 26-29.
- 1848 questions remaining → ~37 more batches.

## Files

- `supabase/migrations/00023_general_knowledge_optional.sql` — added GK category, loosened trigger
- `pipeline/scripts/insert-qc-batch.mjs` — batch insert helper
- `.planning/debug/calibration-backfill-flags.md` — category-mismatch review list
