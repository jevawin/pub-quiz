---
phase: 260427-prm
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - pipeline/src/agents/questions.ts
  - .planning/quick/260427-prm-questions-agent-prompt-nudges/260427-prm-SUMMARY.md
  - .planning/ROADMAP.md
  - .planning/STATE.md
autonomous: false
requirements:
  - ROADMAP-C1-260427-prm
---

<objective>
Three small Questions Agent SYSTEM_PROMPT edits in one commit. Closes ROADMAP C1 entry 260427-prm.

1. Cap year-of-creation/release question density (feedback `17e9f94e`).
2. British English bias for vocabulary + spellings (feedback `cbdfa600`).
3. Expand acronyms on first use (feedback `ced3bb1b`).

Pure prompt edit. No schema, no pipeline wiring, no live spend (pipeline budget is locked). Verification by prompt-diff inspection — same approach as prior task 260419-pma.
</objective>

<context>
- File: `pipeline/src/agents/questions.ts` — module-level `SYSTEM_PROMPT` string (starts line 16).
- Prior reference: 260419-pma (commits c257dfc, 794a422, fa8158a) tightened the same prompt for tone.
- Tests in `pipeline/src/agents/__tests__/questions-multi.test.ts` do not assert against prompt text — safe to edit.
- Live pipeline budget is locked; no dry-run generation against real categories.
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Add British English directive, year-of-release cap, and acronym-expansion rule to Questions Agent SYSTEM_PROMPT</name>
  <files>pipeline/src/agents/questions.ts</files>
  <action>
Three additions to the SYSTEM_PROMPT string only (no logic changes):

A. **British English** — new H2 section between "Audience" and "Tone — classic UK pub quiz". Cover both vocabulary (football/lift/aubergine/lorry/pavement/petrol/biscuit/trainers/holiday/autumn/maths) and spellings (-ise, -our, -re, -ogue, travelled, grey). Apply to question, distractors, explanation.

B. **Acronym expansion** — new Rule 8 under "## Rules". Pattern: "FBI (Federal Bureau of Investigation)" on first use in question text. Carve out universally known acronyms (NASA, BBC, UK, US, EU). Acronyms in answers don't need expansion if the question already established context.

C. **Year-of-creation cap** — new line at top of "## Anti-Patterns (never do these)". Soft cap ≈1-in-10 batch shape. Encourage variety: who, where, how many, which, what feature. Allow override only when the year itself is the iconic fact.
  </action>
  <verify>
- Read SYSTEM_PROMPT diff. All three additions present and well-placed.
- `npx tsc --noEmit` produces no NEW errors (existing test-file moduleResolution errors are pre-existing).
  </verify>
  <done>
- File modified.
- Pre-existing tests still load (no syntax break in the template literal).
- SUMMARY.md captures the diff for review.
  </done>
</task>

</tasks>
