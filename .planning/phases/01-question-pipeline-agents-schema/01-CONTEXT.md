# Phase 1: Question Pipeline -- Agents & Schema - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the 4-agent Claude pipeline (Category, Knowledge, Questions, Fact-Check) and the Supabase PostgreSQL schema it writes to. The pipeline runs as an independent cloud service, decoupled from the app. This phase delivers working agents that can produce verified quiz questions and write them to the database, plus cost controls (COST-03).

</domain>

<decisions>
## Implementation Decisions

### Pipeline Execution Environment
- **D-01:** Agents run via **GitHub Actions cron workflows** -- not Claude Code Remote Triggers (known HTTP 500 issues April 2026). Reliable, free tier generous for daily runs, built-in logging and notifications.
- **D-02:** Agents call Claude via the **Anthropic TypeScript SDK** (`@anthropic-ai/sdk`) directly -- not Claude Code CLI subprocess. Full control over prompts, tool use, and token budgets.
- **D-03:** Pipeline scripts written in **TypeScript** -- matches the app codebase (React Native + Expo), shared types for DB schema, one language across the project.
- **D-04:** Pipeline lives in a **`/pipeline` directory in this monorepo** -- not a separate repo. Shared types, one repo to manage, GitHub Actions workflows live naturally here.

### Agent Orchestration Pattern
- **D-05:** Agents run as a **sequential pipeline**: Category -> Knowledge -> Questions -> Fact-Check. Each agent's output feeds the next. One GitHub Actions workflow calls them in sequence.
- **D-06:** Each run processes work in **configurable batches** (e.g., Category proposes N subcategories, Knowledge fetches for M categories). Keeps costs predictable and runs fast.
- **D-07:** On failure, the pipeline **stops and reports** via GitHub Actions notification. Partial work from earlier agents is kept. No retry logic -- simple, transparent, easy to investigate.
- **D-08:** Each agent is a **separate script file** (e.g., `pipeline/agents/category.ts`, `knowledge.ts`, `questions.ts`, `fact-check.ts`). Self-contained, independently testable, clear ownership.

### Wikipedia Integration
- **D-09:** Knowledge Agent accesses Wikipedia via the **Wikimedia REST API** -- free, no auth, real-time data, ~200 req/s rate limit. Simple to implement for daily batched runs.
- **D-10:** Fetched Wikipedia content is **stored in a Supabase `sources` table** -- not just references. Creates an audit trail of what knowledge questions were based on. Both Questions Agent and Fact-Check Agent can read stored content.
- **D-11:** **Wikipedia only for v1** -- no additional sources. Broad coverage across all 12 seed categories. Additional sources can be added in v2.

### Schema & Data Modeling
- **D-12:** Category hierarchy uses **adjacency list** (parent_id column). Simplest to implement, supports recursive queries, good enough for 4-level max depth. Easy to add/move categories.
- **D-13:** Wrong answers (distractors) stored as a **JSONB array column** on the questions table. No separate answers table needed. App shuffles correct answer + distractors at display time.
- **D-14:** Verification strength is a **simple integer (0-3) on the question row**. 0 = unverified, 1 = single check, 2 = multiple checks, 3 = high confidence. Queryable and filterable. No separate verification log table.
- **D-15:** Pipeline runs tracked in a **`pipeline_runs` table in Supabase** -- logs timestamp, agent, items processed/failed, tokens used, duration. Powers COST-03 monitoring and debugging.

### Claude's Discretion
- Exact batch sizes per agent (researcher/planner should determine optimal defaults)
- Specific GitHub Actions cron schedule timing
- Supabase table naming conventions and exact column types
- RLS policy implementation details
- Error notification channel (email vs Slack vs GitHub issue)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Specs
- `.planning/PROJECT.md` -- Vision, design philosophy, agent pipeline description, seed categories, constraints
- `.planning/REQUIREMENTS.md` -- DB-01, DB-02, PIPE-01, PIPE-04 through PIPE-09, COST-03 requirements with full acceptance criteria
- `.planning/REQUIREMENTS.md` Cost Risk Register section -- Claude API and pipeline cost risks with mitigations

### Technology Stack
- `CLAUDE.md` Technology Stack section -- Supabase version (supabase-js 2.101.x), TypeScript, recommended libraries and alternatives
- `CLAUDE.md` Version Compatibility section -- Package compatibility matrix

### External APIs
- Wikimedia REST API documentation (external) -- for Knowledge Agent Wikipedia integration

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- No existing code -- greenfield project. Pipeline directory and all scripts to be created from scratch.

### Established Patterns
- No patterns yet -- this is the first phase. Patterns established here (TypeScript, Supabase client usage, error handling) will set conventions for the rest of the project.

### Integration Points
- Supabase project needs to be created/configured (or may already exist -- verify during planning)
- GitHub Actions workflow files go in `.github/workflows/`
- Pipeline scripts in `/pipeline/agents/`
- Shared types (DB schema types) should be accessible to both pipeline and future app code

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

*Phase: 01-question-pipeline-agents-schema*
*Context gathered: 2026-04-04*
