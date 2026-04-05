# Phase 2: Question Pipeline -- Seed & Scheduling - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-04-05
**Phase:** 02-question-pipeline-seed-scheduling
**Areas discussed:** Seed strategy, Volume & distribution, Budget & cost tolerance, Monitoring & confidence

---

## Seed Strategy

### Q1: How should the high-frequency seed runs be triggered?

| Option | Description | Selected |
|--------|-------------|----------|
| Seed workflow | A separate GitHub Actions workflow (seed-pipeline.yml) with a faster cron (e.g. every 30min). Disable it after seeding is done. Clean separation from the daily workflow. | ✓ |
| Adjust daily cron | Temporarily change the daily cron to run every 30min, then manually revert after 48h. Simpler but requires remembering to change it back. | |
| Manual dispatches | Manually trigger workflow_dispatch repeatedly over 48h. Most control, but tedious and requires you to be available. | |

**User's choice:** Seed workflow (separate from daily)
**Notes:** None

### Q2: How often should the seed workflow run?

| Option | Description | Selected |
|--------|-------------|----------|
| Every 30 minutes | ~96 runs over 48h. With default batch sizes, should comfortably hit 1000+ questions. Concurrent run guard prevents overlap. | ✓ |
| Every 15 minutes | ~192 runs over 48h. More aggressive, faster to hit targets, but higher cost. | |
| Every hour | ~48 runs over 48h. More conservative, lower cost, but may need more than 48h or larger batch sizes. | |

**User's choice:** Every 30 minutes
**Notes:** None

### Q3: How should the seed workflow be disabled?

| Option | Description | Selected |
|--------|-------------|----------|
| Manual disable | Disable via GitHub UI or PR that removes the cron trigger. Simple, explicit. | |
| Auto-disable after threshold | Workflow checks question count before running -- if 1000+ verified questions exist, exits early. | ✓ |
| Self-deleting schedule | Workflow includes a date check -- exits if current date > seed_end_date. | |

**User's choice:** Auto-disable after threshold
**Notes:** None

### Q4: Should daily workflow batch sizes change after seeding?

| Option | Description | Selected |
|--------|-------------|----------|
| Same defaults | Keep 5/10/20 per daily run. Steady growth ~20 new questions/day. | ✓ |
| Smaller daily batches | Reduce to 2/5/10 for lower cost, slower growth. | |
| Larger daily batches | Bump to 10/20/40 for faster content growth but higher daily cost. | |

**User's choice:** Same defaults (5/10/20)
**Notes:** None

---

## Volume & Distribution

### Q1: How should questions be distributed across categories?

| Option | Description | Selected |
|--------|-------------|----------|
| Even spread | Target roughly equal coverage across all 12 categories. Category Agent picks least-covered categories first. | ✓ |
| Weighted toward popular | Weight Science, History, Movies & TV, Sports more heavily (2x questions). | |
| Organic/unguided | Let Category Agent pick freely without balancing. | |

**User's choice:** Even spread (least-covered-first)
**Notes:** None

### Q2: Should seed runs use larger batch sizes?

| Option | Description | Selected |
|--------|-------------|----------|
| Larger seed batches | Seed runs use bigger batches (e.g. 10/20/40) to maximize output per run. | ✓ |
| Same as daily defaults | Keep 5/10/20 batch sizes. Simpler, relies on frequency. | |
| You decide | Let Claude determine optimal sizes during planning. | |

**User's choice:** Larger seed batches
**Notes:** None

### Q3: Should difficulty levels be balanced during seeding?

| Option | Description | Selected |
|--------|-------------|----------|
| Natural assignment | Agents assign difficulty based on complexity. Distribution will be organic. | ✓ |
| Balanced targets | Guide Questions Agent to aim for ~33% Easy, ~40% Normal, ~27% Hard. | |

**User's choice:** Natural assignment
**Notes:** Crowd calibration in v2 will refine difficulty later.

---

## Budget & Cost Tolerance

### Q1: Total budget tolerance for the 48h seed burst?

| Option | Description | Selected |
|--------|-------------|----------|
| $100 total | ~$1-2/run × 96 runs. Generous margin. | |
| $50 total | Tighter budget. Achievable with careful tuning. | ✓ |
| $200 total | Very generous. Could produce 2000-3000+ questions. | |
| No hard cap | Trust per-run cap, monitor after the fact. | |

**User's choice:** $50 total
**Notes:** None

### Q2: Cumulative budget tracking or per-run caps?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-run cap only | Each run has budget cap. Auto-disable threshold is primary cost control. | ✓ |
| Cumulative tracking | Query total spend from pipeline_runs before starting. Extra safety net. | |

**User's choice:** Per-run cap only
**Notes:** Auto-disable at 1000+ questions should stop spending well before $50.

### Q3: Per-run budget cap for seed runs?

| Option | Description | Selected |
|--------|-------------|----------|
| $2.00 per run | Allows larger batch sizes while keeping each run bounded. | ✓ |
| $1.00 per run | Same as daily default. May need smaller batch sizes. | |
| $3.00 per run | More room for large batches. Burns through $50 faster. | |

**User's choice:** $2.00 per run
**Notes:** None

---

## Monitoring & Confidence

### Q1: How to track seeding progress?

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub Actions + DB query | Check via Actions run history and SQL queries against Supabase. No extra tooling. | ✓ |
| Summary in workflow output | Add a step that prints current totals at end of each run. | |
| Slack/Discord notifications | Send message after each run with stats. Requires webhook setup. | |

**User's choice:** GitHub Actions + DB query
**Notes:** Everything already captured in pipeline_runs table.

### Q2: What threshold defines 'seed complete'?

| Option | Description | Selected |
|--------|-------------|----------|
| 1000+ verified questions | Matches roadmap success criteria. verification_score >= 3. | ✓ |
| 1000+ total + category minimum | 1000+ verified AND 50+ per category. Prevents lopsided coverage. | |
| 1500+ verified questions | Higher target for richer launch database. | |

**User's choice:** 1000+ verified questions
**Notes:** None

### Q3: How should auto-disable be surfaced?

| Option | Description | Selected |
|--------|-------------|----------|
| Log + annotation | Print "SEED COMPLETE" message and create GitHub Actions annotation. | ✓ |
| Log only | Just log the message, no special notification. | |
| You decide | Let Claude determine best approach during planning. | |

**User's choice:** Log + annotation
**Notes:** None

---

## Claude's Discretion

- Exact seed batch sizes (suggested 10/20/40 but planner can optimize)
- Least-covered-first category selection algorithm
- Workflow YAML structure and step organization

## Deferred Ideas

None -- discussion stayed within phase scope.
