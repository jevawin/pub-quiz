# Question Library Backups

Daily data-only `pg_dump` of tier-1 tables (curated content + audit trail).

## Schedule

GitHub Action `backup-question-library.yml` runs at **04:00 UTC daily**, commits to `main`.

Manual trigger: GitHub Actions tab → backup-question-library → Run workflow.

## Tables backed up

- `categories` — curated tree
- `questions` — curated content (text, answer, fun_fact, distractors)
- `question_categories` — manual tagging + per-cat scores
- `questions_staging` — pre-publish queue
- `question_feedback` — user-submitted feedback
- `question_recategorisations` — audit history

## Tables NOT backed up

- `question_plays`, `quiz_sessions` — regeneratable via play, anon-id privacy
- `sources`, `pipeline_runs` — process logs

## Retention

`rotate-backups.sh` policy:
- Last 14 daily files kept
- First-of-month kept indefinitely
- Everything else deleted

## Restore

```bash
# 1. Pick a backup
ls supabase/backups/

# 2. Decompress
gunzip -k supabase/backups/library-2026-05-09.sql.gz

# 3. Restore (DESTRUCTIVE — wipes current rows in those tables)
psql "$SUPABASE_DB_URL" -c "TRUNCATE categories, questions, question_categories, questions_staging, question_feedback, question_recategorisations RESTART IDENTITY CASCADE;"
psql "$SUPABASE_DB_URL" < supabase/backups/library-2026-05-09.sql

# 4. Cleanup
rm supabase/backups/library-2026-05-09.sql
```

**Test restore quarterly to a staging project — backups untested are not backups.**

## Required secrets

- `SUPABASE_DB_URL` — full Postgres connection string. Get from Supabase dashboard:
  Project Settings → Database → Connection string → URI (use direct or session pooler).
  Add as GitHub repo secret.
