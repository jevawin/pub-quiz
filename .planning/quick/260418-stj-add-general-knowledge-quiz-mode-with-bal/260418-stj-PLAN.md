---
phase: 260418-stj
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/00016_random_general_knowledge_questions_rpc.sql
autonomous: true
requirements:
  - GK-01
must_haves:
  truths:
    - "Calling random_general_knowledge_questions(n) returns up to n published questions."
    - "Returned questions are distributed round-robin across root categories (parent_id IS NULL), not clustered."
    - "No hardcoded root list — roots are discovered dynamically from the categories table."
    - "Return row shape matches random_published_questions (id, question_text, correct_answer, distractors, explanation, category_id, category_slug)."
    - "If some roots have fewer published questions than their share, the function still returns up to n by pulling extras from roots with surplus (graceful shortfall)."
    - "anon and authenticated roles can execute the function."
  artifacts:
    - path: "supabase/migrations/00016_random_general_knowledge_questions_rpc.sql"
      provides: "New RPC random_general_knowledge_questions(n int) with GRANT EXECUTE."
      contains: "CREATE OR REPLACE FUNCTION random_general_knowledge_questions"
  key_links:
    - from: "random_general_knowledge_questions"
      to: "categories.parent_id IS NULL"
      via: "root_cats CTE"
      pattern: "parent_id IS NULL"
    - from: "random_general_knowledge_questions"
      to: "questions.status = 'published'"
      via: "WHERE clause"
      pattern: "status = 'published'"
---

<objective>
Add a Supabase RPC `random_general_knowledge_questions(p_limit int)` that returns a balanced General Knowledge quiz sampled round-robin across all root categories.

Purpose: Enables a General Knowledge quiz mode that gives even coverage across top-level topics instead of biasing toward roots with more questions.
Output: New migration file `00016_random_general_knowledge_questions_rpc.sql`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@supabase/migrations/00001_initial_schema.sql
@supabase/migrations/00006_random_published_questions_rpc.sql
@supabase/migrations/00008_rpc_return_root_category.sql
@supabase/migrations/00015_random_published_questions_excluding.sql

<interfaces>
Schema (from 00001_initial_schema.sql):

```sql
categories(id UUID, name TEXT, slug TEXT UNIQUE, parent_id UUID NULL, depth INT, ...)
questions(id UUID, category_id UUID, question_text TEXT, correct_answer TEXT,
          distractors JSONB, explanation TEXT, difficulty TEXT, status TEXT, ...)
```

- Root categories: `parent_id IS NULL` (confirmed column name).
- Published filter: `status = 'published'`.

Existing RPC signature to mirror (from 00008_rpc_return_root_category.sql):

```sql
RETURNS TABLE (
  id UUID,
  question_text TEXT,
  correct_answer TEXT,
  distractors JSONB,
  explanation TEXT,
  category_id UUID,
  category_slug TEXT  -- root category slug via COALESCE(root.slug, cat.slug)
)
LANGUAGE SQL STABLE SECURITY INVOKER SET search_path = public
```

GRANT pattern: `GRANT EXECUTE ON FUNCTION fn_name(...) TO anon, authenticated;`

Note: existing RPCs use `SECURITY INVOKER` (not DEFINER). Match that. The questions RLS policy already allows public read of published rows, so INVOKER is correct.
</interfaces>

<notes>
- No client-side code changes in this plan. The UI toggle / call site is out of scope per task description.
- Do NOT introduce a secondary-category taxonomy. Use existing `parent_id IS NULL` roots only.
- Round-robin strategy: rank questions within each root randomly, then order by rank so row 1 takes one from each root before row 2 does — this naturally distributes n across roots and gracefully handles shortfall (roots with fewer rows simply contribute fewer, remaining slots fall through to other roots).
</notes>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Create balanced general-knowledge RPC migration</name>
  <files>supabase/migrations/00016_random_general_knowledge_questions_rpc.sql</files>
  <action>
Create a new migration file at `supabase/migrations/00016_random_general_knowledge_questions_rpc.sql`.

Define `random_general_knowledge_questions(p_limit INT)` that returns up to `p_limit` published questions round-robin across all root categories (discovered dynamically via `parent_id IS NULL`).

Match the return shape of `random_published_questions` exactly:
`(id UUID, question_text TEXT, correct_answer TEXT, distractors JSONB, explanation TEXT, category_id UUID, category_slug TEXT)` — where `category_slug` is the ROOT ancestor slug (same COALESCE pattern as 00008).

Use `LANGUAGE SQL STABLE SECURITY INVOKER SET search_path = public` (matches existing RPCs — RLS already allows public read of published questions, so INVOKER is correct. Do NOT use SECURITY DEFINER; task hint was indicative but existing convention wins).

Implementation outline (round-robin via windowed rank):

```sql
CREATE OR REPLACE FUNCTION random_general_knowledge_questions(p_limit INT)
RETURNS TABLE (
  id UUID,
  question_text TEXT,
  correct_answer TEXT,
  distractors JSONB,
  explanation TEXT,
  category_id UUID,
  category_slug TEXT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  -- Map every category to its root ancestor id + slug.
  -- Roots map to themselves.
  RECURSIVE ancestry AS (
    SELECT c.id AS cat_id, c.id AS root_id, c.slug AS root_slug, c.parent_id
    FROM categories c
    WHERE c.parent_id IS NULL
    UNION ALL
    SELECT c.id AS cat_id, a.root_id, a.root_slug, c.parent_id
    FROM categories c
    JOIN categories p ON p.id = c.parent_id
    JOIN ancestry a ON a.cat_id = p.id
  ),
  -- All published questions joined to their root.
  pool AS (
    SELECT q.id, q.question_text, q.correct_answer, q.distractors, q.explanation,
           q.category_id, a.root_id, a.root_slug
    FROM questions q
    JOIN ancestry a ON a.cat_id = q.category_id
    WHERE q.status = 'published'
  ),
  -- Rank questions within each root in random order.
  ranked AS (
    SELECT p.*,
           ROW_NUMBER() OVER (PARTITION BY p.root_id ORDER BY random()) AS rn
    FROM pool p
  )
  SELECT r.id, r.question_text, r.correct_answer, r.distractors, r.explanation,
         r.category_id, r.root_slug AS category_slug
  FROM ranked r
  -- Round-robin: order by rank first so every root contributes 1 before any
  -- contributes 2. Roots with fewer questions just drop out of higher ranks,
  -- letting surplus roots fill the remaining slots (graceful shortfall).
  ORDER BY r.rn, random()
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION random_general_knowledge_questions(INT) TO anon, authenticated;
```

Important: PostgreSQL requires `WITH RECURSIVE` to precede the first CTE — if mixing non-recursive and recursive CTEs, place `RECURSIVE` once at the top (`WITH RECURSIVE ancestry AS (...), pool AS (...), ranked AS (...)`). Adjust the outline accordingly when writing the final SQL.

Do NOT hardcode any root slugs. Do NOT introduce new columns, tables, or taxonomy. Do NOT modify existing migrations.

Add a brief header comment describing the purpose and the round-robin strategy, matching the style of prior migrations.
  </action>
  <verify>
    <automated>test -f supabase/migrations/00016_random_general_knowledge_questions_rpc.sql && grep -q "random_general_knowledge_questions" supabase/migrations/00016_random_general_knowledge_questions_rpc.sql && grep -q "parent_id IS NULL" supabase/migrations/00016_random_general_knowledge_questions_rpc.sql && grep -q "GRANT EXECUTE ON FUNCTION random_general_knowledge_questions" supabase/migrations/00016_random_general_knowledge_questions_rpc.sql && grep -q "status = 'published'" supabase/migrations/00016_random_general_knowledge_questions_rpc.sql</automated>
  </verify>
  <done>
Migration file exists, defines the RPC with correct return shape, discovers roots dynamically via `parent_id IS NULL`, filters to published questions only, uses round-robin ordering, and grants EXECUTE to anon + authenticated.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Validate SQL via supabase db reset (or psql dry-run)</name>
  <files>supabase/migrations/00016_random_general_knowledge_questions_rpc.sql</files>
  <action>
Validate the migration runs cleanly against a local database. Prefer whichever tooling is already wired in this repo:

1. If Supabase CLI is available locally: `supabase db reset` (applies every migration from scratch) and confirm no errors.
2. If not: run the SQL through `psql` against a scratch database, or use `supabase db lint` if configured.
3. If neither is available in the current environment, at minimum run a syntax check by piping the file through `psql --set ON_ERROR_STOP=1 -f ... postgres://...` against any accessible dev DB; otherwise skip and record that validation is deferred to the local dev machine.

If errors surface (e.g. `WITH RECURSIVE` placement, ambiguous column names, missing semicolon), fix them in the migration file.

Once clean, do a smoke call: `SELECT COUNT(*), COUNT(DISTINCT category_slug) FROM random_general_knowledge_questions(20);` — expect COUNT ≤ 20 and DISTINCT category_slug > 1 (assuming the dev DB has questions in multiple roots). Record the result in the task notes.
  </action>
  <verify>
    <automated>grep -c "random_general_knowledge_questions" supabase/migrations/00016_random_general_knowledge_questions_rpc.sql</automated>
  </verify>
  <done>
Migration applies without errors against a local database (or validation deferred with a note). Smoke query returns balanced distribution across roots.
  </done>
</task>

</tasks>

<verification>
- `supabase/migrations/00016_random_general_knowledge_questions_rpc.sql` exists.
- Function name, signature, and return shape match the contract above.
- No hardcoded root slugs anywhere in the file.
- `GRANT EXECUTE ... TO anon, authenticated` present.
- SQL applies cleanly in a fresh database.
</verification>

<success_criteria>
- Running `SELECT * FROM random_general_knowledge_questions(20)` against a seeded dev DB returns up to 20 published questions with `category_slug` values spread across multiple root categories.
- No existing RPCs or tables modified.
- Plan completes within ~30% context.
</success_criteria>

<output>
After completion, create `.planning/quick/260418-stj-add-general-knowledge-quiz-mode-with-bal/260418-stj-01-SUMMARY.md`.
</output>
