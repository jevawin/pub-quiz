---
phase: 260426-myq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/src/screens/Play.tsx
autonomous: false
requirements:
  - 260426-fdb
must_haves:
  truths:
    - "Question bd6d71fb reads as a clear, unambiguous population question"
    - "Question c8a909d0 reads as a well-formed Greek myth question"
    - "Answer buttons in Play do not show a focus ring after a mouse click"
    - "Answer buttons still show a visible focus ring for keyboard (Tab) users"
    - "All three feedback rows are marked resolved with a note"
  artifacts:
    - path: "apps/web/src/screens/Play.tsx"
      provides: "Answer button using focus-visible (not focus) for the focus ring"
  key_links:
    - from: "answer button className"
      to: "Tailwind focus-visible utilities"
      via: "focus-visible:ring-* + focus:outline-none"
      pattern: "focus-visible:ring"
---

<objective>
Close 3 open `question_feedback` rows: 2 content rewrites (Indonesia population question, King Midas wording) and 1 CSS bug (answer button focus ring sticks after mouse click on every question).

Purpose: clean up flagged content and fix an accessibility/visual bug affecting every quiz question.

Output:
- 2 updated `questions` rows in Supabase
- 3 resolved `question_feedback` rows
- 1 patched `apps/web/src/screens/Play.tsx`
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@apps/web/src/screens/Play.tsx

<interfaces>
Answer button (Play.tsx ~line 258-269) currently:
```tsx
<button
  onClick={() => onSelect(i)}
  className={`w-full rounded-lg border p-3 text-left transition-colors ${
    isSelected
      ? 'border-neutral-900 bg-neutral-100 font-medium ring-2 ring-neutral-900'
      : 'border-neutral-300 hover:border-neutral-500 hover:bg-accent'
  }`}
>
```

The `ring-2 ring-neutral-900` on `isSelected` is the intentional selection indicator. The bug is the browser's native focus outline (and/or the selected ring) persisting after a mouse click, which looks identical to keyboard focus on a non-selected button. Fix is to suppress mouse-focus styling and only show a ring under `:focus-visible`.

Supabase REST PATCH pattern (from `pipeline/.env`):
```bash
set -a; source pipeline/.env; set +a
curl -s -X PATCH "$SUPABASE_URL/rest/v1/questions?id=eq.<id>" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{"question_text":"..."}'
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Rewrite 2 questions and resolve their feedback rows</name>
  <files>(no repo files — Supabase REST only)</files>
  <action>
Source `pipeline/.env` then run two PATCH pairs against Supabase REST.

Question 1 (id `bd6d71fb-546e-4048-b8bc-3602d40fbd31`):
- New `question_text`: "By population, which country has the largest Muslim population?"
- Leave `correct_answer` ("Indonesia") and distractors unchanged.

Resolve feedback `7bf118f1-0df7-4db0-9d52-1ab25d5f6072`:
- `resolved_at`: NOW (ISO 8601, e.g. `$(date -u +%Y-%m-%dT%H:%M:%SZ)`)
- `resolved_note`: "Reworded to specify population — answer (Indonesia) unchanged."

Question 2 (id `c8a909d0-8ab7-4503-86a3-c1287d5a39bc`):
- New `question_text`: "In Greek myth, what happened to King Midas's food and daughter when he touched them?"
- Leave correct answer ("They turned to gold") and distractors unchanged.

Resolve feedback `8897af88-6c97-408a-ab0e-f775ab2763ca`:
- `resolved_at`: NOW
- `resolved_note`: "Reworded for clarity — answer unchanged."

Use `Prefer: return=minimal` and confirm each PATCH returns HTTP 204.
  </action>
  <verify>
    <automated>
set -a; source pipeline/.env; set +a
curl -s "$SUPABASE_URL/rest/v1/questions?id=in.(bd6d71fb-546e-4048-b8bc-3602d40fbd31,c8a909d0-8ab7-4503-86a3-c1287d5a39bc)&select=id,question_text" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
curl -s "$SUPABASE_URL/rest/v1/question_feedback?id=in.(7bf118f1-0df7-4db0-9d52-1ab25d5f6072,8897af88-6c97-408a-ab0e-f775ab2763ca)&select=id,resolved_at,resolved_note" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
    </automated>
  </verify>
  <done>Both questions return new text; both feedback rows have non-null `resolved_at` and a `resolved_note`.</done>
</task>

<task type="auto">
  <name>Task 2: Fix answer button focus-visible styling in Play.tsx</name>
  <files>apps/web/src/screens/Play.tsx</files>
  <action>
In the answer button (around line 258-269), update the `className` so:
1. Mouse click never leaves a visible focus ring.
2. Keyboard `Tab` focus still shows a clear ring.
3. The existing `isSelected` `ring-2 ring-neutral-900` selection indicator stays intact.

Concrete change: append focus utilities to the base class string. Final className shape:

```tsx
className={`w-full rounded-lg border p-3 text-left transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-neutral-900 ${
  isSelected
    ? 'border-neutral-900 bg-neutral-100 font-medium ring-2 ring-neutral-900'
    : 'border-neutral-300 hover:border-neutral-500 hover:bg-accent'
}`}
```

Notes:
- `focus:outline-none` removes the native browser outline on any focus (mouse or keyboard). `focus-visible:ring-*` re-adds a clear ring for keyboard-only focus, preserving accessibility.
- Do NOT touch the `isSelected` ring — it is the intentional selection indicator, not the bug.
- Do NOT change the Lock In / Next buttons.

After editing, run the web typecheck/build to confirm no breakage.
  </action>
  <verify>
    <automated>cd apps/web && npx tsc --noEmit</automated>
  </verify>
  <done>Play.tsx has `focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-neutral-900` on answer button; tsc passes.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Human-verify CSS fix in localhost, then resolve feedback row</name>
  <what-built>
Patched answer button focus styling in Play.tsx. Mouse clicks should no longer leave a focus ring; keyboard Tab should still show one.
  </what-built>
  <how-to-verify>
1. Run `cd apps/web && npm run dev` and open the printed URL.
2. Start any quiz (any category).
3. With the mouse only: click an answer → click another answer → click Lock In. After each click, no answer button should look "highlighted as if tab-focused" (other than the intentional selected-state ring on the chosen one).
4. With the keyboard only: press Tab to walk through the answer buttons. Each focused button should show a clear neutral-900 ring with offset. This confirms accessibility is preserved.
5. Reply `approved` to continue, or describe what you see.
  </how-to-verify>
  <on-approval>
After approval, source `pipeline/.env` and PATCH feedback `6b5a1b37-3507-4858-afb8-0aff06a88c43`:
- `resolved_at`: NOW (ISO 8601)
- `resolved_note`: "Switched answer button focus styles to focus-visible — mouse click no longer leaves a ring; keyboard focus still shows one."

Verify with:
```bash
set -a; source pipeline/.env; set +a
curl -s "$SUPABASE_URL/rest/v1/question_feedback?id=eq.6b5a1b37-3507-4858-afb8-0aff06a88c43&select=id,resolved_at,resolved_note" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```
  </on-approval>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
- 2 questions show updated `question_text` in DB
- 3 `question_feedback` rows have `resolved_at` set and a `resolved_note`
- `apps/web/src/screens/Play.tsx` answer button uses `focus-visible:` for the ring
- `npx tsc --noEmit` passes in `apps/web`
- Human-verified in localhost: mouse click leaves no ring, keyboard Tab shows ring
</verification>

<success_criteria>
- All 3 open feedback items resolved
- No regression in answer button selection visuals
- Keyboard accessibility preserved (visible focus ring on Tab)
</success_criteria>

<output>
After completion, create `.planning/quick/260426-myq-fix-3-open-question-feedback-items/260426-myq-SUMMARY.md` with: rewritten question texts, file diff for Play.tsx, list of resolved feedback IDs.
</output>
