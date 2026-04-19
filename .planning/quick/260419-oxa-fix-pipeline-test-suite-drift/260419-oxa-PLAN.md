---
phase: 260419-oxa-fix-pipeline-test-suite-drift
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - pipeline/tests/run-pipeline.test.ts
  - pipeline/tests/agents/fact-check.test.ts
  - pipeline/tests/agents/qa.test.ts
autonomous: true
requirements:
  - QUICK-260419-OXA-01
must_haves:
  truths:
    - "All 7 previously-failing pipeline tests now pass"
    - "No previously-passing pipeline test regresses"
    - "Test expectations match current production agent behaviour (prod is source of truth)"
    - "Any genuine contract drift (e.g. qa_rewritten flag, rewritten-path verdict) is flagged and either preserved in agent code or consciously accepted in tests"
  artifacts:
    - path: "pipeline/tests/run-pipeline.test.ts"
      provides: "Updated Test 3 (metrics/token totals) and Test 10 (logger usage) matching current run-pipeline.ts behaviour"
    - path: "pipeline/tests/agents/fact-check.test.ts"
      provides: "Updated Haiku token tracking assertions matching current fact-check.ts call signature"
    - path: "pipeline/tests/agents/qa.test.ts"
      provides: "Updated qa_rewritten expectation, distractor-length path, Haiku token args, rewritten score>=3 verdict"
  key_links:
    - from: "pipeline/tests/agents/qa.test.ts"
      to: "pipeline/src/agents/qa.ts"
      via: "mocked Anthropic + Supabase clients"
      pattern: "qa_rewritten|rejected|published|distractor"
    - from: "pipeline/tests/agents/fact-check.test.ts"
      to: "pipeline/src/agents/fact-check.ts"
      via: "mocked Anthropic client token tracking"
      pattern: "trackHaikuTokens|recordTokens"
    - from: "pipeline/tests/run-pipeline.test.ts"
      to: "pipeline/src/run-pipeline.ts"
      via: "mocked agents + logger"
      pattern: "logger|metrics|totalTokens"
---

<objective>
Fix 7 failing pipeline tests that drifted after recent agent tightening (QA Opus upgrade 14edd7f, fact-check/QA/enrichment tightening e4ef688, QA split 991ed2f). Production pipeline is trusted (2308 OpenTDB import + green daily runs); tests are out of sync.

Purpose: Restore test suite as a regression signal so future agent changes surface breakage.
Output: Green `npm test` (pipeline suite) with all 7 drifted tests passing and nothing previously-passing broken.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@pipeline/src/agents/fact-check.ts
@pipeline/src/agents/qa.ts
@pipeline/src/run-pipeline.ts
@pipeline/tests/run-pipeline.test.ts
@pipeline/tests/agents/fact-check.test.ts
@pipeline/tests/agents/qa.test.ts

<interfaces>
<!-- Default posture: prod code is source of truth. Tests update to match. -->
<!-- Exception: if a test expectation encodes a user-visible contract (e.g. qa_rewritten is a persisted DB flag consumers depend on), fix agent instead. -->

Known drift points from backlog (Phase 999.11):
  - run-pipeline.test.ts Test 3: metrics / token totals shape changed
  - run-pipeline.test.ts Test 10: logger usage pattern changed
  - fact-check.test.ts: Haiku token tracking — expected args `1, 5` no longer match current call
  - qa.test.ts: qa_rewritten flag now undefined in update payload (was set before)
  - qa.test.ts: distractor-length validation no longer rejects — resolves with processed+failed
  - qa.test.ts: Haiku token tracking drift (same shape issue as fact-check)
  - qa.test.ts: rewritten score>=3 path now returns 'rejected' instead of 'published'
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Investigate drift and decide per-test (test-fix vs agent-fix)</name>
  <files>
    pipeline/src/agents/fact-check.ts,
    pipeline/src/agents/qa.ts,
    pipeline/src/run-pipeline.ts,
    pipeline/tests/run-pipeline.test.ts,
    pipeline/tests/agents/fact-check.test.ts,
    pipeline/tests/agents/qa.test.ts
  </files>
  <action>
    Run the failing suite first to capture exact failure messages:
      `cd pipeline && npm test -- --run 2>&1 | tee /tmp/oxa-before.log`

    For each of the 7 failing tests, read the current agent source and decide:
      (a) Prod code is correct, test encodes stale expectation → update test (default).
      (b) Test encodes a genuine user-visible contract → flag and fix agent.

    Specific judgment calls required:
      - `qa_rewritten` flag: check if any consumer reads `questions.qa_rewritten` (grep `qa_rewritten` across repo + DB schema). If consumers exist, agent must still set it → fix agent. If not, drop from test.
      - rewritten score>=3 returning `'rejected'` instead of `'published'`: read qa.ts rewrite branch. If intentional (Sonnet-rewritten questions held for re-review), update test. If accidental, fix agent.
      - distractor-length validation now resolving with processed+failed instead of rejecting: confirm current behaviour is the "count as failed, don't throw" pattern already established in Phase 01 decisions. Likely test drift — update test.
      - Haiku token tracking arg drift (`1, 5` → ?): read current call site, update expected args to match.
      - run-pipeline Test 3 metrics/token totals: match shape to current metric aggregation.
      - run-pipeline Test 10 logger usage: match to current logger call pattern.

    Produce a short decision log inline at the top of each touched test file as a comment block (e.g. `// Drift repair 260419-oxa: updated to match qa.ts 991ed2f split — qa_rewritten flag intentionally dropped because no consumer reads it`). This preserves context for the next reader.

    Do NOT change agent code unless a genuine contract is at stake. Every agent-side fix must be justified in the decision log.
  </action>
  <verify>
    <automated>cd pipeline && npm test -- --run 2>&1 | tail -40</automated>
  </verify>
  <done>
    Per-test decision made (test-fix vs agent-fix) for all 7 failing tests. Decision log comments added to touched test files. No speculative edits.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Apply fixes and verify full suite green</name>
  <files>
    pipeline/tests/run-pipeline.test.ts,
    pipeline/tests/agents/fact-check.test.ts,
    pipeline/tests/agents/qa.test.ts
  </files>
  <behavior>
    - All 7 previously-failing tests pass after edits
    - Previously-passing tests in pipeline/tests still pass (no regressions)
    - Test file decision-log comments explain each substantive change
    - If any agent file was modified (contract preservation), that change is narrow and documented
  </behavior>
  <action>
    Apply the decisions from Task 1:
      - Update test assertions to match current agent behaviour where prod is source of truth.
      - For `qa_rewritten`: if grep confirms no consumer, remove assertion. If consumer exists, add `qa_rewritten: true` back into qa.ts update payload on the rewrite path.
      - For rewritten score>=3 verdict: update test to expect `'rejected'` if intentional holding pattern; otherwise restore `'published'` in qa.ts.
      - For distractor-length: update test to assert `{ processed, failed }` return shape with failed count, matching the Phase 01 standardized AgentResult contract.
      - For Haiku token tracking: update `expect(trackHaikuTokens).toHaveBeenCalledWith(...)` args to match current fact-check.ts / qa.ts call sites.
      - For run-pipeline Test 3: update metric/token-total assertions to current aggregation shape.
      - For run-pipeline Test 10: update logger call assertions to current call pattern.

    Run the full pipeline test suite and confirm green:
      `cd pipeline && npm test -- --run`

    Compare pass counts against `/tmp/oxa-before.log` baseline — the number of passing tests MUST strictly increase by at least 7, with no previously-passing test now failing.
  </action>
  <verify>
    <automated>cd pipeline && npm test -- --run 2>&1 | tee /tmp/oxa-after.log | tail -20 && grep -E "Tests +[0-9]+ passed" /tmp/oxa-after.log</automated>
  </verify>
  <done>
    `npm test` in pipeline/ exits 0. All 7 previously-failing tests pass. Zero previously-passing tests regress. Decision log comments committed alongside test changes.
  </done>
</task>

</tasks>

<verification>
- `cd pipeline && npm test -- --run` exits 0
- Diff of before/after logs shows +7 passes, 0 new failures
- `git diff pipeline/src/agents/ pipeline/src/run-pipeline.ts` shows either no changes (pure test drift) or a narrow, documented contract-preservation edit
</verification>

<success_criteria>
- All 7 drifted tests green
- No regressions in previously-passing tests
- Every substantive test edit has a one-line decision-log comment explaining why
- Any agent-code change is justified by a genuine user-visible contract (not speculative)
</success_criteria>

<output>
After completion, create `.planning/quick/260419-oxa-fix-pipeline-test-suite-drift/260419-oxa-SUMMARY.md` covering:
- Per-test decision (test-fix vs agent-fix) and reasoning
- Any agent code changes and why
- Before/after pass counts
- Any follow-ups (e.g. if `qa_rewritten` flag turned out to have consumers that need migration)
</output>
