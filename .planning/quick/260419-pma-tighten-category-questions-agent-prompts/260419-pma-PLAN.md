---
phase: 260419-pma
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - pipeline/src/agents/category.ts
  - pipeline/src/agents/questions.ts
  - .planning/quick/260419-pma-tighten-category-questions-agent-prompts/260419-pma-SUMMARY.md
autonomous: false
requirements:
  - BACKLOG-999.3
  - BACKLOG-999.4
must_haves:
  truths:
    - "Category Agent system prompt rejects academic/technical-feeling roots (e.g. Thermodynamics) while still allowing niche leaves (e.g. Harry Potter > Quidditch)"
    - "Questions Agent system prompt produces classic UK pub quiz tone — answer-first, conversational, no comprehension framing"
    - "Questions Agent no longer produces 'according to the source'-style comprehension questions"
    - "20 before/after Questions Agent samples from one seed category are captured in SUMMARY.md for qualitative comparison"
    - "User approves tone shift after reviewing the side-by-side samples"
  artifacts:
    - path: "pipeline/src/agents/category.ts"
      provides: "Updated Category Agent system prompt with pub-quiz suitability criteria for root/mid levels"
      contains: "pub-quiz suitability, academic/technical rejection, niche-at-leaves allowance"
    - path: "pipeline/src/agents/questions.ts"
      provides: "Updated Questions Agent system prompt with classic UK pub-quiz tone and answer-first framing"
      contains: "answer-first phrasing, conversational examples, explicit ban on source-citing framing"
    - path: ".planning/quick/260419-pma-tighten-category-questions-agent-prompts/260419-pma-SUMMARY.md"
      provides: "20 before/after sample pairs plus approval record"
      contains: "before block, after block, seed category, verdict"
  key_links:
    - from: "pipeline/src/agents/questions.ts SYSTEM_PROMPT"
      to: "QA Agent downscore rules in pipeline/src/agents/qa.ts"
      via: "shared tone vocabulary (answer-first, no 'according to the reference', 40-80 char target, UK pub audience)"
      pattern: "answer-first|according to the reference|40-80 characters|Manchester pub"
    - from: "pipeline/src/agents/category.ts SYSTEM_PROMPT"
      to: "PROJECT.md core value (deeply nested niche categories)"
      via: "depth-aware suitability — strict at root/mid, permissive at leaf"
      pattern: "root|leaf|depth|niche"
---

<objective>
Tighten the Category Agent and Questions Agent system prompts so the generated library feels like a classic UK pub quiz. Closes ROADMAP backlog items 999.3 (Category Agent tone) and 999.4 (Questions Agent tone).

Purpose: The existing prompts already have pub-quiz framing but leak academic feel at the category level and occasional comprehension-test framing at the question level. This plan does prompt-only edits — no schema, no pipeline wiring — and verifies via a dry-run diff on a single seed category.

Output: Updated system prompts in category.ts and questions.ts plus a SUMMARY.md with 20 before/after question samples.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/260419-pma-tighten-category-questions-agent-prompts/260419-pma-CONTEXT.md
@pipeline/src/agents/category.ts
@pipeline/src/agents/questions.ts
@pipeline/src/agents/qa.ts

<interfaces>
Both agents export runXAgent(config, tokenAccumulator) and use a module-level system prompt string. Only the prompt string changes — no exports, no schemas, no call sites.

Category Agent prompt (category.ts, lines 108-134): currently has "Pub Test", Naming, Scope, What Works/Doesn't Work, Balance sections. Good starting point — needs a depth-aware rule making it strict at root/mid (no Thermodynamics) and permissive at leaf (Quidditch is fine as a specialist leaf under Harry Potter).

Questions Agent prompt (questions.ts, lines 16-81): currently has Audience, Rules, Difficulty, Double-Up, Anti-Patterns. The anti-pattern "NEVER reference source material" exists but questions still leak comprehension framing. Strengthen with answer-first guidance and a concrete good/bad pair for source-citing framing.

QA Agent (qa.ts) already downscores "according to the reference material" language — use matching vocabulary in the Questions Agent prompt so upstream and downstream agree.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Tighten Category Agent system prompt for pub-quiz suitability at root/mid levels</name>
  <files>pipeline/src/agents/category.ts</files>
  <action>
Edit only the `systemPrompt` string (starts line 108, ends line 134). Keep structure (Pub Test, Naming, Scope, What Works, What Doesn't, Balance). Changes:

1. Add a "Depth Rule" section stating:
   - At depth 0 (root) and depth 1 (mid): MUST pass the pub test. Reject academic-discipline names (Thermodynamics, Epistemology, Macroeconomics), technical-sounding topics, and vague genre labels without an angle.
   - At depth 2-3 (leaf/specialist): niche is OK as opt-in specialist rounds (Harry Potter > Quidditch is fine, Star Wars > Expanded Universe Novels is fine). Users only play leaves they explicitly pick.

2. In the Bad examples list, replace or add at least one academic-at-root example that mirrors the CONTEXT spec: "Thermodynamics (academic discipline at root — belongs as a leaf under Science > Famous Experiments at most, not a round on its own)".

3. In What Works, add a note that niche leaves ARE welcome (Quidditch, Pokemon Types, Middle-Earth Geography) — this keeps the PROJECT.md niche-topics promise intact.

4. Keep the final line referencing `pipeline/CATEGORY-GUIDE.md`.

Claude has discretion on exact wording. Stay under ~40 lines of prompt. Do NOT change the user prompt, schema, or any code outside the string literal.

Per CONTEXT decision "Niche category stance": prune academic/technical at top/mid, keep niche leaves.
  </action>
  <verify>
    <automated>cd pipeline && npm run typecheck && npm test -- agents/category 2>&1 | tail -20</automated>
  </verify>
  <done>systemPrompt string contains a Depth Rule distinguishing root/mid from leaf; academic-at-root example added to Bad list; niche-leaf allowance noted in What Works; typecheck and any existing category tests pass.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Tighten Questions Agent system prompt for classic UK pub-quiz tone</name>
  <files>pipeline/src/agents/questions.ts</files>
  <action>
Edit only the `SYSTEM_PROMPT` constant (lines 16-81). Keep structure (Audience, Rules, Difficulty, Double-Up, Anti-Patterns). Changes:

1. Add a new "Tone" section before Rules (or fold into Audience):
   - Classic UK pub quiz. Conversational, answer-first phrasing. You are a quizmaster talking to a table of friends, not a teacher setting a comprehension test.
   - Good (include inline): "Who scored England's 1966 World Cup hat-trick?" — Geoff Hurst. Broad appeal, answer-first, one breath.
   - Bad (include inline): "According to the reference material, what does paragraph 3 say about Geoff Hurst's achievements?" — textbook comprehension, banned.

2. Strengthen Anti-Patterns:
   - Replace "Referencing source material in the question text" with more explicit wording: "Comprehension-test framing. Never phrase questions as 'according to the source/reference/text/article/paragraph'. The player is at a pub, not reading an exam paper." — matches QA Agent vocabulary in qa.ts.
   - Add: "Hedged or indirect openers ('It is said that...', 'One might argue that...'). Open with the subject or the verb."

3. Add a one-liner at the top of Rules: "Favour questions a table of 3+ ordinary adults would have a genuine shot at. Niche-specialist knowledge belongs in niche category rounds, not general ones." — this is prompt guidance only; no hard-reject logic per CONTEXT decision "Breadth rule".

4. Optional (Claude discretion): add 2-3 more inline good/bad pairs if it fits without pushing prompt length past ~100 lines. Token budget: system prompt + user prompt + 4096 max_tokens must still fit comfortably.

Keep the final line referencing Open Trivia Database and `pipeline/STYLE-GUIDE.md`. Do NOT change the user prompt, schema, validation logic, or insert code.

Per CONTEXT decisions: "Tone reference" (classic UK pub quiz, answer-first, example-driven) and "Breadth rule" (prompt guidance only, no hard rejection — QA Agent handles feedback).
  </action>
  <verify>
    <automated>cd pipeline && npm run typecheck && npm test -- agents/questions 2>&1 | tail -20</automated>
  </verify>
  <done>SYSTEM_PROMPT contains explicit Tone guidance with good/bad pair, comprehension-framing ban uses same vocabulary as QA Agent, breadth one-liner added to Rules; typecheck and existing questions tests pass.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Dry-run Questions Agent on one seed category, capture 20 before/after samples, user approves tone shift</name>
  <files>.planning/quick/260419-pma-tighten-category-questions-agent-prompts/260419-pma-SUMMARY.md</files>
  <action>
Two-stage execution:

STAGE A (Claude automates before committing to the prompt change):
1. Pick a seed category from the live DB that has a history of mixed-quality questions, or fall back to a broad root like "History" or "General Knowledge". Claude's discretion — document the choice in SUMMARY.md.
2. BEFORE samples: either re-run the Questions Agent with the OLD prompt via `git stash` on questions.ts then `npx tsx pipeline/src/agents/questions.ts` — OR pull the 20 most recent `status='pending'` or `status='verified'` questions in that category from Supabase (they were generated under the old prompt). Prefer the DB approach — it's cheaper and represents real output.
3. Apply the new prompt (Task 2 already committed). Run the Questions Agent in dry-run mode against the same seed category to generate 20 new samples. If no dry-run flag exists, just run it normally with a small `QUESTIONS_BATCH_SIZE` override so only one category is touched, then pull the 20 newest rows for that category.
4. Write SUMMARY.md with: seed category name, BEFORE block (20 questions as numbered list with text + answer + difficulty), AFTER block (same format), one-paragraph qualitative verdict from Claude's side (does it feel more pub-quiz, less textbook, any regressions).
  </action>
  <what-built>
Updated Category + Questions Agent system prompts plus a dry-run SUMMARY.md with 20 before/after sample pairs from one seed category.
  </what-built>
  <how-to-verify>
STAGE B (user reviews):
1. Open `.planning/quick/260419-pma-tighten-category-questions-agent-prompts/260419-pma-SUMMARY.md`.
2. Read the BEFORE and AFTER blocks side by side.
3. Check: does AFTER feel more like a classic UK pub quiz? Answer-first? Conversational? No "according to the source" framing? Breadth feels right for the seed category?
4. Check for regressions: factual errors, worse distractors, questions that drift off-category.
5. Spot-check the Category Agent changes by re-reading the updated systemPrompt in `pipeline/src/agents/category.ts` — confirm depth rule and niche-leaf allowance read correctly.
6. If anything is off, describe the issue and which samples exemplify it; Claude will revise the prompts and re-run Stage A.
  </how-to-verify>
  <resume-signal>Type "approved" to accept the tone shift, or describe the issues and which sample numbers exemplify them.</resume-signal>
  <verify>
    <automated>test -f .planning/quick/260419-pma-tighten-category-questions-agent-prompts/260419-pma-SUMMARY.md && grep -q "BEFORE" .planning/quick/260419-pma-tighten-category-questions-agent-prompts/260419-pma-SUMMARY.md && grep -q "AFTER" .planning/quick/260419-pma-tighten-category-questions-agent-prompts/260419-pma-SUMMARY.md</automated>
  </verify>
  <done>SUMMARY.md exists with BEFORE/AFTER blocks of 20 samples each, seed category named, verdict paragraph written, and user has typed "approved".</done>
</task>

</tasks>

<verification>
- `cd pipeline && npm run typecheck` passes.
- `cd pipeline && npm test` — no regressions in category or questions agent suites.
- SUMMARY.md contains seed category, 20 BEFORE samples, 20 AFTER samples, verdict.
- User has approved the tone shift at the checkpoint.
</verification>

<success_criteria>
- Category Agent system prompt has a depth-aware rule (strict root/mid, permissive leaf) and an academic-at-root counter-example.
- Questions Agent system prompt has explicit Tone section with answer-first good/bad pair and QA-matching ban on comprehension framing.
- Dry-run comparison on one seed category shows qualitative tone shift toward classic UK pub quiz.
- User approves at the checkpoint.
- Commit is a prompt-only change — no schema, no pipeline structure, no new tests.
</success_criteria>

<output>
After completion, ensure `.planning/quick/260419-pma-tighten-category-questions-agent-prompts/260419-pma-SUMMARY.md` contains the BEFORE/AFTER samples and approval record. Update ROADMAP.md to mark 999.3 and 999.4 complete.
</output>
