#!/usr/bin/env bash
# Daily data-only backup of tier-1 question library tables.
# Output: supabase/backups/library-YYYY-MM-DD.sql.gz
#
# Required env: SUPABASE_DB_URL (postgres connection string with service role)
# Use Supabase dashboard → Project Settings → Database → Connection string (URI).
# Use the "session" pooler URL or direct connection — pg_dump needs full SQL access.
#
# Tables backed up (tier 1 — irreplaceable curated content + audit trail):
#   - categories            (curated tree)
#   - questions             (curated content)
#   - question_categories   (manual tagging + scores)
#   - questions_staging     (pre-publish queue, API spend)
#   - question_feedback     (user-submitted, can't regen)
#   - question_recategorisations (audit history)
#
# Skipped (tier 2/3 — regeneratable or privacy-sensitive):
#   - question_plays, quiz_sessions (regen via play; anon-id privacy)
#   - sources, pipeline_runs (logs)

set -euo pipefail

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "ERROR: SUPABASE_DB_URL not set" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
BACKUP_DIR="$REPO_ROOT/supabase/backups"
mkdir -p "$BACKUP_DIR"

DATE="$(date -u +%F)"
OUT_FILE="$BACKUP_DIR/library-${DATE}.sql.gz"

TABLES=(
  categories
  questions
  question_categories
  questions_staging
  question_feedback
  question_recategorisations
)

TABLE_ARGS=()
for t in "${TABLES[@]}"; do
  TABLE_ARGS+=(--table="public.$t")
done

echo "Dumping ${#TABLES[@]} tier-1 tables → $OUT_FILE"
pg_dump "$SUPABASE_DB_URL" \
  --data-only \
  --no-owner \
  --no-acl \
  --quote-all-identifiers \
  --column-inserts \
  "${TABLE_ARGS[@]}" \
  | gzip -9 > "$OUT_FILE"

SIZE="$(du -h "$OUT_FILE" | cut -f1)"
echo "Wrote $OUT_FILE ($SIZE)"
