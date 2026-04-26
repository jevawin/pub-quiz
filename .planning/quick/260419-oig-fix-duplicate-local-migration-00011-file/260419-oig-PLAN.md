---
phase: quick-260419-oig
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/00011_feedback_difficulty_rating.sql
  - supabase/migrations/00011_questions_staging.sql
  - supabase/migrations/00018_questions_staging.sql
autonomous: false
requirements:
  - QUICK-260419-OIG
must_haves:
  truths:
    - "Only one migration file uses version 00011"
    - "supabase db push runs without duplicate key error"
    - "Local and remote schema_migrations histories agree"
  artifacts:
    - path: "supabase/migrations/"
      provides: "Monotonic, unique migration version numbers"
  key_links:
    - from: "local migrations/"
      to: "remote schema_migrations"
      via: "supabase migration repair"
      pattern: "supabase migration list"
---

<objective>
Fix duplicate local migration version 00011. Two files share 00011 — `00011_feedback_difficulty_rating.sql` and `00011_questions_staging.sql`. This breaks `supabase db push` with a duplicate key error on `schema_migrations_pkey`. Remote already has one 00011 applied.

Note: `supabase/migrations/00018_questions_staging.sql` also exists (created 2026-04-18). This appears to be a later re-attempt of the staging migration — verify whether it duplicates 00011_questions_staging.sql and resolve.

Purpose: Unblock `supabase db push` so new migrations (00016, 00017) can deploy.
Output: Migration history is clean, local and remote agree, push runs cleanly.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@supabase/migrations/00011_feedback_difficulty_rating.sql
@supabase/migrations/00011_questions_staging.sql
@supabase/migrations/00018_questions_staging.sql

Current migration files: 00001–00018 with 00011 duplicated and 00018 also appears to be a staging migration (possible overlap with 00011_questions_staging.sql).
</context>

<tasks>

<task type="checkpoint:human-verify">
  <name>Task 1: Identify which 00011 is applied on remote + resolve 00018 overlap</name>
  <files>none (read-only)</files>
  <action>
    Run these commands and report output to user:

    1. `supabase migration list` — shows local vs remote applied versions
    2. If needed, query remote: `supabase db remote commit` is NOT needed; instead use `supabase migration list --linked` to compare.

    Determine:
    - Which 00011 file's contents match what remote applied (likely `00011_feedback_difficulty_rating.sql` since it was committed first on Apr 11, before `00011_questions_staging.sql`)
    - Whether `00018_questions_staging.sql` is a duplicate of `00011_questions_staging.sql` (diff them). If identical, the local 00011_questions_staging.sql is redundant — delete it rather than renumber.

    Present findings to user. Wait for confirmation on the plan:
    - Option A: Delete local `00011_questions_staging.sql` (if 00018 is the same staging migration already queued to deploy)
    - Option B: Renumber `00011_questions_staging.sql` to next free version (00019)
  </action>
  <verify>
    <automated>MISSING — interactive diagnosis, requires user review of `supabase migration list` output</automated>
  </verify>
  <done>User has confirmed which 00011 remote applied and chosen Option A (delete) or Option B (renumber).</done>
</task>

<task type="auto">
  <name>Task 2: Apply fix — delete or renumber the conflicting 00011</name>
  <files>supabase/migrations/00011_questions_staging.sql, supabase/migrations/00019_questions_staging.sql (if renumbering)</files>
  <action>
    Based on Task 1 decision:

    **If Option A (delete):**
    - `git rm supabase/migrations/00011_questions_staging.sql`

    **If Option B (renumber):**
    - Verify 00019 is free: `ls supabase/migrations/ | grep ^00019` returns nothing
    - `git mv supabase/migrations/00011_questions_staging.sql supabase/migrations/00019_questions_staging.sql`
    - Open the renumbered file and confirm no internal version references need updating (migration SQL files normally have no embedded version strings — content stays unchanged)

    After the file change, run `supabase migration list` again to confirm local history now shows unique versions.
  </action>
  <verify>
    <automated>ls supabase/migrations/ | awk -F_ '{print $1}' | sort | uniq -d | wc -l | grep -q '^ *0$'</automated>
  </verify>
  <done>No duplicate version prefixes in supabase/migrations/. `supabase migration list` shows unique local versions.</done>
</task>

<task type="checkpoint:human-verify">
  <name>Task 3: Repair remote history and verify db push</name>
  <files>none (remote DB operation)</files>
  <action>
    These commands touch shared state — require user confirmation before running.

    Present to user for approval:

    1. `supabase migration repair --status applied <version>` for any remote rows that no longer match a local file (if renumbering was used, remote's applied 00011 still exists and matches the file that kept version 00011 — likely no repair needed).
    2. If Option B was used and the other 00011 file was never applied remotely, no repair is needed — its renumbered version will apply on next push.
    3. If `supabase migration list` shows any mismatch (remote has a version with no local file, or vice versa): run `supabase migration repair --status applied <ver>` or `--status reverted <ver>` per Supabase docs.
    4. After repair (or if no repair needed), run: `supabase db push --dry-run` first, then `supabase db push`.

    User runs these commands themselves and reports results. Do not run `repair` or `push` without explicit user go-ahead.
  </action>
  <verify>
    <automated>MISSING — `supabase db push` runs against remote DB and must be triggered by user</automated>
  </verify>
  <done>`supabase db push` completes with no duplicate key error. `supabase migration list` shows local and remote fully aligned. User confirms clean state.</done>
</task>

</tasks>

<verification>
- `supabase migration list` shows no duplicate versions locally
- `supabase migration list` shows local and remote aligned
- `supabase db push` exits 0
- Git history shows a single commit renaming or removing the offending file
</verification>

<success_criteria>
- No two files in supabase/migrations/ share a version prefix
- `supabase db push` runs clean
- Remote schema_migrations table aligns with local migration files
- User has approved and executed all remote DB operations
</success_criteria>

<output>
After completion, create `.planning/quick/260419-oig-fix-duplicate-local-migration-00011-file/260419-oig-SUMMARY.md`.
</output>
