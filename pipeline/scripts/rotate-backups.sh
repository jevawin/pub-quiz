#!/usr/bin/env bash
# Rotate library backups in supabase/backups/.
#
# Policy:
#   - Keep last 14 daily files
#   - Keep first-of-month for everything older
#   - Delete the rest
#
# Idempotent. Safe to run after every backup.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
BACKUP_DIR="$REPO_ROOT/supabase/backups"
KEEP_DAYS=14

if [ ! -d "$BACKUP_DIR" ]; then
  echo "No backup dir at $BACKUP_DIR — nothing to rotate"
  exit 0
fi

cd "$BACKUP_DIR"

# All library backups, newest first
mapfile -t ALL < <(ls -1 library-*.sql.gz 2>/dev/null | sort -r)

if [ "${#ALL[@]}" -eq 0 ]; then
  echo "No backups found"
  exit 0
fi

KEEP=()
DELETE=()

for i in "${!ALL[@]}"; do
  f="${ALL[$i]}"
  # Extract YYYY-MM-DD
  date_part="${f#library-}"
  date_part="${date_part%.sql.gz}"
  day="${date_part##*-}"

  if [ "$i" -lt "$KEEP_DAYS" ]; then
    KEEP+=("$f")
  elif [ "$day" = "01" ]; then
    KEEP+=("$f")
  else
    DELETE+=("$f")
  fi
done

echo "Keep: ${#KEEP[@]} files"
echo "Delete: ${#DELETE[@]} files"

for f in "${DELETE[@]}"; do
  echo "  rm $f"
  rm -f "$f"
done
