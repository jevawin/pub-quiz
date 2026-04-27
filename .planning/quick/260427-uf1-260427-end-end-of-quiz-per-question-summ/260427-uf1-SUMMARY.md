---
phase: quick-260427-uf1
plan: 01
subsystem: web
tags: [web, ui, end-screen, recap]
status: awaiting-human-verify
requires: []
provides:
  - End screen per-question recap (numbered, chosen vs correct, correct/incorrect signal)
affects:
  - apps/web/src/screens/Play.tsx (forwards questions in router state)
  - apps/web/src/screens/End.tsx (renders recap list)
tech-stack:
  added: []
  patterns: []
key-files:
  created: []
  modified:
    - apps/web/src/screens/Play.tsx
    - apps/web/src/screens/End.tsx
decisions:
  - Index-aligned mapping of answers[i] to questions[i] (Play pushes one AnswerRecord per question in order)
  - Recap kept minimal (question + chosen + correct only); fun_fact/explanation toggle deferred to a separate quick task
  - Widened End container from max-w-lg to max-w-2xl so recap reads comfortably on desktop
metrics:
  duration: ~3min
  completed: 2026-04-27
---

# Quick 260427-uf1: End-of-Quiz Per-Question Summary

End screen now shows a numbered recap of every question between the score line and the rating UX, with chosen answer, correct answer (if wrong), and a green check / red x per row.

## What Changed

### Task 1: Forward questions to End and render recap (auto) — DONE

**Commit:** e4429ba

**apps/web/src/screens/Play.tsx**
- Added `questions: state.questions` to the `navigate('/done', { state })` call alongside the existing `score`, `config`, `startedAt`, `answers`.

**apps/web/src/screens/End.tsx**
- Imported `Check, X` from `lucide-react` and `LoadedQuestion, AnswerRecord` from `@/state/quiz`.
- Widened `EndState` to include `questions: LoadedQuestion[]` and `answers: AnswerRecord[]`.
- Built `recap` array by index-pairing `questions[i]` with `answers[i]` (with a length-equality guard).
- Rendered an `<ol>` between the score paragraph and the rating block. Each `<li>` shows:
  - Number, correct/incorrect icon, question text
  - "Your answer: …" (green if correct, red if wrong)
  - "Correct answer: …" (only when the user got it wrong)
  - Left border colour mirrors the result (green-600 / red-600)
- Changed root container from `max-w-lg` to `max-w-2xl`.
- Rating buttons, feedback textarea, Submit, "Thanks for the feedback!", and Play Again are unchanged.

### Task 2: Human verify recap in browser (checkpoint) — AWAITING USER

Verification steps live in the PLAN. Dev server should already be running. User should:
1. Start a quiz from `/`, play 5 questions getting some wrong on purpose.
2. Confirm score at top, numbered recap below, rating + feedback + Play Again unchanged.
3. Refresh the End page directly — should redirect to `/`.
4. Layout reads cleanly at narrow and wide widths.

## Verification Run

- `cd apps/web && ./node_modules/.bin/tsc --noEmit` → exit 0, clean.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- FOUND: apps/web/src/screens/End.tsx (modified, recap renders)
- FOUND: apps/web/src/screens/Play.tsx (modified, questions forwarded)
- FOUND: commit e4429ba on branch 260427-end-quiz-summary
