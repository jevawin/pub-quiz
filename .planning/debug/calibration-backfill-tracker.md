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

## Files

- `supabase/migrations/00023_general_knowledge_optional.sql` — added GK category, loosened trigger
- `pipeline/scripts/insert-qc-batch.mjs` — batch insert helper
- `.planning/debug/calibration-backfill-flags.md` — category-mismatch review list
