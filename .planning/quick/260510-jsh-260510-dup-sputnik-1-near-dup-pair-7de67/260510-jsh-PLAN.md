---
phase: 260510-jsh
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - data/audit-changes.jsonl
autonomous: true
requirements:
  - 260510-dup
must_haves:
  truths:
    - "Question B (f862b7cf) status is 'rejected' in Supabase"
    - "Question A (7de67f33) has a question_categories row for slug 'space-exploration' with score 90"
    - "Question A has a question_categories row for slug 'technology' with score 85"
    - "Question A's 'the-solar-system' score is 50 (was 25)"
    - "All other A category scores (history=80, general-knowledge=80, science=50) are unchanged"
    - "B's question_categories rows are untouched (B is retired, not deleted)"
    - "data/audit-changes.jsonl has 4 new rows tagged batch_id 260510-dup (1 retire + 3 category ops on A)"
  artifacts:
    - path: "data/audit-changes.jsonl"
      provides: "Append-only audit rows for the dedup operation"
      contains: "260510-dup"
  key_links:
    - from: "Supabase questions row B (f862b7cf)"
      to: "data/audit-changes.jsonl entry op=update slug=null new_status=rejected"
      via: "matching question_id + batch_id 260510-dup"
      pattern: "f862b7cf.*rejected"
    - from: "Supabase question_categories rows on A (7de67f33)"
      to: "3 audit rows (insert space-exploration, insert technology, update the-solar-system)"
      via: "matching question_id 7de67f33 + batch_id 260510-dup"
      pattern: "7de67f33.*260510-dup"
---

<objective>
Resolve the Sputnik 1 near-duplicate pair: keep canonical question A (`7de67f33-b1f1-44d8-8036-e53ed58820c6`, "...launched into orbit"), retire question B (`f862b7cf-65ba-4722-97f1-17f4238fe09e`, "...launched into space") by setting status `published` → `rejected`, and backfill A's category coverage from B (insert `space-exploration`@90, insert `technology`@85, bump `the-solar-system` 25 → 50). Record all changes in `data/audit-changes.jsonl` with batch_id `260510-dup`. Deferred from phase 999.23 cousin/cat audit (ROADMAP §C1).

Purpose: Eliminate near-duplicate published questions while preserving the better category signal that B carried.
Output: 1 retired question + 2 new question_categories rows + 1 score bump on A in Supabase + 4 audit rows.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@data/audit-changes.jsonl

<interfaces>
Audit row shape (one JSON object per line in `data/audit-changes.jsonl`, matches sibling task 260510-oua format):

Retire row:
```json
{"ts":"<ISO-8601 UTC>","batch_id":"260510-dup","question_id":"f862b7cf-65ba-4722-97f1-17f4238fe09e","op":"update","slug":null,"prev_score":null,"new_score":null,"reason":"260510-dup: near-duplicate of 7de67f33; B (\"...into space\") retired in favour of A (\"...into orbit\") — A is older, more accurate wording, fun fact more substantive","cousin_reason":null,"chain_ancestor":false}
```

Category insert/update rows on A (3 rows):
```json
{"ts":"<ISO-8601 UTC>","batch_id":"260510-dup","question_id":"7de67f33-b1f1-44d8-8036-e53ed58820c6","op":"insert","slug":"space-exploration","prev_score":null,"new_score":90,"reason":"260510-dup: backfilled from retired near-duplicate B (f862b7cf) which carried space-exploration@90","cousin_reason":null,"chain_ancestor":false}
{"ts":"<ISO-8601 UTC>","batch_id":"260510-dup","question_id":"7de67f33-b1f1-44d8-8036-e53ed58820c6","op":"insert","slug":"technology","prev_score":null,"new_score":85,"reason":"260510-dup: backfilled from retired near-duplicate B (f862b7cf) which carried technology@85","cousin_reason":null,"chain_ancestor":false}
{"ts":"<ISO-8601 UTC>","batch_id":"260510-dup","question_id":"7de67f33-b1f1-44d8-8036-e53ed58820c6","op":"update","slug":"the-solar-system","prev_score":25,"new_score":50,"reason":"260510-dup: A's the-solar-system was under-estimated at 25; B carried 50 — bumped to match","cousin_reason":null,"chain_ancestor":false}
```

Supabase tables:
- `questions(id uuid, text text, status text)` — status enum: `published | rejected | verified`. `rejected` is the retire signal.
- `question_categories(question_id uuid, category_slug text, estimate_score int, ...)` — note the column is `estimate_score`, not `score`. (Confirm in Task 1 read; if column name differs in this DB, STOP and report.)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Read-only confirmation of starting state</name>
  <files>(read-only Supabase queries)</files>
  <action>
    Use the Supabase MCP (`mcp__supabase__*`) if available; otherwise run `supabase db query --linked` with read-only SELECTs. Do NOT make any writes in this task.

    Step 1 — confirm the two questions exist with expected status + text:
    ```sql
    SELECT id, status, left(text, 120) AS text
    FROM questions
    WHERE id IN ('7de67f33-b1f1-44d8-8036-e53ed58820c6', 'f862b7cf-65ba-4722-97f1-17f4238fe09e');
    ```
    Expect: A status=`published` text contains "orbit"; B status=`published` text contains "space".
    If either id is missing, status differs, or text doesn't match, STOP and report.

    Step 2 — confirm A's current category rows (must match background):
    ```sql
    SELECT category_slug, estimate_score
    FROM question_categories
    WHERE question_id = '7de67f33-b1f1-44d8-8036-e53ed58820c6'
    ORDER BY estimate_score DESC, category_slug;
    ```
    Expect exactly: history=80, general-knowledge=80, science=50, the-solar-system=25 (4 rows).
    Critically: confirm there is NO row for `space-exploration` or `technology` on A.
    If A already has space-exploration or technology rows, STOP and report — the inserts in Task 3 would create duplicates.

    Step 3 — confirm B's current category rows (sanity check; we do NOT touch B's join rows, only its status):
    ```sql
    SELECT category_slug, estimate_score
    FROM question_categories
    WHERE question_id = 'f862b7cf-65ba-4722-97f1-17f4238fe09e'
    ORDER BY estimate_score DESC, category_slug;
    ```
    Expect: space-exploration=90, technology=85, general-knowledge=75, science=50, the-solar-system=25 (5 rows). Record for the SUMMARY.

    Step 4 — confirm the column name is `estimate_score` (not `score`):
    ```sql
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'question_categories' AND column_name IN ('estimate_score', 'score');
    ```
    If `estimate_score` is not present (or `score` is the actual column), STOP and update the subsequent task SQL accordingly before proceeding.
  </action>
  <verify>
    <automated>Step 1 returns 2 rows with statuses 'published'/'published'. Step 2 returns exactly 4 rows matching the expected slug/score set with no space-exploration or technology row. Step 3 returns 5 rows matching expected. Step 4 confirms `estimate_score` column exists.</automated>
  </verify>
  <done>Starting state matches background; column name confirmed; safe to proceed to writes.</done>
</task>

<task type="auto">
  <name>Task 2: Retire question B (status published → rejected)</name>
  <files>(Supabase write)</files>
  <action>
    Run ONE targeted UPDATE with optimistic guard.

    ```sql
    UPDATE questions
    SET status = 'rejected'
    WHERE id = 'f862b7cf-65ba-4722-97f1-17f4238fe09e'
      AND status = 'published';
    ```

    The `AND status = 'published'` guard is required (fails safely if the row already moved).

    Then re-SELECT to confirm:
    ```sql
    SELECT id, status FROM questions WHERE id = 'f862b7cf-65ba-4722-97f1-17f4238fe09e';
    ```
    Expect status=`rejected`.

    Also confirm A is untouched:
    ```sql
    SELECT id, status FROM questions WHERE id = '7de67f33-b1f1-44d8-8036-e53ed58820c6';
    ```
    Expect status=`published`.

    Do NOT touch B's `question_categories` rows. We retire the question; the join rows stay (orphan-safe — RPCs filter by status).
    Do NOT create any file under `supabase/migrations/` — data fix only.
  </action>
  <verify>
    <automated>UPDATE affects exactly 1 row; post-UPDATE SELECT returns status='rejected' for B; SELECT on A returns status='published'.</automated>
  </verify>
  <done>B retired (status=rejected); A unchanged.</done>
</task>

<task type="auto">
  <name>Task 3: Backfill A's category coverage (2 inserts + 1 score bump)</name>
  <files>(Supabase writes)</files>
  <action>
    Three SQL statements, each with optimistic guards. Run sequentially and verify after each.

    Statement 1 — INSERT space-exploration@90 on A:
    ```sql
    INSERT INTO question_categories (question_id, category_slug, estimate_score)
    SELECT '7de67f33-b1f1-44d8-8036-e53ed58820c6', 'space-exploration', 90
    WHERE NOT EXISTS (
      SELECT 1 FROM question_categories
      WHERE question_id = '7de67f33-b1f1-44d8-8036-e53ed58820c6'
        AND category_slug = 'space-exploration'
    );
    ```
    Verify exactly 1 row inserted.
    If the table has additional NOT NULL columns beyond `(question_id, category_slug, estimate_score)`, STOP and report — do not invent values. (Task 1 Step 4 should have surfaced the column list; if it didn't, run `\d question_categories` or `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='question_categories'` first.)

    Statement 2 — INSERT technology@85 on A (same pattern):
    ```sql
    INSERT INTO question_categories (question_id, category_slug, estimate_score)
    SELECT '7de67f33-b1f1-44d8-8036-e53ed58820c6', 'technology', 85
    WHERE NOT EXISTS (
      SELECT 1 FROM question_categories
      WHERE question_id = '7de67f33-b1f1-44d8-8036-e53ed58820c6'
        AND category_slug = 'technology'
    );
    ```
    Verify exactly 1 row inserted.

    Statement 3 — UPDATE the-solar-system score 25 → 50 on A:
    ```sql
    UPDATE question_categories
    SET estimate_score = 50
    WHERE question_id = '7de67f33-b1f1-44d8-8036-e53ed58820c6'
      AND category_slug = 'the-solar-system'
      AND estimate_score = 25;
    ```
    Verify exactly 1 row updated. The `AND estimate_score = 25` guard is required.

    Final confirmation — re-SELECT all of A's category rows:
    ```sql
    SELECT category_slug, estimate_score
    FROM question_categories
    WHERE question_id = '7de67f33-b1f1-44d8-8036-e53ed58820c6'
    ORDER BY estimate_score DESC, category_slug;
    ```
    Expect exactly 6 rows: space-exploration=90, technology=85, history=80, general-knowledge=80, science=50, the-solar-system=50.

    Also confirm B's category rows are untouched (still 5 rows, scores unchanged) — re-run Task 1 Step 3.
  </action>
  <verify>
    <automated>Each of the 3 statements affects exactly 1 row. Final SELECT on A returns exactly 6 rows matching the expected slug/score set. B's join rows still match Task 1 Step 3 baseline.</automated>
  </verify>
  <done>A has 6 category rows with the expected scores; B's join rows unchanged.</done>
</task>

<task type="auto">
  <name>Task 4: Append 4 audit rows to data/audit-changes.jsonl</name>
  <files>data/audit-changes.jsonl</files>
  <action>
    Append exactly 4 lines (one JSON object per line, terminating newline after the last) matching the shapes in &lt;interfaces&gt;. Use the current ISO-8601 UTC timestamp for `ts` (each row may share or differ by milliseconds — match sibling task 260510-oua style which used a single timestamp per task).

    Order of appended rows:
    1. Retire row for B (op=update, slug=null, reason references switch from published to rejected)
    2. Insert row for A space-exploration@90
    3. Insert row for A technology@85
    4. Update row for A the-solar-system 25 → 50

    Append only — never rewrite earlier lines.

    Note on the retire row: existing audit log uses `op=update` with `slug=null` and `prev_score=null/new_score=null` for non-category status changes. We follow that convention; the `reason` field carries the semantic ("status published → rejected; near-duplicate retired").
  </action>
  <verify>
    <automated>`grep -c '"batch_id":"260510-dup"' data/audit-changes.jsonl` returns 4; last 4 lines each parse as JSON (e.g. `tail -n 4 data/audit-changes.jsonl | node -e "require('fs').readFileSync(0,'utf8').trim().split('\n').forEach(l=>JSON.parse(l))"`); among the 4 new rows: 1 has question_id f862b7cf and 3 have question_id 7de67f33; slugs are null, space-exploration, technology, the-solar-system.</automated>
  </verify>
  <done>Four new lines appended to data/audit-changes.jsonl with batch_id=260510-dup, covering 1 retire + 3 category ops; format matches existing 999.23 + 260510-oua entries.</done>
</task>

</tasks>

<verification>
- `SELECT status FROM questions WHERE id='f862b7cf-65ba-4722-97f1-17f4238fe09e'` returns `rejected`.
- `SELECT status FROM questions WHERE id='7de67f33-b1f1-44d8-8036-e53ed58820c6'` returns `published`.
- `SELECT category_slug, estimate_score FROM question_categories WHERE question_id='7de67f33-...'` returns 6 rows: space-exploration=90, technology=85, history=80, general-knowledge=80, science=50, the-solar-system=50.
- `SELECT count(*) FROM question_categories WHERE question_id='f862b7cf-...'` returns 5 (B's join rows untouched).
- `grep -c '"batch_id":"260510-dup"' data/audit-changes.jsonl` returns 4.
- No files modified under `supabase/migrations/`.
</verification>

<success_criteria>
- Sputnik 1 near-duplicate pair resolved: B retired (status=rejected), A enriched with B's category coverage.
- Exactly 4 audit rows appended; format matches sibling 260510-oua entries.
- Zero schema changes, zero application code changes.
- A's pre-existing category rows (history, general-knowledge, science) untouched in score; only the-solar-system bumped.
</success_criteria>

<output>
After completion, create `.planning/quick/260510-jsh-260510-dup-sputnik-1-near-dup-pair-7de67/260510-jsh-01-SUMMARY.md` capturing: A id, B id, B's prior status (published) and new status (rejected), A's prior 4-row category snapshot, A's new 6-row category snapshot, and the 4 audit row timestamps.
</output>
