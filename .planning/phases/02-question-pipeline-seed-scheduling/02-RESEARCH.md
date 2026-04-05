# Phase 2: Question Pipeline -- Seed & Scheduling - Research

**Researched:** 2026-04-05
**Domain:** GitHub Actions scheduling, pipeline batch tuning, cost modeling
**Confidence:** HIGH

## Summary

Phase 2 is an operationalization phase, not a coding-heavy phase. The entire pipeline infrastructure was built in Phase 1 -- four agents, orchestrator, cost tracking, concurrent run guard, and a daily workflow. This phase creates a second workflow (`seed-pipeline.yml`) that reuses the existing orchestrator with larger batch sizes and a 30-minute cron, plus a threshold check that exits early once 1000+ verified questions exist.

The key technical challenges are: (1) implementing a pre-run threshold check that queries Supabase before invoking the pipeline, (2) implementing least-covered-first category selection so seeding spreads across all 12 core categories, and (3) tuning batch sizes to stay within the $2/run budget cap while maximizing throughput. No new npm packages, no schema changes, no new agents.

**Primary recommendation:** Create a seed workflow that wraps the existing `run-pipeline.ts` with a threshold-check preamble step and larger env-var batch sizes. Add a category selection query to the orchestrator or category agent to prefer least-covered categories. Keep daily workflow unchanged.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Separate seed workflow (`seed-pipeline.yml`) with its own cron, batch sizes, and budget cap. Disabled after seeding completes.
- **D-02:** Seed workflow runs every 30 minutes (~96 runs over 48h). Concurrent run guard prevents overlap.
- **D-03:** Auto-disable when verified question threshold reached. Query count of questions with `verification_score >= 3`. If 1000+, exit early with "SEED COMPLETE" log message and GitHub Actions annotation. Cron needs manual removal after.
- **D-04:** After seeding, daily workflow continues unchanged with default batch sizes (5/10/20) at $1.00/run.
- **D-05:** Even spread across all 12 seed categories. Least-covered-first strategy.
- **D-06:** Seed runs use larger batch sizes (suggested 10/20/40). Exact sizes to be determined by cost analysis.
- **D-07:** Difficulty levels assigned naturally by agents. No artificial balancing.
- **D-08:** Total seed budget tolerance $50. Per-run cap $2.00.
- **D-09:** Per-run cap only -- no cumulative budget tracking. Auto-disable is the primary cost control.
- **D-10:** Monitoring via GitHub Actions run history + SQL queries against `pipeline_runs` table.
- **D-11:** Seed complete threshold is 1000+ verified questions (verification_score >= 3).
- **D-12:** Auto-disable outputs log message + GitHub Actions annotation ("SEED COMPLETE: X verified questions across Y categories").

### Claude's Discretion
- Exact seed batch sizes (suggested 10/20/40 but planner can optimize based on cost modeling)
- Least-covered-first category selection algorithm implementation
- Workflow YAML structure and step organization
- Whether to add a pre-run summary step to the daily workflow (nice-to-have, not required)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PIPE-02 | Initial bulk seed run -- high-frequency schedule for first 48h to build seed database | Seed workflow with 30-min cron, larger batch sizes, threshold auto-disable. Cost modeling shows 10/20/40 batch sizes fit within $2/run budget. |
| PIPE-03 | Ongoing daily scheduled update that adds new questions from new knowledge or newly discovered backdated sources | Daily workflow already exists from Phase 1. No changes needed -- continues with 5/10/20 batch sizes at $1.00/run. Least-covered-first category selection benefits both seed and daily runs. |
</phase_requirements>

## Architecture Patterns

### What Already Exists (Phase 1 Output)

The pipeline is fully built. Understanding what exists is critical to scoping Phase 2 correctly:

| Component | File | What It Does |
|-----------|------|--------------|
| Orchestrator | `pipeline/src/run-pipeline.ts` | Sequential agent execution, concurrent run guard (exits 0 if another run is active), pipeline_runs record creation, cost tracking |
| Config loader | `pipeline/src/lib/config.ts` | Reads all batch sizes and budget from env vars with defaults (5/10/20, $1.00) |
| Token tracker | `pipeline/src/lib/claude.ts` | Accumulates tokens across agents, throws `BudgetExceededError` when cap exceeded |
| Category Agent | `pipeline/src/agents/category.ts` | Proposes subcategories under existing tree. Uses Sonnet. |
| Knowledge Agent | `pipeline/src/agents/knowledge.ts` | Fetches Wikipedia articles for categories with < 3 sources. No Claude calls. |
| Questions Agent | `pipeline/src/agents/questions.ts` | Generates 5 questions per category from source material. Uses Sonnet. Respects `questionsBatchSize` as total cap. |
| Fact-Check Agent | `pipeline/src/agents/fact-check.ts` | Verifies pending questions against source text. Uses Haiku. Auto-publishes score >= 3, marks score 1-2 as verified. |
| Daily workflow | `.github/workflows/question-pipeline.yml` | Cron at 04:23 UTC daily, workflow_dispatch with configurable inputs, 30-min timeout |

### New Components Needed

```
.github/workflows/
  question-pipeline.yml        # EXISTING -- no changes
  seed-pipeline.yml            # NEW -- seed workflow

pipeline/src/
  run-pipeline.ts              # EXISTING -- may need least-covered-first modification
  seed-threshold-check.ts      # NEW -- pre-run threshold check script
```

### Pattern 1: Seed Workflow Structure

**What:** A GitHub Actions workflow that checks the threshold before running the pipeline.

The seed workflow needs two steps before the pipeline run:
1. **Threshold check** -- Query Supabase for count of published/verified questions. If >= 1000, output annotation and exit.
2. **Pipeline run** -- Same as daily workflow but with larger env vars.

```yaml
# Seed workflow structure
on:
  schedule:
    - cron: '*/30 * * * *'  # Every 30 minutes
  workflow_dispatch:
    inputs:
      budget_usd:
        description: 'Budget cap in USD for this run'
        default: '2.00'

jobs:
  seed-run:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: pipeline/package-lock.json
      - run: npm ci
        working-directory: pipeline

      # Threshold check step
      - name: Check seed completion threshold
        id: threshold
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: npx tsx src/seed-threshold-check.ts

      # Pipeline run (skipped if threshold met)
      - name: Run pipeline (seed batch)
        if: steps.threshold.outputs.seed_complete != 'true'
        working-directory: pipeline
        env:
          PIPELINE_BUDGET_USD: ${{ inputs.budget_usd || '2.00' }}
          CATEGORY_BATCH_SIZE: '10'
          KNOWLEDGE_BATCH_SIZE: '20'
          QUESTIONS_BATCH_SIZE: '40'
          # ... other secrets
        run: npx tsx src/run-pipeline.ts
```

### Pattern 2: Threshold Check Script

**What:** A small TypeScript script that queries Supabase and sets GitHub Actions outputs.

```typescript
// pipeline/src/seed-threshold-check.ts
import { createSupabaseClient } from './lib/supabase.js';

const VERIFIED_THRESHOLD = 1000;

async function checkThreshold(): Promise<void> {
  const supabase = createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Count verified questions (score >= 3 means published)
  const { count, error } = await supabase
    .from('questions')
    .select('*', { count: 'exact', head: true })
    .gte('verification_score', 3);

  if (error) {
    console.error(`Failed to check threshold: ${error.message}`);
    process.exit(1);
  }

  const verifiedCount = count ?? 0;

  // Count distinct categories with verified questions
  const { data: categories } = await supabase
    .from('questions')
    .select('category_id')
    .gte('verification_score', 3);

  const uniqueCategories = new Set(categories?.map(q => q.category_id) ?? []);

  if (verifiedCount >= VERIFIED_THRESHOLD) {
    // GitHub Actions annotation
    console.log(`::notice::SEED COMPLETE: ${verifiedCount} verified questions across ${uniqueCategories.size} categories`);
    // Set output for conditional step
    const outputFile = process.env.GITHUB_OUTPUT;
    if (outputFile) {
      // Write to GITHUB_OUTPUT file
      const fs = await import('fs');
      fs.appendFileSync(outputFile, `seed_complete=true\n`);
    }
    console.log(`Seed threshold reached. ${verifiedCount} verified questions.`);
  } else {
    console.log(`Seed in progress: ${verifiedCount}/${VERIFIED_THRESHOLD} verified questions across ${uniqueCategories.size} categories`);
  }
}

checkThreshold();
```

**Key detail:** GitHub Actions outputs in recent versions use `$GITHUB_OUTPUT` file, not the deprecated `::set-output` command.

### Pattern 3: Least-Covered-First Category Selection

**What:** Modify category selection so seeds spread evenly across all 12 root categories.

The current Questions Agent finds categories with < 10 questions and processes them in database order. For even seeding, we need to sort by question count ascending.

Two implementation options:

**Option A (Recommended): SQL query in threshold check / orchestrator preamble**
```sql
-- Categories ordered by verified question count (ascending)
SELECT c.id, c.name, c.slug,
  COUNT(q.id) FILTER (WHERE q.verification_score >= 3) as verified_count
FROM categories c
LEFT JOIN questions q ON q.category_id = c.id
GROUP BY c.id, c.name, c.slug
ORDER BY verified_count ASC
LIMIT :batch_size;
```

**Option B: Modify the Category and Knowledge agents**
Add ordering logic within each agent. More invasive but colocated with the selection logic.

**Recommendation:** Option A is cleaner. Add a `--category-order` flag or env var (`CATEGORY_ORDER=least-covered`) that the orchestrator reads and passes to agents. Default remains unordered (daily behavior unchanged). The seed workflow sets this env var.

### Anti-Patterns to Avoid
- **Modifying the daily workflow** -- D-04 explicitly says it stays unchanged. All seed logic goes in the new workflow only.
- **Complex cumulative budget tracking** -- D-09 says per-run cap only. Do not build cross-run budget state.
- **Trying to programmatically disable the cron** -- GitHub API can disable workflows, but this adds unnecessary complexity. D-03 says the cron needs manual removal; the threshold check prevents unnecessary runs.

## Cost Modeling

### Per-Token Costs (from `claude.ts`)

| Model | Input ($/MTok) | Output ($/MTok) | Used By |
|-------|----------------|-----------------|---------|
| Claude Sonnet 4.5 | $3.00 | $15.00 | Category Agent, Questions Agent |
| Claude Haiku 4.5 | $1.00 | $5.00 | Fact-Check Agent |

### Estimated Cost Per Seed Run (10/20/40 batch sizes)

| Agent | Calls | Est. Input Tokens | Est. Output Tokens | Est. Cost |
|-------|-------|-------------------|---------------------|-----------|
| Category Agent | 1 call (10 categories) | ~2,000 | ~1,500 | $0.03 |
| Knowledge Agent | 0 Claude calls (Wikipedia only) | 0 | 0 | $0.00 |
| Questions Agent | ~8 categories x 1 call each | ~24,000 (3K source text + prompt per call) | ~8,000 (5 questions per call, ~40 total) | $0.19 |
| Fact-Check Agent | ~8 source groups | ~16,000 | ~4,000 | $0.04 |
| **Total per run** | | | | **~$0.26** |

**Analysis:**
- At ~$0.26/run, the $2.00/run cap is very conservative (8x headroom).
- At 96 runs over 48h: ~$25 total, well within $50 budget tolerance.
- The bigger batch sizes (10/20/40) do not proportionally increase cost because the Knowledge Agent (the heaviest step by wall-clock time) makes zero Claude calls -- it only fetches Wikipedia.
- The Questions Agent is the cost driver. 40 questions at ~5 per category = 8 category calls to Sonnet.

**Batch size recommendation:** 10/20/40 is safe. Could go to 15/30/60 and still stay under $2/run (est. ~$0.40/run). However, 10/20/40 gives better control and the 30-min frequency compensates for smaller batches.

### Questions-to-Verified Conversion Rate

Not every generated question reaches verification_score >= 3. The pipeline flow is:
1. Questions Agent generates questions (status: `pending`, score: 0)
2. Fact-Check Agent verifies them in the SAME run
3. Only score >= 3 gets `published` status

**Critical insight:** The Questions Agent generates questions and the Fact-Check Agent verifies them in the same pipeline run. So each run both creates and verifies questions. But only questions from sources fetched in previous runs (or the same run's Knowledge Agent output) can be processed.

**Estimated conversion rate:** Based on the pipeline design where questions are generated strictly from source material and then verified against that same source material, expect 60-80% of questions to reach score >= 3. At 40 questions/run and 70% conversion: ~28 verified questions per run. To reach 1000: ~36 runs, or ~18 hours at 30-min intervals.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| GitHub Actions step outputs | String parsing of log files | `$GITHUB_OUTPUT` file mechanism | Official mechanism, won't break |
| Cross-run state tracking | Database table for seed progress | Threshold query at run start | D-09 says per-run cap only. The questions table IS the state. |
| Workflow enable/disable | GitHub API calls to toggle workflow | Threshold check exits early | Much simpler. Manual cron removal is acceptable per D-03. |
| Category distribution tracking | Custom distribution table | SQL COUNT + GROUP BY on questions table | Data already exists, just query it differently |

## Common Pitfalls

### Pitfall 1: GitHub Actions Disables Inactive Scheduled Workflows
**What goes wrong:** GitHub automatically disables scheduled workflows on repositories with no recent activity (no commits, issues, or PRs for 60 days).
**Why it happens:** GitHub's resource conservation policy.
**How to avoid:** Not an immediate concern for a 48-hour seed window. But for the ongoing daily workflow, ensure the repo has periodic activity. A seed run during active development naturally keeps the repo active.
**Warning signs:** Workflow stops running silently -- check the Actions tab.

### Pitfall 2: Cron Timing Is Approximate in GitHub Actions
**What goes wrong:** The `*/30 * * * *` cron may not fire exactly every 30 minutes. GitHub Actions can delay scheduled runs by 5-15 minutes during peak load.
**Why it happens:** GitHub's shared infrastructure queues scheduled workflows.
**How to avoid:** This is acceptable. The concurrent run guard prevents overlap if runs stack up. The 30-min interval provides enough spacing even with delays.
**Warning signs:** Runs clustering together in the Actions tab. The concurrent guard handles this safely.

### Pitfall 3: Threshold Check Race Condition
**What goes wrong:** A run starts, checks threshold (999 verified), another run also starts and checks (999), both proceed.
**Why it happens:** The threshold check and the concurrent run guard are separate checks.
**How to avoid:** The existing concurrent run guard in `run-pipeline.ts` already prevents this -- only one pipeline run can be active at a time (it checks `pipeline_runs` for status='running'). The threshold check is an optimization, not a locking mechanism.
**Warning signs:** Two runs shown as "running" simultaneously in pipeline_runs -- the guard prevents this.

### Pitfall 4: Questions Agent Eligibility vs. Least-Covered-First
**What goes wrong:** The Questions Agent currently finds categories with < 10 questions (`MIN_QUESTIONS_THRESHOLD = 10`). During early seeding, ALL categories have < 10 questions, so it processes them in arbitrary database order, not least-covered-first.
**Why it happens:** The current code iterates `categories` array from a `SELECT *` without ordering.
**How to avoid:** The least-covered-first logic needs to be injected into the Questions Agent's category selection query, or the orchestrator needs to pre-sort categories and pass the order through.
**Warning signs:** Category distribution is uneven after seeding -- check with `SELECT category_id, COUNT(*) FROM questions GROUP BY category_id`.

### Pitfall 5: Knowledge Agent Bottleneck on Fresh Categories
**What goes wrong:** New categories from the Category Agent in run N have no sources yet. The Knowledge Agent in run N fetches sources for them. But the Questions Agent in run N may not find those sources if the insert hasn't been committed/visible yet.
**Why it happens:** All agents run in the same Node.js process sequentially, sharing the same Supabase client. Inserts are committed immediately (no transaction wrapping), so sources inserted by the Knowledge Agent SHOULD be visible to the Questions Agent in the same run.
**How to avoid:** This is already handled correctly by the sequential execution model. Each agent completes before the next starts. Supabase inserts are visible immediately. No action needed.
**Warning signs:** Questions Agent logs "No eligible categories found" despite Knowledge Agent having just inserted sources. If this happens, it would indicate a caching issue.

## Code Examples

### GitHub Actions Annotation Syntax
```bash
# Notice annotation (visible in workflow summary)
echo "::notice::SEED COMPLETE: 1042 verified questions across 12 categories"

# Warning annotation
echo "::warning::Seed budget running high: $38.50 of $50 tolerance used"
```

### Supabase Count Query (Efficient)
```typescript
// Use head: true for count-only queries -- doesn't fetch row data
const { count, error } = await supabase
  .from('questions')
  .select('*', { count: 'exact', head: true })
  .gte('verification_score', 3);
```

### Category Distribution Query
```typescript
// For monitoring / least-covered-first
const { data } = await supabase.rpc('category_question_counts');
// Or raw query:
const { data } = await supabase
  .from('questions')
  .select('category_id')
  .gte('verification_score', 3);

// Client-side count
const counts = new Map<string, number>();
for (const row of data ?? []) {
  counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
}
```

### GitHub Actions Output (Post-Deprecation)
```bash
# Modern approach -- write to $GITHUB_OUTPUT file
echo "seed_complete=true" >> "$GITHUB_OUTPUT"
echo "verified_count=1042" >> "$GITHUB_OUTPUT"

# Reference in later steps:
# if: steps.threshold.outputs.seed_complete != 'true'
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x |
| Config file | `pipeline/vitest.config.ts` |
| Quick run command | `cd pipeline && npm test` |
| Full suite command | `cd pipeline && npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PIPE-02-a | Threshold check exits early when >= 1000 verified questions | unit | `cd pipeline && npx vitest run tests/seed-threshold-check.test.ts -x` | Wave 0 |
| PIPE-02-b | Threshold check continues when < 1000 verified questions | unit | `cd pipeline && npx vitest run tests/seed-threshold-check.test.ts -x` | Wave 0 |
| PIPE-02-c | Threshold check outputs GitHub Actions annotation on completion | unit | `cd pipeline && npx vitest run tests/seed-threshold-check.test.ts -x` | Wave 0 |
| PIPE-02-d | Seed workflow YAML is valid and has correct cron/env | smoke | Manual review of YAML syntax | Manual |
| PIPE-03-a | Least-covered-first category selection returns categories ordered by question count | unit | `cd pipeline && npx vitest run tests/lib/category-selection.test.ts -x` | Wave 0 |
| PIPE-03-b | Daily workflow remains unchanged (no regressions) | smoke | `diff .github/workflows/question-pipeline.yml` against Phase 1 version | Manual |

### Sampling Rate
- **Per task commit:** `cd pipeline && npm test`
- **Per wave merge:** `cd pipeline && npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `pipeline/tests/seed-threshold-check.test.ts` -- covers PIPE-02-a, PIPE-02-b, PIPE-02-c
- [ ] `pipeline/tests/lib/category-selection.test.ts` -- covers PIPE-03-a (if category selection logic is extracted to a lib)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `::set-output name=key::value` | Write to `$GITHUB_OUTPUT` file | GitHub Actions Oct 2022 | Must use file-based outputs in all new workflows |
| `GITHUB_ENV` for setting env | Still valid | N/A | Continue using for env vars between steps |

## Open Questions

1. **How many categories exist after Phase 1?**
   - What we know: Phase 1 seeded the 12 root categories and the Category Agent proposes subcategories. After Phase 1 execution, there should be 12 root + some subcategories.
   - What's unclear: Exact count depends on how many daily runs have occurred.
   - Recommendation: The seed threshold check can log current category/question counts at startup. No architectural impact.

2. **Will the Fact-Check Agent keep up with 40 questions per run?**
   - What we know: The Fact-Check Agent processes ALL pending questions (not just from the current run). It groups by source for efficiency.
   - What's unclear: If a run generates 40 questions but also has backlog from a previous failed fact-check, the Haiku costs could spike.
   - Recommendation: The $2/run budget cap catches this. Haiku is cheap ($1/$5 per MTok). Even 100 questions at ~200 tokens each is only ~$0.02.

## Sources

### Primary (HIGH confidence)
- Phase 1 source code: `pipeline/src/run-pipeline.ts`, `pipeline/src/lib/config.ts`, `pipeline/src/lib/claude.ts`, all agent files -- direct code reading
- `.github/workflows/question-pipeline.yml` -- existing workflow template
- `supabase/migrations/00001_initial_schema.sql` -- database schema

### Secondary (MEDIUM confidence)
- [GitHub Actions workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands) -- annotation syntax (`::notice::`, `::warning::`, `::error::`)
- [GitHub Actions scheduled events](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows) -- cron syntax, 5-minute minimum interval, UTC timezone
- [Anthropic rate limits](https://platform.claude.com/docs/en/api/rate-limits) -- tier-based TPM limits

### Tertiary (LOW confidence)
- Cost estimates -- based on token cost constants in `claude.ts` and estimated token counts per agent call. Actual costs will vary based on prompt/response lengths.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new packages needed, entire pipeline exists
- Architecture: HIGH -- pattern is clear (new workflow + threshold script + category ordering)
- Cost modeling: MEDIUM -- estimates based on assumed token volumes, real numbers may differ
- Pitfalls: HIGH -- well-understood GitHub Actions behavior and existing code patterns

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (stable -- no fast-moving dependencies)
