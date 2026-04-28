---
phase: quick/260428-tao
plan: 01
subsystem: web
tags: [web, end-screen, ui, toggle, fun-facts]
requires: []
provides:
  - Round summary Show/hide facts toggle (End.tsx)
affects:
  - apps/web/src/screens/End.tsx
  - apps/web/src/screens/Play.tsx
  - apps/web/src/lib/show-facts.ts
tech-stack:
  added: []
  patterns:
    - useState boolean toggle for global show/hide
    - Conditional render of toggle (only when at least one fun_fact present)
    - Reused Play.tsx Lightbulb callout style verbatim
    - sessionStorage-backed cross-screen preference with SSR-safe guards
    - Icon-only faded header toggle (Eye/EyeOff) with aria-pressed + aria-label
key-files:
  created:
    - apps/web/src/lib/show-facts.ts
  modified:
    - apps/web/src/screens/End.tsx
    - apps/web/src/screens/Play.tsx
decisions:
  - Single global toggle (no per-row state) — fact-readers and fast-scanners both served
  - Toggle hidden entirely on End when no recap question has a fun_fact (avoid useless control)
  - Default state hidden (showFacts=false) so first render matches existing behaviour
  - sessionStorage (not localStorage) — preference resets on tab close, intentional scope
  - Play header toggle is icon-only and faded vs Exit button — visible but visually subordinate
metrics:
  duration: ~5min
  completed: 2026-04-28
---

# Quick Task 260428-tao: End Screen Show/Hide Facts Toggle Summary

One-liner: Added a single Show/Hide facts toggle to the End screen Round summary that reveals every recap row's `fun_fact` callout in lockstep, defaulting to hidden and rendered only when at least one row has a non-null fun_fact.

## What Changed

`apps/web/src/screens/End.tsx`:

1. Imports extended: `Lightbulb`, `Eye`, `EyeOff` added to the existing lucide-react import (line 3).
2. New state: `const [showFacts, setShowFacts] = useState(false);` (line 58).
3. New helper computed after `recap`: `const anyFunFacts = recap.some(({ q }) => Boolean(q.fun_fact));` (line 68).
4. Toggle button rendered inside the existing Round summary `<section>`, between the `<h2>` and the `<ol>`, only when `anyFunFacts` is true. Eye icon + "Show facts" by default; EyeOff icon + "Hide facts" when active. `aria-pressed` reflects state. Uses the same `bg-blue-50 border border-blue-100 text-blue-800` palette as the Play.tsx Lightbulb callout.
5. Per-row callout appended inside each `<li>` after the chosen/correct answer line, conditional on `showFacts && q.fun_fact`. Style is copied verbatim from the Play.tsx Lightbulb callout, plus `mt-2` to space it below the answer line.

Existing recap row markup (number prefix, `border-l-[6px]` outer `<li>`, question text, chosen/correct answer line) is untouched.

## Commit

| Hash | Message |
|------|---------|
| `0181ca0` | `feat(web): add show/hide facts toggle to End screen Round summary (260428-tao)` |

One commit on branch `260428-end-toggle-facts`. Branch has NOT been pushed — user previews locally first.

## Verification

- `cd apps/web && npx tsc --noEmit` → exit 0 (PASSED).
- `grep -n "showFacts" apps/web/src/screens/End.tsx` → 5 matches (state declaration, onClick handler, aria-pressed, icon ternary, label ternary, row conditional). Plan requires ≥3.
- `grep -n "Eye, EyeOff" apps/web/src/screens/End.tsx` → match on line 3 import.
- `grep -n "bg-blue-50 border border-blue-100" apps/web/src/screens/End.tsx` → match on line 216 (per-row callout).
- `grep -n 'border-l-\[6px\]' apps/web/src/screens/End.tsx` → match on line 197 (existing recap layout preserved).
- `grep -c "Lightbulb" apps/web/src/screens/End.tsx` → 2 (import + JSX). Plan requires ≥2.
- `git status` → clean (only the SUMMARY directory is untracked).
- Branch has no upstream — confirmed unpushed.

## Deviations from Plan

None — plan executed exactly as written.

## Reminder

Branch `260428-end-toggle-facts` is unpushed. Preview via the `web` MCP server at http://localhost:5199. Verify:

1. Round summary shows the Show/hide facts toggle at the top of the section (only when the round has at least one fun_fact).
2. Default state: facts hidden, button reads "Show facts" with Eye icon.
3. Click once: every row with a fun_fact reveals its blue Lightbulb callout below the answer line; button reads "Hide facts" with EyeOff icon.
4. Click again: callouts hide, button returns to "Show facts".
5. Rows with no fun_fact never render an empty callout, regardless of toggle state.
6. Existing row layout (number, 6px coloured border, question, chosen/correct answer) is unchanged.

## Self-Check: PASSED

- File `apps/web/src/screens/End.tsx` exists and compiles.
- Commit `0181ca0` exists on branch `260428-end-toggle-facts` (`git log -1 --oneline` confirmed).
- Branch unpushed (`git rev-parse --abbrev-ref @{u}` returns "no upstream configured").

---

# Task 2: Mirror toggle in Play header + persist across Play ↔ End

One-liner: Added a small `apps/web/src/lib/show-facts.ts` sessionStorage helper, wired both End.tsx and Play.tsx to read/write the same `pub-quiz:show-facts` key, and added an icon-only faded Eye/EyeOff toggle in the Play header (immediately before Exit) that gates both existing fun_fact callouts.

## What Changed (Task 2)

`apps/web/src/lib/show-facts.ts` (new):

- Two exports: `readShowFacts(): boolean` and `writeShowFacts(value: boolean): void`.
- Key constant: `pub-quiz:show-facts`. Stored as `'1'` / `'0'` string.
- SSR-safe: both helpers early-return with `typeof window === 'undefined'` guard.
- Storage access wrapped in `try/catch` — silently no-ops if sessionStorage is unavailable (private mode, sandboxed iframes).

`apps/web/src/screens/End.tsx`:

- Added `import { readShowFacts, writeShowFacts } from '@/lib/show-facts';` (line 8).
- Replaced `useState(false)` with `useState<boolean>(() => readShowFacts())` (line 59) so the End screen picks up whatever was set on Play.
- Updated toggle `onClick` to call `writeShowFacts(next)` alongside the state update (line 183) so toggling on End carries back to Play.
- No markup changes — only state plumbing.

`apps/web/src/screens/Play.tsx`:

- Extended lucide-react import on line 12 with `Eye, EyeOff`.
- Added `import { readShowFacts, writeShowFacts } from '@/lib/show-facts';` (line 13).
- Added `const [showFacts, setShowFacts] = useState<boolean>(() => readShowFacts());` (line 32) alongside the other useState calls.
- Wrapped the existing Exit button and the new toggle in a `<div className="inline-flex items-center gap-1">` so they sit flush right inside the header's `flex justify-between` row.
- New icon-only toggle button (line 220-229): `text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100`, `aria-pressed`, `aria-label`, Eye when hidden / EyeOff when shown. Faded compared to Exit so it reads as a secondary control.
- Both existing fun_fact callouts (revealed phase line 324, reviewing phase line 369) now render only when `showFacts && question.fun_fact` is true.
- Card/CardHeader/CardContent structure, Back button, Exit button markup, answer options, and the Lightbulb callout style itself are all untouched.

## Commit (Task 2)

| Hash | Message |
|------|---------|
| `3aad582` | `feat(web): mirror facts toggle in Play header + persist across Play↔End via sessionStorage (260428-tao)` |

Branch `260428-end-toggle-facts` now has 2 commits (Task 1 `0181ca0` + Task 2 `3aad582`). Branch has NOT been pushed — user previews locally first.

## Verification (Task 2)

- `cd apps/web && npx tsc --noEmit` → exit 0 (PASSED).
- `ls apps/web/src/lib/show-facts.ts` → file exists.
- `grep -n "readShowFacts" apps/web/src/screens/Play.tsx` → matches on lines 13, 32.
- `grep -n "readShowFacts" apps/web/src/screens/End.tsx` → matches on lines 8, 59.
- `grep -n "writeShowFacts" apps/web/src/screens/Play.tsx` → matches on lines 13, 224.
- `grep -n "writeShowFacts" apps/web/src/screens/End.tsx` → matches on lines 8, 183.
- `grep -n "showFacts && question.fun_fact" apps/web/src/screens/Play.tsx` → 2 matches (lines 324, 369) — both reveal phases gated.
- `grep -n "Eye, EyeOff" apps/web/src/screens/Play.tsx` → match on line 12.
- `grep -n "aria-pressed" apps/web/src/screens/Play.tsx` → match on line 225 (the new toggle).
- `grep -n "text-neutral-400" apps/web/src/screens/Play.tsx` → match on line 227 (faded toggle class).
- `git log -2 --oneline` → confirms 2 commits on branch.
- Branch unpushed.

## Deviations from Plan (Task 2)

None — plan executed exactly as written.

## Browser Preview Reminder (Task 2)

Branch `260428-end-toggle-facts` is unpushed. Preview at http://localhost:5199. Verify:

1. Play header shows a small faded Eye icon to the left of Exit, in every phase (`playing`, `revealed`, `reviewing`).
2. Clicking the icon flips it to EyeOff. Clicking again flips back to Eye. Hovering darkens it from `text-neutral-400` to `text-neutral-600`.
3. While `showFacts` is on, the blue Lightbulb fun_fact callout appears under the result banner in both `revealed` (after Lock In) and `reviewing` (Back-clicked) phases. While off, the callout is hidden.
4. Toggle on Play, finish the round → End screen's toggle is already in the "shown" state and the recap rows already display fun_facts. Reverse: toggle off on End, navigate back to a fresh Play → toggle is off there too.
5. Close the browser tab and reopen → toggle resets to off (sessionStorage scope).
6. No regressions on Card/CardHeader/CardContent layout, Back/Exit buttons, answer options, or the End screen's recap row markup.

## Self-Check (Task 2): PASSED

- File `apps/web/src/lib/show-facts.ts` exists.
- Files `apps/web/src/screens/End.tsx` and `apps/web/src/screens/Play.tsx` modified, both compile under strict TS.
- Commit `3aad582` exists on branch `260428-end-toggle-facts` (`git log -1 --oneline` confirmed).
- Branch unpushed.
