---
phase: 260510-orn
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/00036_add_parked_reason.sql
  - supabase/migrations/00037_categories_extension.sql
  - data/audit-changes.jsonl
autonomous: true
requirements: [260510-prk, 260510-slg]
tags: [quick-task, schema-migration, parking-lane, slug-extension, audit-trail]

must_haves:
  truths:
    - "questions.parked_reason column exists (nullable text)"
    - "3 outlier Qs have status='parked' with correct parked_reason values"
    - "4 new leaves (board-games, electronic-music, 2010s-music, pizza) exist at depth=1 under correct parents"
    - "Both migrations applied to remote via supabase db push (not direct SQL)"
    - "Audit trail appended to data/audit-changes.jsonl with batch_id 260510-prk-slg"
    - "Live-Q query convention (status='published' filter) verified — outlier Qs disappear from quizzes"
  artifacts:
    - path: "supabase/migrations/00036_add_parked_reason.sql"
      provides: "ALTER TABLE questions ADD COLUMN parked_reason text + 3 guarded UPDATEs to park outliers"
      contains: "ADD COLUMN IF NOT EXISTS parked_reason"
    - path: "supabase/migrations/00037_categories_extension.sql"
      provides: "4 INSERTs into categories(slug,name,parent_id) for board-games, electronic-music, 2010s-music, pizza"
      contains: "ON CONFLICT (slug) DO NOTHING"
    - path: "data/audit-changes.jsonl"
      provides: "≥7 new rows appended under batch_id 260510-prk-slg"
      contains: "260510-prk-slg"
  key_links:
    - from: "supabase/migrations/00036_add_parked_reason.sql"
      to: "questions table on remote"
      via: "supabase db push"
      pattern: "supabase db push"
    - from: "supabase/migrations/00037_categories_extension.sql"
      to: "categories table on remote"
      via: "supabase db push"
      pattern: "supabase db push"
    - from: "3 parked Q UPDATEs"
      to: "live-quiz RPCs (count_available_questions, get_quiz_questions)"
      via: "WHERE status='published' filter convention"
      pattern: "status.*=.*'published'"
---

<objective>
Combined execution of 260510-prk + 260510-slg in one sequenced plan.

Part A (260510-prk): Add `parked_reason` text column to `questions` and park 3 outlier Qs whose categories don't yet exist (deferred to 260510-fas-altmed). Park = `status='parked'` (plain text, no enum migration). Outliers fall out of live quizzes via the existing `WHERE status='published'` filter convention — verified during this plan, not refactored.

Part B (260510-slg): Add 4 leaf categories to the slug tree (board-games, electronic-music, 2010s-music, pizza) so future mistag passes can re-tag rather than just delete. Single-parent tree, depth=1. Scope-reduced from 6 leaves; alternative-medicine + fashion-and-clothing deferred to 260510-fas-altmed (their 3 candidate Qs are the ones being parked here).

Part C: Append audit trail to `data/audit-changes.jsonl` under batch_id `260510-prk-slg` covering both schema changes, the 3 status_change rows, and the 4 cat inserts.

Purpose: Reusable parking lane unblocks future orphan-Q handling. Slug extension closes mistag-loop gaps surfaced in 999.23 review.
Output: 2 migration files, 7-8 audit rows, both migrations live on remote.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@supabase/migrations/00031_add_pop_culture_root.sql
@supabase/migrations/00030_categories_cleanup.sql
@.planning/quick/260510-jsh-260510-dup-sputnik-1-near-dup-pair-7de67/260510-jsh-SUMMARY.md

<interfaces>
<!-- Real schema (per 260510-jsh deviation note): -->
<!-- questions(id uuid, status text, parked_reason text NULL after 00036, …) -->
<!-- categories(id uuid, slug text UNIQUE, name text, parent_id uuid NULL, depth int) -->
<!-- question_categories(question_id, category_id, estimate_score, observed_score, observed_n, …) -->

<!-- Audit row shape (line 89 / 260510-oua precedent — ALL fields required, use null where N/A): -->
{
  "ts": "ISO-8601",
  "batch_id": "260510-prk-slg",
  "question_id": "uuid or null",
  "op": "update | insert | delete | status_change | schema_change",
  "slug": "string or null",
  "prev_score": "number or null",
  "new_score": "number or null",
  "reason": "human-readable",
  "cousin_reason": null,
  "chain_ancestor": false
}
<!-- For schema_change rows, question_id=null, slug=null, prev_score=null, new_score=null. -->
<!-- Decision: ONE summary schema_change row per migration (00036, 00037) — not 4 individual cat-insert rows. The migration file IS the per-cat record. -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write migration 00036 (parked_reason col + 3 guarded park UPDATEs)</name>
  <files>supabase/migrations/00036_add_parked_reason.sql</files>
  <action>
Create `supabase/migrations/00036_add_parked_reason.sql` with this exact shape (matching 00030's BEGIN/COMMIT + comment-block style):

```sql
-- 260510-prk: Parking lane for orphan-category questions.
-- Adds nullable parked_reason text column to questions. Convention:
-- status='parked' + parked_reason='awaiting category: <slug>' for Qs whose
-- correct category doesn't yet exist in the tree (deferred to 260510-fas-altmed).
-- Live-quiz RPCs filter WHERE status='published', so parked rows fall out of play
-- without deletion. status remains plain text — no enum migration.
--
-- Parks 3 outliers from 999.23 mistag review:
--   8843ae93… (Japanese shiatsu)        → awaiting category: alternative-medicine
--   a56a93d2… (Inditex/Zara HQ)         → awaiting category: fashion-and-clothing
--   ce1c631c… (Scotsman/kilt)           → awaiting category: fashion-and-clothing

BEGIN;

ALTER TABLE questions ADD COLUMN IF NOT EXISTS parked_reason text;

-- Optimistic guards: only park rows currently published. If pre-state differs
-- (already parked / rejected), the UPDATE no-ops and migration still succeeds.

UPDATE questions
SET status = 'parked', parked_reason = 'awaiting category: alternative-medicine'
WHERE id = '8843ae93-a391-4c54-a264-9bcfcdd44ecb' AND status = 'published';

UPDATE questions
SET status = 'parked', parked_reason = 'awaiting category: fashion-and-clothing'
WHERE id = 'a56a93d2-634c-48f9-bb48-829cc3011f97' AND status = 'published';

UPDATE questions
SET status = 'parked', parked_reason = 'awaiting category: fashion-and-clothing'
WHERE id = 'ce1c631c-f42d-435f-82d5-f225e34f7b8e' AND status = 'published';

COMMIT;
```

Do NOT push yet — Task 3 pushes both migrations together.
  </action>
  <verify>
    <automated>test -f supabase/migrations/00036_add_parked_reason.sql &amp;&amp; grep -c "ADD COLUMN IF NOT EXISTS parked_reason" supabase/migrations/00036_add_parked_reason.sql | grep -q "^1$" &amp;&amp; grep -c "status = 'parked'" supabase/migrations/00036_add_parked_reason.sql | grep -q "^3$" &amp;&amp; grep -c "status = 'published'" supabase/migrations/00036_add_parked_reason.sql | grep -q "^3$"</automated>
  </verify>
  <done>File exists. ALTER COLUMN appears once. 3 UPDATEs each guarded by `status = 'published'`. All 3 target UUIDs present.</done>
</task>

<task type="auto">
  <name>Task 2: Write migration 00037 (4 leaf cat inserts)</name>
  <files>supabase/migrations/00037_categories_extension.sql</files>
  <action>
Create `supabase/migrations/00037_categories_extension.sql` mirroring 00031's INSERT-from-SELECT-parent pattern but for 4 leaves (parents differ per row, so use the multi-row VALUES + JOIN pattern from 00030 §3.2):

```sql
-- 260510-slg: Slug-tree extension — 4 leaves surfaced as gaps during 999.23 mistag review.
-- Single-parent tree, depth=1 under existing roots/sub-roots.
-- Scope-reduced from 6 originally-proposed leaves; alternative-medicine + fashion-and-clothing
-- deferred to 260510-fas-altmed (their 1+2 candidate Qs parked via 00036).

BEGIN;

INSERT INTO categories (slug, name, parent_id)
SELECT v.slug, v.name, p.id
FROM (VALUES
  ('board-games',      'Board Games',      'gaming'),
  ('electronic-music', 'Electronic Music', 'music'),
  ('2010s-music',      '2010s Music',      'music'),
  ('pizza',            'Pizza',            'food-and-drink')
) AS v(slug, name, parent_slug)
JOIN categories p ON p.slug = v.parent_slug
ON CONFLICT (slug) DO NOTHING;

COMMIT;
```
  </action>
  <verify>
    <automated>test -f supabase/migrations/00037_categories_extension.sql &amp;&amp; grep -c "ON CONFLICT (slug) DO NOTHING" supabase/migrations/00037_categories_extension.sql | grep -q "^1$" &amp;&amp; grep -c "board-games\|electronic-music\|2010s-music\|pizza" supabase/migrations/00037_categories_extension.sql | grep -q "^4$"</automated>
  </verify>
  <done>File exists. ON CONFLICT clause present. All 4 slug literals present exactly once each in the VALUES list.</done>
</task>

<task type="auto">
  <name>Task 3: Push both migrations to remote + verify post-state</name>
  <files>(remote DB only — no local file changes)</files>
  <action>
Push both new migrations via `supabase db push`. This is the convention used by 00030/00031 — git log will confirm. Do NOT pipe SQL through `supabase db query --linked` for migration content.

```bash
supabase db push
```

If push needs `--linked` or a project ref flag in this environment, use whatever the prior migrations used (check `git log -1 --stat supabase/migrations/00031_add_pop_culture_root.sql` for the commit; the SUMMARY/PROGRESS doc next to it usually records the exact command).

After push succeeds, run two verification queries via `supabase db query --linked` (queries are read-only, the migration-vs-query restriction is about SQL that mutates schema/data):

**Verify A — parked_reason column + 3 parked Qs:**
```sql
SELECT id, status, parked_reason
FROM questions
WHERE id IN (
  '8843ae93-a391-4c54-a264-9bcfcdd44ecb',
  'a56a93d2-634c-48f9-bb48-829cc3011f97',
  'ce1c631c-f42d-435f-82d5-f225e34f7b8e'
)
ORDER BY id;
```
Expect 3 rows, all `status='parked'`, parked_reason matching the spec (1× alternative-medicine, 2× fashion-and-clothing). If any row is missing or status≠parked, halt and report — do not proceed to audit.

**Verify B — 4 new leaves at depth=1 under correct parents:**
```sql
SELECT c.slug, c.depth, p.slug AS parent
FROM categories c
LEFT JOIN categories p ON c.parent_id = p.id
WHERE c.slug IN ('board-games','electronic-music','2010s-music','pizza')
ORDER BY c.slug;
```
Expect 4 rows. Parents: board-games→gaming, electronic-music→music, 2010s-music→music, pizza→food-and-drink. Depth: all=1 (if depth column auto-populates from parent_id; otherwise expect 0 and flag for 260510-dpd's depth-drift sweep — depth drift is a known active issue, do NOT fix here).

**Filter-audit grep (single-pass, no refactor):**
```bash
grep -rn "status.*=.*'published'" supabase/migrations/ pipeline/src/ apps/web/ 2>/dev/null | grep -v "^Binary"
```
Skim output. If every live-question RPC / fetch path filters `status='published'`, convention holds — record "filter convention verified" in summary. If any caller queries questions WITHOUT the filter, list the file:line in the next-task audit-row reason field and flag for follow-up. Do NOT refactor in this plan.
  </action>
  <verify>
    <automated>supabase db query --linked "SELECT count(*) FROM questions WHERE id IN ('8843ae93-a391-4c54-a264-9bcfcdd44ecb','a56a93d2-634c-48f9-bb48-829cc3011f97','ce1c631c-f42d-435f-82d5-f225e34f7b8e') AND status='parked'" 2>&amp;1 | grep -q "3" &amp;&amp; supabase db query --linked "SELECT count(*) FROM categories WHERE slug IN ('board-games','electronic-music','2010s-music','pizza')" 2>&amp;1 | grep -q "4"</automated>
  </verify>
  <done>`supabase db push` succeeds. 3 target Qs return status=parked with correct parked_reason. 4 new leaves exist with correct parent slugs. Filter-audit grep output reviewed and verdict (clean / flagged file:lines) noted for Task 4.</done>
</task>

<task type="auto">
  <name>Task 4: Append audit trail (7 rows) under batch_id 260510-prk-slg</name>
  <files>data/audit-changes.jsonl</files>
  <action>
Append 7 rows to `data/audit-changes.jsonl`. One ts per row (ISO-8601, current time, monotonically increasing). Use the line-89 / 260510-oua precedent shape — every field present, null where N/A. batch_id is `260510-prk-slg` for all 7.

**Row 1 — schema_change for migration 00036:**
```json
{"ts":"<ISO>","batch_id":"260510-prk-slg","question_id":null,"op":"schema_change","slug":null,"prev_score":null,"new_score":null,"reason":"260510-prk: migration 00036_add_parked_reason — added nullable parked_reason text col to questions; convention status='parked' + parked_reason='awaiting category: <slug>'","cousin_reason":null,"chain_ancestor":false}
```

**Rows 2-4 — status_change for the 3 parked Qs:**
```json
{"ts":"<ISO>","batch_id":"260510-prk-slg","question_id":"8843ae93-a391-4c54-a264-9bcfcdd44ecb","op":"status_change","slug":null,"prev_score":null,"new_score":null,"reason":"260510-prk: parked — Japanese shiatsu, awaiting category: alternative-medicine (deferred to 260510-fas-altmed)","cousin_reason":null,"chain_ancestor":false}
{"ts":"<ISO>","batch_id":"260510-prk-slg","question_id":"a56a93d2-634c-48f9-bb48-829cc3011f97","op":"status_change","slug":null,"prev_score":null,"new_score":null,"reason":"260510-prk: parked — Inditex/Zara HQ, awaiting category: fashion-and-clothing (deferred to 260510-fas-altmed)","cousin_reason":null,"chain_ancestor":false}
{"ts":"<ISO>","batch_id":"260510-prk-slg","question_id":"ce1c631c-f42d-435f-82d5-f225e34f7b8e","op":"status_change","slug":null,"prev_score":null,"new_score":null,"reason":"260510-prk: parked — Scotsman/kilt, awaiting category: fashion-and-clothing (deferred to 260510-fas-altmed)","cousin_reason":null,"chain_ancestor":false}
```

**Row 5 — schema_change for migration 00037:**
```json
{"ts":"<ISO>","batch_id":"260510-prk-slg","question_id":null,"op":"schema_change","slug":null,"prev_score":null,"new_score":null,"reason":"260510-slg: migration 00037_categories_extension — added 4 leaves (board-games→gaming, electronic-music→music, 2010s-music→music, pizza→food-and-drink); single-parent tree, depth=1; scope-reduced from 6 (alt-medicine + fashion deferred to 260510-fas-altmed)","cousin_reason":null,"chain_ancestor":false}
```

**Rows 6-7 — filter audit + summary:**
```json
{"ts":"<ISO>","batch_id":"260510-prk-slg","question_id":null,"op":"audit","slug":null,"prev_score":null,"new_score":null,"reason":"260510-prk filter audit: grep status='published' across migrations/pipeline/web — <CLEAN: convention holds | FLAGGED: <file:line> queries questions without status filter, follow-up needed>","cousin_reason":null,"chain_ancestor":false}
{"ts":"<ISO>","batch_id":"260510-prk-slg","question_id":null,"op":"audit","slug":null,"prev_score":null,"new_score":null,"reason":"260510-orn batch complete: 1 col added, 3 Qs parked, 4 leaves added, 7 audit rows appended; both migrations on remote","cousin_reason":null,"chain_ancestor":false}
```

Replace `<ISO>` with real timestamps and the angle-bracket placeholder in row 6 with the actual filter-audit verdict from Task 3. Append using `>>` (do not overwrite).

**Decision logged:** One summary schema_change row per migration (rows 1 and 5), not 4 individual cat-insert rows. The migration file itself is the per-cat record; an audit row per insert duplicates information already in git.
  </action>
  <verify>
    <automated>BEFORE=$(wc -l &lt; data/audit-changes.jsonl) &amp;&amp; AFTER=$BEFORE &amp;&amp; grep -c '"batch_id":"260510-prk-slg"' data/audit-changes.jsonl | grep -qE "^([7-9]|[1-9][0-9]+)$" &amp;&amp; tail -7 data/audit-changes.jsonl | while read line; do echo "$line" | python3 -c "import sys,json; json.loads(sys.stdin.read())" || exit 1; done &amp;&amp; echo OK</automated>
  </verify>
  <done>`data/audit-changes.jsonl` grew by ≥7 lines. All new lines parse as valid JSON. ≥7 rows match `batch_id="260510-prk-slg"`. Row 6 contains the actual filter-audit verdict (not the placeholder).</done>
</task>

<task type="auto">
  <name>Task 5: Commit (single combined commit)</name>
  <files>(git only)</files>
  <action>
Single combined commit covering both migrations + audit (planner's pick per constraints — one logical batch, sequenced but interdependent).

```bash
git add supabase/migrations/00036_add_parked_reason.sql \
        supabase/migrations/00037_categories_extension.sql \
        data/audit-changes.jsonl
git status
git commit -m "$(cat <<'EOF'
quick(260510-orn): parking lane + 4-leaf slug extension

260510-prk: migration 00036 adds questions.parked_reason text col;
parks 3 outlier Qs (status='published'→'parked') with awaiting-category
reasons. Live-quiz RPCs already filter status='published'.

260510-slg: migration 00037 adds 4 leaves (board-games→gaming,
electronic-music→music, 2010s-music→music, pizza→food-and-drink).
Scope-reduced from 6; alt-medicine + fashion-and-clothing deferred
to 260510-fas-altmed (their 3 Qs parked above).

7 audit rows appended (data/audit-changes.jsonl, batch_id 260510-prk-slg).
Both migrations applied to remote via supabase db push.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
  </action>
  <verify>
    <automated>git log -1 --pretty=format:"%s" | grep -q "260510-orn" &amp;&amp; git log -1 --stat | grep -q "00036_add_parked_reason.sql" &amp;&amp; git log -1 --stat | grep -q "00037_categories_extension.sql" &amp;&amp; git log -1 --stat | grep -q "audit-changes.jsonl"</automated>
  </verify>
  <done>One commit lands touching both migration files + audit-changes.jsonl. Commit subject references 260510-orn.</done>
</task>

</tasks>

<verification>
End-of-plan checks (cumulative):
1. `supabase/migrations/00036_add_parked_reason.sql` and `…/00037_categories_extension.sql` exist on disk and on remote.
2. Remote `questions` table has `parked_reason` column; 3 target Qs are status=parked.
3. Remote `categories` table has 4 new leaves under correct parents.
4. `data/audit-changes.jsonl` line count grew by 7; all new lines valid JSON; all carry batch_id `260510-prk-slg`.
5. Single git commit on main referencing 260510-orn.
6. Filter-audit verdict captured in audit row 6 (clean OR flagged with file:line).
</verification>

<success_criteria>
- 2 migration files written and applied to remote.
- 3 outlier Qs parked with correct reasons.
- 4 new leaves live with correct parents and depth.
- 7+ audit rows appended under batch_id `260510-prk-slg`.
- Filter convention (`WHERE status='published'`) verified, not refactored.
- Single combined commit.
- Locked decisions honored: 4 leaves only (not 6); single-parent tree; status='parked' is plain text (no enum); 5-cat cap untouched (parked Qs don't add cat rows).
</success_criteria>

<output>
After completion, create `.planning/quick/260510-orn-260510-prk-slg-combined-add-parked-statu/260510-orn-SUMMARY.md` covering:
- Final state of all 3 parked Qs (status, parked_reason)
- Final state of 4 new leaves (slug, depth, parent)
- Audit row count delta (before → after)
- Filter-audit verdict (clean / flagged callers)
- Commit hash
- Any deviations from plan (auto-fixed Rule 3 issues, etc.)
</output>
