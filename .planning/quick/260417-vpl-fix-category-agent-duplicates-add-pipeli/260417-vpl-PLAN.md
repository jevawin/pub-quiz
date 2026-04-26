---
phase: 260417-vpl-fix-category-agent-duplicates
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - pipeline/src/agents/category.ts
  - pipeline/tests/agents/category.test.ts
  - .github/workflows/seed-pipeline.yml
autonomous: true
requirements:
  - FIX-CAT-01  # Pass existing slugs to Claude prompt
  - FIX-CAT-02  # All-duplicates is not a hard failure
  - FIX-PIPE-03 # Notify user on pipeline failure

must_haves:
  truths:
    - "Category Agent prompt includes an explicit list of existing slugs that Claude must not reuse"
    - "When every proposal is a duplicate of an existing slug, the agent logs INFO and returns without throwing"
    - "When the Seed Pipeline workflow fails, a GitHub issue is opened with a link to the run"
  artifacts:
    - path: pipeline/src/agents/category.ts
      provides: "Updated Category Agent with existing-slug awareness and soft-handle for all-duplicates case"
    - path: pipeline/tests/agents/category.test.ts
      provides: "Test coverage for the all-duplicates-no-throw behaviour and prompt-contains-existing-slugs behaviour"
    - path: .github/workflows/seed-pipeline.yml
      provides: "failure() step that opens a GitHub issue with run URL"
  key_links:
    - from: pipeline/src/agents/category.ts
      to: Claude user prompt
      via: "existing-slugs block embedded in prompt text"
      pattern: "Do NOT propose any of these existing slugs"
    - from: .github/workflows/seed-pipeline.yml
      to: GitHub Issues API
      via: "actions/github-script or gh issue create on failure()"
      pattern: "if: failure\\(\\)"
---

<objective>
Fix two Category Agent bugs causing repeated Seed Pipeline failures, and add a failure notification so the user finds out when the nightly run breaks.

Purpose: Pipeline has failed 3 of the last 5 runs because Claude proposes slugs that already exist, and nobody knew because GitHub does not email on scheduled-workflow failures.

Output: Category Agent tells Claude which slugs already exist, treats all-duplicates as a benign signal, and the workflow opens a GitHub issue on any failure.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@pipeline/src/agents/category.ts
@pipeline/tests/agents/category.test.ts
@.github/workflows/seed-pipeline.yml

<interfaces>
From pipeline/src/agents/category.ts:

```typescript
export interface AgentResult {
  processed: number;
  failed: number;
}

export async function runCategoryAgent(
  config: PipelineConfig,
  tokenAccumulator: TokenAccumulator,
): Promise<AgentResult>;
```

Relevant current behaviour (lines 178-253):
- Builds `existingSlugs = new Set(categories.map(c => c.slug))` AFTER Claude is called.
- Loops proposals; if `existingSlugs.has(proposal.slug)` logs warn and increments `failed`.
- At end: `if (processed === 0 && failed > 0) throw new Error(...)` — this is the line that breaks the pipeline on all-duplicates.

Precedent from STATE.md decisions:
- "Rejected questions count as failed in return value but don't trigger error throw -- only actual processing errors cause agent-level failure" — all-duplicates is the same shape of non-error.
- "Concurrent run guard exits 0 (skip, not error) to avoid false CI alerts" — same philosophy: a benign no-op should not fail.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Fix Category Agent — pass existing slugs to Claude, don't throw on all-duplicates</name>
  <files>pipeline/src/agents/category.ts, pipeline/tests/agents/category.test.ts</files>
  <behavior>
    Prompt content:
    - userPrompt MUST contain the literal string "Do NOT propose any of these existing slugs" followed by the full list of existing slugs.
    - Existing slugs MUST be a comma-separated or newline-separated list drawn from the fetched `categories` array.

    All-duplicates handling:
    - Given Claude returns N proposals where every slug is already in `existingSlugs`:
      - Agent MUST log at `info` level once with message containing "all proposed categories already exist" and a `count` field.
      - Agent MUST return `{ processed: 0, failed: 0 }` (duplicates no longer count as `failed`).
      - Agent MUST NOT throw.
    - Per-proposal duplicate log stays at `info` (downgrade from `warn`) to avoid noisy warns on the expected benign case.

    Existing failure modes preserved:
    - Unknown parent_slug → still increments `failed` and logs warn.
    - Max-depth violation → still increments `failed` and logs warn.
    - Supabase insert error → still increments `failed` and logs error.
    - If `processed === 0 && failed > 0` (i.e. real errors, not duplicates) → still throws.
  </behavior>
  <action>
    Edit pipeline/src/agents/category.ts:

    1. Move the `existingSlugs` Set construction up to immediately after `const categories: CategoryRow[] = existingCategories ?? [];` (before the Claude call) so it can feed the prompt.

    2. Extend `userPrompt` to append an existing-slugs block when `existingSlugs.size > 0`:
       ```
       \n\nDo NOT propose any of these existing slugs (they are already in the database):
       <comma-separated list of all existing slugs>
       ```
       Keep this separate from the tree/summary context — the tree omits slugs in capped mode, and Claude needs the authoritative full list.

    3. Split the final bookkeeping so duplicates are tracked separately from real failures:
       - Add `let skippedDuplicates = 0;`
       - In the duplicate-slug branch: replace `failed++` with `skippedDuplicates++` and change log level from `warn` to `info`.
       - After the loop, if `processed === 0 && failed === 0 && skippedDuplicates > 0`:
         - `log('info', 'Category Agent: all proposed categories already exist -- no new work needed', { count: skippedDuplicates });`
         - `return { processed: 0, failed: 0 };`
       - Leave the existing `if (processed === 0 && failed > 0) throw` guard for genuine errors.
       - Final `return { processed, failed };` is unchanged for the mixed case.

    4. Update the closing `log('info', 'Category Agent complete', ...)` to include `skippedDuplicates`.

    Edit pipeline/tests/agents/category.test.ts — add two tests:

    A. "passes existing slugs to Claude prompt":
       - Mock Supabase to return 3 categories with slugs ['science','history','geography'].
       - Mock Claude to return a valid non-duplicate proposal.
       - After `runCategoryAgent`, assert `mockCreate` was called with `messages[0].content` containing the substring "Do NOT propose any of these existing slugs" AND each of 'science', 'history', 'geography'.

    B. "returns {processed:0, failed:0} without throwing when all proposals are duplicates":
       - Mock Supabase to return existing categories including slugs 'physics' and 'biology'.
       - Mock Claude to return exactly those slugs as proposals.
       - Assert `runCategoryAgent` resolves to `{ processed: 0, failed: 0 }` and does not throw.
       - Optionally assert no Supabase `insert` call occurred.

    Use existing vi.hoisted / dynamic-import mock pattern already in the file.
  </action>
  <verify>
    <automated>cd pipeline && npx vitest run tests/agents/category.test.ts</automated>
  </verify>
  <done>
    Both new tests pass; existing category.test.ts tests still pass; `runCategoryAgent` no longer throws when every proposal is a duplicate; prompt includes existing-slugs block.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add failure-notification step to Seed Pipeline workflow</name>
  <files>.github/workflows/seed-pipeline.yml</files>
  <action>
    Append a new step at the end of the `seed-run` job that runs on failure and opens a GitHub issue.

    Use `actions/github-script@v7` (already in GitHub-hosted runners' stock; no extra install). Add before the file end:

    ```yaml
      - name: Notify on failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
            const date = new Date().toISOString().slice(0, 10);
            const title = `Seed Pipeline failed ${date}`;
            const body = [
              `The Seed Pipeline workflow failed on ${date}.`,
              ``,
              `Run: ${runUrl}`,
              `Workflow: ${context.workflow}`,
              `Triggered by: ${context.eventName}`,
              ``,
              `Check the run log for the failing step and error output.`,
            ].join('\n');

            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title,
              body,
              labels: ['pipeline-failure'],
            });
    ```

    Notes:
    - `github-script` uses the workflow's default `GITHUB_TOKEN`; repo must allow Actions to create issues (default-on for most repos). If the token lacks `issues: write`, the repo's workflow permissions need adjustment — out of scope here.
    - Dedupe is nice-to-have but explicitly deferred per task brief: one issue per failure is acceptable.
    - Label `pipeline-failure` groups these in the Issues tab; label does not need to pre-exist (GitHub creates on first use).
    - Step appears LAST so it catches failure of any prior step (health check, threshold, pipeline run).
  </action>
  <verify>
    <automated>python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/seed-pipeline.yml')); steps=d['jobs']['seed-run']['steps']; last=steps[-1]; assert last.get('if')=='failure()', 'last step must be failure-gated'; assert 'github-script' in last['uses'], 'must use github-script'; assert 'issues.create' in last['with']['script'], 'must call issues.create'; print('ok')"</automated>
  </verify>
  <done>
    Workflow file parses as valid YAML; final step is gated on `if: failure()`; step uses `actions/github-script@v7` and calls `github.rest.issues.create` with a title containing "Seed Pipeline failed" and a body containing the run URL.
  </done>
</task>

</tasks>

<verification>
- `cd pipeline && npx vitest run tests/agents/category.test.ts` passes (all tests, including two new ones).
- `.github/workflows/seed-pipeline.yml` parses as valid YAML and the final step is `if: failure()` using `actions/github-script`.
- Manual spot-check: re-read `runCategoryAgent` end of function — throw only fires when `failed > 0 && processed === 0`, NOT when duplicates are the sole skip reason.
</verification>

<success_criteria>
- Category Agent prompt tells Claude which slugs already exist.
- A run where Claude proposes only already-existing slugs returns `{processed:0, failed:0}` and does not exit 1.
- Any failure of the Seed Pipeline workflow opens a GitHub issue with a link to the run log.
- Existing Category Agent tests still pass.
</success_criteria>

<output>
After completion, create `.planning/quick/260417-vpl-fix-category-agent-duplicates-add-pipeli/260417-vpl-SUMMARY.md`
</output>
