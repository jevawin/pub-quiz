---
phase: 260418-otd-opentdb-bulk-import
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/00018_questions_staging.sql
  - pipeline/scripts/opentdb/fetch.sh
  - pipeline/scripts/opentdb/prefilter.ts
  - pipeline/scripts/opentdb/process.ts
  - pipeline/scripts/opentdb/promote.ts
  - pipeline/scripts/opentdb/review.sql
  - pipeline/scripts/opentdb/README.md
autonomous: false
---

# OpenTDB Bulk Import — Plan

Goal: import ~2000 high-quality multiple-choice questions from the Open Trivia
Database (CC BY-SA 4.0) into `questions`, with Claude-assigned categories,
fun facts, and keep/skip/uncertain verdicts.

## Flow

1. `fetch.sh` — pull verified pool via OpenTDB API (~4550 qs, rate-limited).
2. `prefilter.ts` — decode URL encoding, drop T/F (665), drop date-sensitive (82),
   dedupe in-batch (8). Output: 3795 MC questions.
3. Apply `00018_questions_staging.sql` — creates `questions_staging` table.
4. `process.ts` — batches of 20 through local `claude --print` CLI (user's plan).
   For each batch: passes our category tree + fuzzy-matched dup candidates.
   Claude returns `category_slug`, `fun_fact`, `verdict`, `reason`, `dup_of`.
   Inserts to `questions_staging` (upsert on `source+external_id`, resumable).
5. Human review via `review.sql` — auto-approve keeps with category & no dup,
   auto-reject skips, eyeball uncertains.
6. `promote.ts` — copies `review_status='approved'` rows into `questions` with
   `status='published'`, `verification_score=2`. Marks staging as `imported`.

## Filter rules (agreed)

- MC only (T/F dropped — separate follow-up task to reframe as MC)
- Keep video games (1150) and anime (200) — user will surface counts in UI
- Drop date-sensitive wording
- Keep everything else, let Claude judge per-question

## Attribution

CC BY-SA 4.0 attribution to OpenTDB lives at the app's About section (global),
not per question. Out of scope for this task; handled at release.

## Cost

`claude` CLI uses user's plan (OAuth), not Anthropic API. Estimated 190 calls
× ~$0.23 equivalent — consumed as plan capacity, not billed.

## Expected outcome

- 3795 rows in `questions_staging`
- ~3000 with verdict `keep` (per dry-run sample: 90% keep rate)
- ~2500-3000 promoted to `questions` after review
