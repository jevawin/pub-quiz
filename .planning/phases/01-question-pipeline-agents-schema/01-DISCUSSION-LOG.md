# Phase 1: Question Pipeline -- Agents & Schema - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-04-04
**Phase:** 01-question-pipeline-agents-schema
**Areas discussed:** Pipeline execution environment, Agent orchestration pattern, Wikipedia integration strategy, Schema & data modeling

---

## Pipeline Execution Environment

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub Actions cron | Reliable cron scheduling, runs Claude via Anthropic API. Free tier generous. Battle-tested, easy to debug. | ✓ |
| Claude Code Remote Triggers | Runs on Anthropic's infrastructure. Known HTTP 500 errors (April 2026). | |
| Dedicated cron server | DigitalOcean/Railway droplet. Full control but more infra to manage. | |
| Cloudflare Workers + Cron Triggers | Serverless, global edge. 10ms CPU limit on free plan may be too tight. | |

**User's choice:** GitHub Actions cron
**Notes:** Fallback option noted in STATE.md due to Remote Triggers instability.

### API Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Anthropic SDK directly | TypeScript/Python scripts using @anthropic-ai/sdk. Full control over prompts, tool use, token budgets. | ✓ |
| Claude Code CLI subprocess | Invoke claude-code CLI from workflow. Agentic access but harder cost control. | |

**User's choice:** Anthropic SDK directly

### Language

| Option | Description | Selected |
|--------|-------------|----------|
| TypeScript | Matches app codebase. First-class SDK support. Supabase JS client is TS-native. | ✓ |
| Python | Mature SDK. Better for data processing. Adds second language. | |

**User's choice:** TypeScript

### Repo Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Monorepo (same repo) | Pipeline in /pipeline directory. Shared types. One repo. | ✓ |
| Separate repo | Full isolation. Cleaner separation but harder to share types. | |

**User's choice:** Monorepo

---

## Agent Orchestration Pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Sequential pipeline | Category->Knowledge->Questions->Fact-Check. Each output feeds next. Simple, predictable. | ✓ |
| Independent cron jobs | Each agent on own schedule. More resilient but harder state reasoning. | |
| Event-driven with job queue | Agents poll Supabase for pending work. Most flexible but most complex. | |

**User's choice:** Sequential pipeline

### Batch Size

| Option | Description | Selected |
|--------|-------------|----------|
| Batched with configurable limits | Each agent processes N items per run. Predictable costs and fast runs. | ✓ |
| Process all pending work | Simpler logic but unpredictable run times and costs. | |
| Token budget cap | Most cost-predictable but harder throughput reasoning. | |

**User's choice:** Batched with configurable limits

### Error Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Fail and report | Stop pipeline, report via GH Actions notification. Partial work kept. | ✓ |
| Skip and continue | Skip failed items, continue. May accumulate bad state silently. | |
| Retry then fail | Retry up to 3 times with backoff. More resilient but more complex. | |

**User's choice:** Fail and report

### Code Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Separate scripts | One file per agent. Self-contained, independently testable. | ✓ |
| Single orchestrator | One run.ts importing agent functions. Tighter coupling. | |

**User's choice:** Separate scripts

---

## Wikipedia Integration Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Wikipedia REST API | Wikimedia REST API for article summaries. Free, no auth, ~200 req/s. | ✓ |
| Web search + scraping | Search API to find pages, then parse HTML. More flexible but costlier. | |
| Wikipedia database dumps | Complete data, no rate limits. But 20GB+ and stale. | |
| Claude's training knowledge | Skip Wikipedia entirely. Simplest but no external verification source. | |

**User's choice:** Wikipedia REST API

### Content Storage

| Option | Description | Selected |
|--------|-------------|----------|
| Store content in Supabase | Save article text in sources table. Audit trail. Both agents can read. | ✓ |
| Pass references only | Store just URLs. Less storage but more API calls, no audit trail. | |

**User's choice:** Store content in Supabase

### Additional Sources

| Option | Description | Selected |
|--------|-------------|----------|
| Wikipedia only for v1 | Keep it simple. Broad coverage. Expand in v2. | ✓ |
| Wikipedia + web search fallback | Fall back to search for niche topics. Adds API cost. | |
| Multiple curated sources | Wikipedia + educational sites. Best quality, most complex. | |

**User's choice:** Wikipedia only for v1

---

## Schema & Data Modeling

### Category Hierarchy

| Option | Description | Selected |
|--------|-------------|----------|
| Adjacency list | parent_id column. Simplest, recursive queries, good for 4 levels. | ✓ |
| Materialized path | Full path string. Fast reads, slightly complex writes. | |
| PostgreSQL ltree | Native tree type. Most powerful but extension dependency. | |

**User's choice:** Adjacency list

### Distractor Storage

| Option | Description | Selected |
|--------|-------------|----------|
| JSON array on question row | JSONB array column. No joins. App shuffles at display. | ✓ |
| Separate answers table | One row per answer. More normalized but adds join. | |

**User's choice:** JSON array on question row

### Verification Strength

| Option | Description | Selected |
|--------|-------------|----------|
| Score on question row | Integer 0-3 on questions table. Simple, queryable. | ✓ |
| Verification log table | Separate table tracking each attempt. Full audit trail. | |
| Both -- score + log | Score for queries, log for audit. Most complete but more tables. | |

**User's choice:** Score on question row

### Run Tracking

| Option | Description | Selected |
|--------|-------------|----------|
| Pipeline jobs table in Supabase | pipeline_runs table with timestamp, agent, items, tokens, duration. | ✓ |
| GitHub Actions logs only | Rely on GH Actions history. No extra schema but logs expire at 90 days. | |

**User's choice:** Pipeline jobs table in Supabase

---

## Claude's Discretion

- Exact batch sizes per agent
- GitHub Actions cron schedule timing
- Supabase table naming conventions and exact column types
- RLS policy implementation details
- Error notification channel

## Deferred Ideas

None -- discussion stayed within phase scope.
