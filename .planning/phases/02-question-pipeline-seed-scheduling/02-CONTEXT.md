# Phase 2: Question Pipeline -- Seed & Scheduling - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Run the existing pipeline at high frequency for ~48 hours to build a seed database of 1000+ verified questions across the 12 core categories, then transition to a sustainable daily schedule. No new agents or schema changes -- this phase is about scheduling, batch tuning, and operationalizing what Phase 1 built.

</domain>

<decisions>
## Implementation Decisions

### Seed Strategy
- **D-01:** A **separate seed workflow** (`seed-pipeline.yml`) runs alongside the existing daily workflow. Clean separation -- the seed workflow has its own cron, batch sizes, and budget cap. Disabled after seeding completes.
- **D-02:** Seed workflow runs **every 30 minutes** (~96 runs over 48h). The existing concurrent run guard prevents overlap if a run takes longer than 30 minutes.
- **D-03:** Seed workflow **auto-disables** when the verified question threshold is reached. Before each run, it queries the count of questions with `verification_score >= 3`. If 1000+ verified questions exist, the workflow exits early with a "SEED COMPLETE" log message and GitHub Actions annotation. The cron still needs manual removal after, but no unnecessary pipeline runs occur.
- **D-04:** After seeding, the **daily workflow continues unchanged** with default batch sizes (5 categories, 10 knowledge, 20 questions) at $1.00/run budget.

### Volume & Distribution
- **D-05:** Target **even spread** across all 12 seed categories. The pipeline should pick categories with the fewest questions first (least-covered-first strategy) to ensure breadth rather than depth in any single category.
- **D-06:** Seed runs use **larger batch sizes** than daily defaults (e.g., 10 categories, 20 knowledge, 40 questions). Exact sizes to be determined during planning based on cost and rate limit analysis.
- **D-07:** Difficulty levels assigned **naturally** by agents based on question complexity. No artificial balancing targets -- crowd calibration in v2 will refine later.

### Budget & Cost Tolerance
- **D-08:** Total seed budget tolerance is **$50**. Per-run cap is **$2.00** for seed runs. At $2/run, the $50 total would be hit after ~25 runs, but the auto-disable threshold (1000+ questions) should trigger well before that.
- **D-09:** **Per-run cap only** -- no cumulative budget tracking. The auto-disable threshold is the primary cost control. Simple implementation.

### Monitoring & Confidence
- **D-10:** Monitoring via **GitHub Actions run history + SQL queries** against Supabase `pipeline_runs` table. No additional tooling or dashboards needed -- everything is already captured.
- **D-11:** Seed complete threshold is **1000+ verified questions** (verification_score >= 3). Matches roadmap success criteria.
- **D-12:** When auto-disable triggers, the workflow outputs a **log message + GitHub Actions annotation** ("SEED COMPLETE: X verified questions across Y categories"). Easy to spot without digging through logs.

### Claude's Discretion
- Exact seed batch sizes (suggested 10/20/40 but planner can optimize based on cost modeling)
- Least-covered-first category selection algorithm implementation
- Workflow YAML structure and step organization
- Whether to add a pre-run summary step to the daily workflow (nice-to-have, not required)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Pipeline Code (Phase 1 Output)
- `pipeline/src/run-pipeline.ts` -- Pipeline orchestrator with sequential agent execution, concurrent run guard, pipeline_runs tracking
- `pipeline/src/agents/category.ts` -- Category Agent implementation
- `pipeline/src/agents/knowledge.ts` -- Knowledge Agent implementation
- `pipeline/src/agents/questions.ts` -- Questions Agent implementation
- `pipeline/src/agents/fact-check.ts` -- Fact-Check Agent implementation
- `pipeline/src/lib/config.ts` -- Configuration loading (env vars, batch sizes, budget cap)
- `pipeline/src/lib/claude.ts` -- Token accumulator for cost tracking
- `pipeline/src/lib/supabase.ts` -- Supabase client factory

### Workflows
- `.github/workflows/question-pipeline.yml` -- Existing daily cron workflow with workflow_dispatch inputs

### Planning Artifacts
- `.planning/phases/01-question-pipeline-agents-schema/01-CONTEXT.md` -- Phase 1 decisions (D-01 through D-15) that established pipeline patterns
- `.planning/REQUIREMENTS.md` -- PIPE-02 (seed run), PIPE-03 (daily schedule), Cost Risk Register
- `.planning/PROJECT.md` -- Seed categories list, pipeline description, priority stack

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `run-pipeline.ts` orchestrator -- already handles sequential agent execution, concurrent run guard, pipeline_runs record creation, and cost tracking. Seed workflow can reuse this directly with different env var values.
- `question-pipeline.yml` -- template for the seed workflow. Same structure (checkout, setup, install, health check, run) with different cron and env defaults.
- `loadConfig()` from `lib/config.ts` -- reads batch sizes and budget from env vars. No code changes needed to support different seed batch sizes.

### Established Patterns
- Env vars for configuration (PIPELINE_BUDGET_USD, CATEGORY_BATCH_SIZE, etc.) -- seed workflow just passes different values
- `pipeline_runs` table tracks every run with status, counts, and cost -- seed runs will appear here naturally
- Concurrent run guard exits 0 (not error) to avoid false CI alerts -- works for both seed and daily

### Integration Points
- New `seed-pipeline.yml` workflow in `.github/workflows/`
- Threshold check queries `questions` table for count where `verification_score >= 3`
- Category selection logic may need a "least-covered-first" query added to the Category Agent or orchestrator

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 02-question-pipeline-seed-scheduling*
*Context gathered: 2026-04-05*
