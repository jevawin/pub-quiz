# OpenTDB Bulk Import — Summary

**Date:** 2026-04-19
**Outcome:** Library grew from 648 → 2956 questions (+2308 published).

## Final counts

- Fetched: 4550 verified OpenTDB questions
- Pre-filtered (MC only, no date-sensitive): 3795
- Claude verdicts (via local `claude` CLI, user's plan):
  - keep: 2645
  - skip: 748
  - uncertain: 402
- Promoted to `questions` (clean keeps only): **2308**
- Held in `questions_staging` for later curation: **739**
  - cat-mismatch or no-cat: 271
  - dup-flagged: 8
  - US-centric: 65
  - uncertain: 402
  - (minor overlap between groups)
- Rejected: 748

## Artifacts

- `supabase/migrations/00018_questions_staging.sql` — staging table
- `pipeline/scripts/opentdb/` — fetch, prefilter, process, mark-review,
  promote, review.sql, README

## Follow-ups (chips spawned earlier)

1. Live category question counts — **already landed** (Phase 260418-st9)
2. General Knowledge round-robin RPC — already landed (00016)
3. Convert OpenTDB T/F (665 questions) to MC — **pending**

## Remaining held rows

739 rows stay in `questions_staging` with `review_status='pending'`.
Cleanup needs:
- New parent categories: Maths, World Geography (non-EU), Ancient History,
  General Music Theory, Norse Mythology
- Re-run cat assignment for the 271 mismatched rows
- Human eyeball on 402 uncertains
- Review the 65 US-centric flags for British-adjacent content worth keeping

Best handled during Phase 2.3 admin dashboard build.

## Attribution

CC BY-SA 4.0 attribution to OpenTDB to live in app About section at release.
No schema changes required for attribution.
