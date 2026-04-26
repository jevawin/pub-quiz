---
phase: 260426-czq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/00024_rpc_return_fun_fact.sql
  - apps/web/src/lib/questions.ts
  - apps/web/src/state/quiz.ts
  - apps/web/src/screens/Play.tsx
autonomous: false
requirements:
  - 260426-fct
must_haves:
  truths:
    - "RPC random_published_questions_excluding returns fun_fact column for every row"
    - "LoadedQuestion carries fun_fact: string | null end-to-end"
    - "Answer reveal screen shows fun_fact (when present) styled as a subdued italic note below explanation"
    - "Reveal screen renders nothing extra when fun_fact is null"
  artifacts:
    - path: "supabase/migrations/00024_rpc_return_fun_fact.sql"
      provides: "CREATE OR REPLACE of random_published_questions_excluding adding fun_fact TEXT to RETURNS TABLE and SELECT list"
      contains: "fun_fact TEXT"
    - path: "apps/web/src/lib/questions.ts"
      provides: "RpcRow + toLoadedQuestion mapping fun_fact through"
      contains: "fun_fact"
    - path: "apps/web/src/state/quiz.ts"
      provides: "LoadedQuestion.fun_fact field"
      contains: "fun_fact: string | null"
    - path: "apps/web/src/screens/Play.tsx"
      provides: "Render fun_fact on the revealed and reviewing branches"
      contains: "fun_fact"
  key_links:
    - from: "supabase migration 00024"
      to: "apps/web/src/lib/questions.ts RpcRow"
      via: "RPC return signature additions match RpcRow type"
      pattern: "fun_fact"
    - from: "apps/web/src/lib/questions.ts toLoadedQuestion"
      to: "apps/web/src/state/quiz.ts LoadedQuestion"
      via: "fun_fact passed in mapping object"
      pattern: "fun_fact: r.fun_fact"
    - from: "apps/web/src/screens/Play.tsx revealed branch"
      to: "question.fun_fact"
      via: "conditional render block under explanation"
      pattern: "question.fun_fact &&"
---

<objective>
Wire fun_fact from DB through the web quiz so users see a fact on each answer reveal.

Purpose: Every published question already has a non-null fun_fact (100% of 2848). The web RPC and types currently strip the field, so users see none of it. Adding it through is a thin pass-through with one new SQL migration, two type touches, and one render block.

Output: Migration 00024, updated questions.ts/quiz.ts types, fun_fact rendered on the per-question reveal in Play.tsx.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@apps/web/src/lib/questions.ts
@apps/web/src/state/quiz.ts
@apps/web/src/screens/Play.tsx
@supabase/migrations/00015_random_published_questions_excluding.sql

<interfaces>
Current RPC return signature in 00015 (must mirror in 00024 plus fun_fact):
```sql
RETURNS TABLE (
  id UUID,
  question_text TEXT,
  correct_answer TEXT,
  distractors JSONB,
  explanation TEXT,
  category_id UUID,
  category_slug TEXT
)
```

Current RpcRow (apps/web/src/lib/questions.ts:27-35):
```ts
type RpcRow = {
  id: string;
  question_text: string;
  correct_answer: string;
  distractors: string[];
  explanation: string | null;
  category_id: string;
  category_slug: string;
};
```

Current LoadedQuestion (apps/web/src/state/quiz.ts:1-8):
```ts
export type LoadedQuestion = {
  id: string;
  question_text: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
  category_slug: string;
};
```

The web app calls only one question-fetching RPC: `random_published_questions_excluding` (questions.ts:64). The older `random_general_knowledge_questions_rpc` is no longer called from web — the 'general' branch in `random_published_questions_excluding` handles it. Only that one RPC needs updating.

Render site: Play.tsx — the `revealed` branch (lines 282-326) and the `reviewing` branch (lines 328-368). Both render `question.explanation` in the same pattern. fun_fact should sit directly below explanation in both branches.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add migration 00024 returning fun_fact from random_published_questions_excluding</name>
  <files>supabase/migrations/00024_rpc_return_fun_fact.sql</files>
  <action>
    Create supabase/migrations/00024_rpc_return_fun_fact.sql.

    Contents: a single CREATE OR REPLACE FUNCTION for random_published_questions_excluding. Copy the function body from 00015_random_published_questions_excluding.sql exactly, then make these two changes:

    1. Append `fun_fact TEXT` as the last column in the RETURNS TABLE list.
    2. Append `q.fun_fact` as the last expression in the SELECT list (questions table is aliased as `q`).

    Keep the same signature (TEXT, TEXT, INT, UUID[]), same LANGUAGE/STABLE/SECURITY/search_path, same WHERE/ORDER/LIMIT, same GRANT EXECUTE line. Do NOT touch count_available_questions in this migration — it doesn't return rows.

    Add a brief leading comment: `-- Add fun_fact to random_published_questions_excluding return signature so the web client can render it on answer reveal.`

    Do not run or apply the migration in this task — Task 3 covers application + verification.
  </action>
  <verify>
    <automated>test -f supabase/migrations/00024_rpc_return_fun_fact.sql && grep -q "fun_fact TEXT" supabase/migrations/00024_rpc_return_fun_fact.sql && grep -q "q.fun_fact" supabase/migrations/00024_rpc_return_fun_fact.sql && grep -q "CREATE OR REPLACE FUNCTION random_published_questions_excluding" supabase/migrations/00024_rpc_return_fun_fact.sql</automated>
  </verify>
  <done>Migration file exists, references fun_fact in both the return signature and the select list, and is a CREATE OR REPLACE on the existing function.</done>
</task>

<task type="auto">
  <name>Task 2: Thread fun_fact through types and render on reveal</name>
  <files>apps/web/src/lib/questions.ts, apps/web/src/state/quiz.ts, apps/web/src/screens/Play.tsx</files>
  <action>
    Three small changes:

    1. apps/web/src/state/quiz.ts — add `fun_fact: string | null;` to the LoadedQuestion type (place it after `explanation`).

    2. apps/web/src/lib/questions.ts — add `fun_fact: string | null;` to the RpcRow type (after `explanation`). In `toLoadedQuestion`, include `fun_fact: r.fun_fact ?? null` in the returned object.

    3. apps/web/src/screens/Play.tsx — render fun_fact on both the `revealed` and `reviewing` branches, directly below the existing explanation block. Use the same paragraph-shaped pattern as explanation, but styled as a subdued italic note prefixed with a thin divider. Concrete JSX (paste once into the revealed branch, once into the reviewing branch, both directly after the `{question.explanation && ...}` block):

    ```tsx
    {question.fun_fact && (
      <div className="border-t border-neutral-200 pt-3">
        <p className="text-sm italic text-neutral-500">
          <span className="font-medium not-italic text-neutral-600">Fun fact:</span>{' '}
          {question.fun_fact}
        </p>
      </div>
    )}
    ```

    Do not change anything else in those files. Do not introduce `any`. Do not touch quiz-persist (sessionStorage round-trips a plain object so the new field rides along automatically — but if TypeScript flags a saved-state shape mismatch in quiz-persist.ts, add `fun_fact: string | null` to that shape too).
  </action>
  <verify>
    <automated>cd apps/web && npx tsc --noEmit && npx vitest run src/lib/questions.test.ts</automated>
  </verify>
  <done>tsc clean, existing questions.test.ts passes, fun_fact field is present in LoadedQuestion + RpcRow + toLoadedQuestion, both reveal branches in Play.tsx render the fun_fact block when non-null.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    - Migration 00024 adding fun_fact to random_published_questions_excluding return signature
    - LoadedQuestion + RpcRow updated to carry fun_fact: string | null
    - Play.tsx revealed and reviewing branches render a subdued italic "Fun fact: ..." block when present
  </what-built>
  <how-to-verify>
    1. Apply the migration to local Supabase: `cd supabase && supabase db push` (or whichever local-apply command this repo uses — check package.json scripts if unsure).
    2. Start the web app: `cd apps/web && npm run dev`.
    3. Open the dev URL, pick any category + difficulty, start a quiz.
    4. Answer the first question. On the reveal screen, confirm a "Fun fact:" line appears below the explanation, styled subdued/italic with a thin divider above.
    5. Hit Next, answer question 2, confirm a different fun_fact appears.
    6. Use the Back button to view a previous question's reveal — confirm fun_fact also appears in the reviewing branch.
    7. Open DevTools Network, find the random_published_questions_excluding response, confirm rows include a fun_fact field.

    Expected: every question shows a fun_fact (DB has 100% coverage). If any are missing, type "missing fun_fact on Q3" etc. so we can investigate.
  </how-to-verify>
  <resume-signal>Type "approved" once facts render on every reveal, or describe issues.</resume-signal>
</task>

</tasks>

<verification>
- Migration file exists at supabase/migrations/00024_rpc_return_fun_fact.sql
- `tsc --noEmit` clean in apps/web
- Existing questions.test.ts still green
- Manual walkthrough: fun_fact renders on both revealed and reviewing branches of Play.tsx
</verification>

<success_criteria>
After running a quiz against the local Supabase with migration 00024 applied, every answer reveal displays a fun fact below the explanation, styled as a subdued italic line. No TypeScript or test regressions.
</success_criteria>

<output>
After completion, create `.planning/quick/260426-czq-wire-fun-fact-through-to-web-quiz-ui/260426-czq-SUMMARY.md` with:
- Files changed
- Migration number used
- Confirmation that local walkthrough showed fun_fact on every reveal
- Any deviations from the plan
</output>
