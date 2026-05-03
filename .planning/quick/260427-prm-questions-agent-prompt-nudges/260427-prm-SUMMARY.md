---
phase: 260427-prm
status: complete
date: 2026-05-03
---

# 260427-prm — Questions Agent prompt nudges

Three SYSTEM_PROMPT additions in `pipeline/src/agents/questions.ts` to address three feedback signals at once.

## What changed

### 1. British English bias (feedback `cbdfa600`)

New `## British English` section between `## Audience` and `## Tone`. Vocabulary list (football/lift/aubergine/lorry/pavement/petrol/biscuit/trainers/holiday/autumn/maths) plus spelling rules (-ise, -our, -re, -ogue, travelled, grey). Applies to question text, distractors, and explanations.

### 2. Acronym expansion on first use (feedback `ced3bb1b`)

New Rule 8 under `## Rules`. Pattern: `"FBI (Federal Bureau of Investigation)"` on first use in question text. Carve-out for universally known acronyms (NASA, BBC, UK, US, EU). Acronyms in answers don't need expansion if the question already established context.

### 3. Year-of-creation cap (feedback `17e9f94e`)

New first bullet under `## Anti-Patterns (never do these)`. Soft cap of ~1-in-10 batch shape for "in what year was X released/created/founded/published" questions. Encourages variety: who, where, how many, which, what feature. Override allowed only when the year itself is the iconic fact.

## Verification approach

Per the task brief, no live pipeline run (budget locked for new generation only) and no 20-sample dry-run — overkill for a soft prompt edit.

- Prompt diff inspected and matches intent (see `git show` for this commit).
- `npx tsc --noEmit` produces no NEW errors. Pre-existing ESM-extension errors in `src/__tests__/`, `src/agents/__tests__/`, and `src/lib/__tests__/` are unrelated to this change (drift in test imports).
- No tests assert against `SYSTEM_PROMPT` content, so no test fixtures required updating.

## Style reference

Same intervention shape as 260419-pma (commits c257dfc, 794a422, fa8158a) — module-level `SYSTEM_PROMPT` literal, additive sections, no logic touched.

## Roadmap effect

- `C1. 260427-prm` → moved to `D4. Resolved quick-task specs` with `RESOLVED 2026-05-03 via 260427-prm` marker.
- STATE.md `Quick Tasks Completed` table gains a row for 260427-prm.
