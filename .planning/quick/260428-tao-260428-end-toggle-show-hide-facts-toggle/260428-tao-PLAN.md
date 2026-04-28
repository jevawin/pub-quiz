---
phase: quick/260428-tao
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/src/screens/End.tsx
autonomous: true
requirements:
  - QT-260428-tao-01
must_haves:
  truths:
    - "Round summary shows a single Show/Hide facts toggle at the top of the section"
    - "Toggle defaults to HIDDEN on first render"
    - "Clicking the toggle reveals the fun_fact for every recap row that has one"
    - "Clicking again hides every fun_fact"
    - "Recap rows without a fun_fact (null) never render an empty callout"
    - "Existing recap layout (number, 6px coloured border, question, chosen/correct answer) is unchanged"
    - "npx tsc --noEmit passes from apps/web"
  artifacts:
    - path: "apps/web/src/screens/End.tsx"
      provides: "Round summary with Show/hide facts toggle"
      contains: "useState"
    - path: "apps/web/src/screens/End.tsx"
      provides: "Lucide Eye + EyeOff imports for toggle icon"
      contains: "Eye"
  key_links:
    - from: "End.tsx toggle button"
      to: "showFacts state"
      via: "onClick toggles boolean, conditional render of fun_fact callout per row"
      pattern: "showFacts"
    - from: "End.tsx fun_fact callout"
      to: "Play.tsx Lightbulb callout"
      via: "shared style classes"
      pattern: "bg-blue-50 border border-blue-100"
---

<objective>
Add a single Show/Hide facts toggle at the top of the Round summary section in End.tsx. One click reveals or hides the fun_fact callout for every recap row that has one. Default state is hidden.

Purpose: Round summary currently shows the answer recap only. fun_facts are visible during play (Play.tsx Lightbulb callout) but disappear at the end. Fact-readers want a way to revisit them; fast-scanners do not want extra noise. A single global toggle satisfies both — no per-row state needed.

Output: Updated End.tsx with one new `useState` (`showFacts`), a Lucide Eye/EyeOff toggle button rendered above the recap list, and a conditional fun_fact callout per row that mirrors the Play.tsx Lightbulb style exactly.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@apps/web/src/screens/End.tsx
@apps/web/src/screens/Play.tsx
@apps/web/src/state/quiz.ts

<interfaces>
<!-- Key types and patterns the executor needs. Already on disk — no exploration required. -->

From apps/web/src/state/quiz.ts:
```typescript
export type LoadedQuestion = {
  id: string;
  question_text: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
  fun_fact: string | null;       // <-- the field we conditionally reveal
  category_slug: string;
};
```

From apps/web/src/screens/Play.tsx (the callout style to copy verbatim):
```tsx
{question.fun_fact && (
  <div className="flex gap-3 rounded-lg bg-blue-50 border border-blue-100 p-3">
    <Lightbulb className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
    <p className="text-base text-blue-800">{question.fun_fact}</p>
  </div>
)}
```

From apps/web/src/screens/End.tsx (current Round summary structure to preserve):
```tsx
{recap.length > 0 && (
  <section className="mt-12">
    <h2 className="text-xl font-semibold mb-4">Round summary</h2>
    <ol className="space-y-2">
      {recap.map(({ q, a }, i) => { /* existing row, do NOT change */ })}
    </ol>
  </section>
)}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Add showFacts state, toggle button, and conditional fun_fact callout to Round summary</name>
  <files>apps/web/src/screens/End.tsx</files>
  <behavior>
    - Default render: toggle visible labelled "Show facts" with Eye icon; no fun_fact callouts visible on any row.
    - After one click: label flips to "Hide facts" with EyeOff icon; every recap row whose `q.fun_fact` is truthy renders a Lightbulb callout below the chosen/correct line.
    - After second click: returns to default — facts hidden, label back to "Show facts" with Eye icon.
    - Rows with `q.fun_fact === null` never render the callout, regardless of toggle state (no empty divs).
    - Existing recap row layout (number, 6px coloured border, question text, chosen/correct answer line) is untouched.
    - The toggle is rendered ONLY when at least one recap question has a non-null fun_fact (avoid showing a useless toggle if no facts exist for the round). LOCKED by user — do not make this always-on.
  </behavior>
  <action>
    Edit `apps/web/src/screens/End.tsx`:

    1. **Imports**: extend the existing lucide-react import on line 3 to include `Lightbulb`, `Eye`, and `EyeOff`:
       ```ts
       import { Smile, Meh, Frown, Play, Send, Lightbulb, Eye, EyeOff } from 'lucide-react';
       ```

    2. **State**: add a new `useState<boolean>` near the existing useState calls (around lines 54-57). Default MUST be `false` (hidden):
       ```ts
       const [showFacts, setShowFacts] = useState(false);
       ```

    3. **Compute helper** (just above `return` or just after `recap` is built around line 67): determine if any fact is available so the toggle can be conditionally rendered:
       ```ts
       const anyFunFacts = recap.some(({ q }) => Boolean(q.fun_fact));
       ```

    4. **Toggle button**: inside the existing `{recap.length > 0 && (<section className="mt-12">...)}` block (line 174), keep the `<h2>` heading, then insert the toggle BEFORE the `<ol>`. Render it only when `anyFunFacts` is true. Use the same blue accent palette as the Play.tsx Lightbulb callout (text-blue-800 / blue-600 icon). Recommended markup:
       ```tsx
       {anyFunFacts && (
         <button
           type="button"
           onClick={() => setShowFacts((v) => !v)}
           className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-blue-100 bg-blue-50 px-3 py-1.5 text-base text-blue-800 hover:bg-blue-100 transition-colors"
           aria-pressed={showFacts}
         >
           {showFacts ? <EyeOff className="h-4 w-4 text-blue-600" /> : <Eye className="h-4 w-4 text-blue-600" />}
           {showFacts ? 'Hide facts' : 'Show facts'}
         </button>
       )}
       ```
       All text is `text-base` (≥16px) per constraint.

    5. **Per-row fun_fact callout**: inside the `recap.map(...)` row (the existing `<li>` around lines 182-203), AFTER the existing `<p className="mt-1 text-base flex flex-wrap gap-x-2">...</p>` line and still inside the `<li>`, append a conditional callout that renders only when `showFacts && q.fun_fact` is true. Copy the Play.tsx Lightbulb callout style verbatim, plus a small top margin to separate from the answer line:
       ```tsx
       {showFacts && q.fun_fact && (
         <div className="mt-2 flex gap-3 rounded-lg bg-blue-50 border border-blue-100 p-3">
           <Lightbulb className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
           <p className="text-base text-blue-800">{q.fun_fact}</p>
         </div>
       )}
       ```

    6. **Do NOT** change the recap row's outer `<li>` classes (border-l-[6px], bg-white, pl-3 py-2 pr-2, border colour) — preserve the recap layout exactly.
    7. **Do NOT** add per-row toggle state, per-row buttons, or any animation library.
    8. **Do NOT** push the branch. Commit only.

    Commit message: `feat(web): add show/hide facts toggle to End screen Round summary (260428-tao)`
  </action>
  <verify>
    <automated>cd apps/web && npx tsc --noEmit</automated>
  </verify>
  <done>
    - File compiles with `npx tsc --noEmit` from apps/web (zero errors).
    - Grep confirms changes:
      - `grep -n "showFacts" apps/web/src/screens/End.tsx` shows useState declaration + toggle button + conditional callout (3+ matches).
      - `grep -n "Eye, EyeOff" apps/web/src/screens/End.tsx` confirms imports added.
      - `grep -n "bg-blue-50 border border-blue-100" apps/web/src/screens/End.tsx` confirms shared callout style used.
    - Existing recap row markup is unchanged: `grep -n 'border-l-\[6px\]' apps/web/src/screens/End.tsx` still matches the same `<li>` line.
    - Git: one commit on the current branch with message starting `feat(web): add show/hide facts toggle to End screen`. No `git push`.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Mirror toggle in Play header (icon-only, faded) and persist preference across Play ↔ End via sessionStorage</name>
  <files>apps/web/src/screens/Play.tsx, apps/web/src/screens/End.tsx, apps/web/src/lib/show-facts.ts</files>
  <behavior>
    - Single global "show facts" preference shared by Play and End screens.
    - Default state: HIDDEN. Persisted to sessionStorage so toggling on Play carries to End and vice versa within a browser tab session.
    - Resets on browser tab close (sessionStorage scope — intentional, not localStorage).
    - On Play header (right side, immediately before Exit button): icon-only toggle, always visible across all phases (`playing`, `revealed`, `reviewing`).
    - Eye icon when facts hidden; EyeOff icon when facts shown — icon alone signals state, no text label.
    - Style: more faded than the Exit button. Use `text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100`. Same px/py spacing as Exit button so the row stays visually aligned.
    - Both existing fun_fact callouts in Play.tsx (lines 311-316 inside `revealed` block AND lines 356-361 inside `reviewing` block) become conditional on the global `showFacts` state.
    - End screen toggle from Task 1 reads/writes the same sessionStorage key — no behaviour change to user-visible markup, only state plumbing.
    - Toggling on either screen updates the other on next render (React state per component, but initial value pulled from sessionStorage means the effect is "feels global within a tab").
    - Aria: toggle button has `aria-pressed={showFacts}` and `aria-label={showFacts ? 'Hide facts' : 'Show facts'}` for screen readers, since icon-only.
  </behavior>
  <action>
    Create a small shared helper, then wire it into both screens.

    1. **Create `apps/web/src/lib/show-facts.ts`** — minimal helper around sessionStorage. No deps. Strict TS:
       ```ts
       const KEY = 'pub-quiz:show-facts';

       export function readShowFacts(): boolean {
         if (typeof window === 'undefined') return false;
         try {
           return window.sessionStorage.getItem(KEY) === '1';
         } catch {
           return false;
         }
       }

       export function writeShowFacts(value: boolean): void {
         if (typeof window === 'undefined') return;
         try {
           window.sessionStorage.setItem(KEY, value ? '1' : '0');
         } catch {
           // sessionStorage unavailable — silently no-op
         }
       }
       ```

    2. **Update `apps/web/src/screens/End.tsx`** (from Task 1):
       - Replace `const [showFacts, setShowFacts] = useState(false);` with:
         ```ts
         import { readShowFacts, writeShowFacts } from '@/lib/show-facts';
         // ...
         const [showFacts, setShowFacts] = useState<boolean>(() => readShowFacts());
         ```
       - Update the toggle's onClick to also persist:
         ```ts
         onClick={() => setShowFacts((v) => { const next = !v; writeShowFacts(next); return next; })}
         ```
       - No other markup changes.

    3. **Update `apps/web/src/screens/Play.tsx`**:
       - Add imports:
         - extend the lucide-react import on line 12 to include `Eye` and `EyeOff`:
           ```ts
           import { CheckCircle, XCircle, LogOut, X, ChevronLeft, ArrowRight, Lock, Lightbulb, Eye, EyeOff } from 'lucide-react';
           ```
         - add `import { readShowFacts, writeShowFacts } from '@/lib/show-facts';`
       - Add state alongside the other useState calls (around lines 27-30):
         ```ts
         const [showFacts, setShowFacts] = useState<boolean>(() => readShowFacts());
         ```
       - In the header `<div className="mb-4 flex items-center justify-between">` (line 204), insert the toggle button INSIDE the right-side group, immediately BEFORE the Exit button (line 219). To keep the layout valid, wrap the right side in an `inline-flex items-center gap-1` container if it isn't already a flex group, or sit the toggle as a sibling of the Exit button — either works since the parent is `flex justify-between`. Recommended: wrap both in a `<div className="inline-flex items-center gap-1">` so they sit together flush right.
       - Toggle markup (icon-only, faded, aria-labelled):
         ```tsx
         <button
           type="button"
           onClick={() => setShowFacts((v) => { const next = !v; writeShowFacts(next); return next; })}
           aria-pressed={showFacts}
           aria-label={showFacts ? 'Hide facts' : 'Show facts'}
           className="inline-flex items-center justify-center rounded-md p-1.5 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
         >
           {showFacts ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
         </button>
         ```
       - Wrap BOTH existing fun_fact callouts to depend on `showFacts`:
         - Line 311 — change `{question.fun_fact && (` to `{showFacts && question.fun_fact && (`
         - Line 356 — change `{question.fun_fact && (` to `{showFacts && question.fun_fact && (`
       - Do NOT change the existing Exit button markup, the Back button, or any answer/option markup.
       - Do NOT touch the Card/CardHeader/CardContent structure.
    4. Verify with `cd apps/web && npx tsc --noEmit` — must exit 0.
    5. Commit message: `feat(web): mirror facts toggle in Play header + persist across Play↔End via sessionStorage (260428-tao)`
    6. Do NOT push.
  </action>
  <verify>
    <automated>cd apps/web && npx tsc --noEmit</automated>
  </verify>
  <done>
    - `apps/web/src/lib/show-facts.ts` exists with `readShowFacts` + `writeShowFacts` exports.
    - `grep -n "readShowFacts" apps/web/src/screens/Play.tsx` and `grep -n "readShowFacts" apps/web/src/screens/End.tsx` both match (state initialized from sessionStorage on both screens).
    - `grep -n "writeShowFacts" apps/web/src/screens/Play.tsx` and `grep -n "writeShowFacts" apps/web/src/screens/End.tsx` both match (state persisted on toggle).
    - `grep -n "showFacts && question.fun_fact" apps/web/src/screens/Play.tsx` matches twice (both reveal phases gated).
    - `grep -n "Eye, EyeOff" apps/web/src/screens/Play.tsx` confirms imports added.
    - `grep -n "aria-pressed" apps/web/src/screens/Play.tsx` matches the new toggle.
    - `grep -n "text-neutral-400" apps/web/src/screens/Play.tsx` matches the toggle's faded class.
    - `npx tsc --noEmit` from apps/web exits 0.
    - Git: one new commit on `260428-end-toggle-facts` (so the branch now has 2 commits — Task 1 + Task 2). No push.
  </done>
</task>

</tasks>

<verification>
1. `cd apps/web && npx tsc --noEmit` exits 0.
2. `grep -c "showFacts" apps/web/src/screens/End.tsx` returns ≥ 3 (state, toggle onClick, row conditional).
3. `grep -c "Lightbulb" apps/web/src/screens/End.tsx` returns ≥ 2 (import + JSX).
4. `git log -1 --oneline` shows the new commit; `git status` is clean.
5. Branch has NOT been pushed (no `git push` in the executor's command history).
</verification>

<success_criteria>
- End.tsx Round summary section renders a single toggle when any recap question has a fun_fact.
- Default state hides all fun_fact callouts.
- Toggling reveals/hides every fun_fact callout in lockstep — no per-row state.
- Callout style matches Play.tsx Lightbulb callout exactly (`bg-blue-50 border border-blue-100`, `text-blue-600` icon, `text-blue-800` body).
- Existing recap layout untouched.
- TypeScript strict mode passes.
- Branch NOT pushed; ready for user to preview at http://localhost:5199.
</success_criteria>

<output>
After completion, create `.planning/quick/260428-tao-260428-end-toggle-show-hide-facts-toggle/260428-tao-SUMMARY.md` capturing:
- Files modified (apps/web/src/screens/End.tsx)
- Commit SHA + message
- Confirmation that `npx tsc --noEmit` passed
- Reminder that branch is unpushed and the user will preview via the `web` MCP server at http://localhost:5199
</output>
