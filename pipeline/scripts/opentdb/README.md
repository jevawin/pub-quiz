# OpenTDB bulk import

One-shot import of ~4550 verified questions from [Open Trivia Database](https://opentdb.com/)
(CC BY-SA 4.0). Attribution is handled globally in the app's About section.

## Flow

1. **Fetch** — `fetch.sh` pulls verified questions from OpenTDB, rate-limited. ~25min.
   Writes `/tmp/opentdb/all.json` (URL-encoded, raw).
2. **Prefilter** — `prefilter.ts` decodes, drops True/False, drops date-sensitive
   wording, dedupes within batch. Emits `/tmp/opentdb/filtered.json`.
3. **Process** — `process.ts` batches 20 questions per `claude` CLI call. Claude
   assigns `category_id` from our tree, generates `fun_fact`, judges keep/skip,
   flags potential duplicates vs existing `questions`. Writes to `questions_staging`.
4. **Review** — SQL queries in `review.sql` surface Claude's keeps for eyeball
   approval. Update `review_status = 'approved' | 'rejected'`.
5. **Promote** — `promote.ts` copies `review_status = 'approved'` rows into
   `questions` with `status = 'pending'` (pipeline's normal flow handles the rest).

## Cost

Processor uses the local `claude` CLI (user's plan), not the Anthropic API.
4550 questions / 20 per batch = ~228 calls. No API billing.

## T/F questions

The 665 True/False questions are **skipped** in this import. Separate follow-up
task reframes them as multiple-choice.
