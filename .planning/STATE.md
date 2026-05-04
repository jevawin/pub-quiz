---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Phase 999.20 PAUSED — pivoting to chain-tagging architecture (one more discussion pass needed)
stopped_at: 999.20 paused mid-session. Surfaced architectural pivot to chain tagging (per-level scoring). Need re-discussion before starting. See .planning/phases/999.20-recategorise-single-cat-questions/DISCUSSION-NOTE.md
last_updated: "2026-05-04T22:00:00.000Z"
last_activity: 2026-05-04 -- 999.20 paused; pivot sketched to 999.21 (categories cleanup) + 999.22 (chain tagging + backfill); discussion note written
progress:
  total_phases: 31
  completed_phases: 5
  total_plans: 23
  completed_plans: 23
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-04)

**Core value:** Great questions delivered through a clean, effortless interface -- the content is the star, not the chrome around it.
**Current focus:** 999.20 PAUSED. Pivoting to chain-tagging architecture (999.21 cleanup → 999.22 chain backfill). One more discussion pass before starting.

## Current Position

Phase: 999.20 — PAUSED mid-session 2026-05-04. Pivot sketched but not confirmed.

**Resume instructions for next session (when fresh):**
1. Read `.planning/phases/999.20-recategorise-single-cat-questions/DISCUSSION-NOTE.md` in full.
2. Re-discuss the pivot (any objections, missed angles).
3. Confirm phase order: 999.21 categories cleanup → 999.22 chain tagging + backfill.
4. If confirmed: retire 999.20, add 999.21 + 999.22 properly via `/gsd-discuss-phase`.
5. Setup work preserved: dump script, `data/single-cat.json` (453 Qs + 139 cats), PROGRESS.md, batch 1 draft (in chat transcript only — not applied to DB).

Active tracks (per ROADMAP §C):

- C1 quick tasks: 260428-fact (pending — Enrichment fun_fact prompt tightening)
- C2 sequenced library work: **999.20 PAUSED** → pivot to **999.21 (categories cleanup) → 999.22 (chain tagging + backfill)** → 999.18 → 999.19 → 999.16. Order TBC pending re-discussion.

Build path queue (after prototype proves out):

- Phase 2.3 Admin Dashboard, 2.5 OpenTDB Attribution
- Phase 3-8: Auth, Design, Shell, Browser, Engine, Cache

Last activity: 2026-05-04 -- Phase 999.20 batch 1 reviewed; Phase 2.4 (was 999.8) shipped earlier today

## Performance Metrics

| Phase 01 P01 | 3min | 2 tasks | 19 files |
| Phase 01 P02 | 6min | 2 tasks | 7 files |
| Phase 01 P03 | 14min | 2 tasks | 4 files |
| Phase 01 P04 | 3min | 2 tasks | 3 files |
| Phase 02 P01 | 4min | 2 tasks | 6 files |
| Phase 02 P02 | 117s | 1 tasks | 1 files |
| Phase 02.1 P01 | 4min | 2 tasks | 9 files |
| Phase 02.1 P02 | 5min | 2 tasks | 3 files |
| Phase 02.1 P03 | 5min | 2 tasks | 4 files |
| Phase 02.2 P05 | 4min | 2 tasks | 6 files |
| Phase 999.8 P02 | 4min | 2 tasks | 2 files |
| Phase 999.8 P01 | 3min | 2 tasks | 6 files |
| Phase 999.8 P03 | 7min | 3 tasks | 7 files |
| Phase 999.8 P04 | 8min | 2 tasks | 7 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Pipeline is highest priority (Phase 1) -- runs in background while app is built
- Pipeline execution environment to be stress-tested during Phase 1 planning (PIPE-09)
- Cost management woven into relevant phases, not a separate phase
- No timer in MVP (answer at own pace)
- No multiplayer/social in v1
- [Phase 01]: Manual Database types as temporary bridge until supabase gen types is run
- [Phase 01]: ESLint 9 flat config with typescript-eslint (not legacy .eslintrc.json)
- [Phase 01]: AgentResult interface standardized as { processed, failed } for all pipeline agents
- [Phase 01]: database.types.ts requires Relationships arrays and PostgrestVersion for supabase-js v2 type resolution
- [Phase 01]: Rejected questions count as failed in return value but don't trigger error throw -- only actual processing errors cause agent-level failure
- [Phase 01]: Auto-publish threshold is score >= 3 only; score 1-2 gets verified but not published (safety measure) -- SUPERSEDED by D-03 in Phase 02.1
- [Phase 01]: Self-execution guard via process.argv check for testability in pipeline orchestrator
- [Phase 01]: Concurrent run guard exits 0 (skip, not error) to avoid false CI alerts
- [Phase 02]: Real temp file for testing GITHUB_OUTPUT writes (ESM cannot spy on node:fs)
- [Phase 02]: Category selection uses count queries with head:true for efficiency
- [Phase 02]: MIN_QUESTIONS_THRESHOLD kept as local constant, passed as param to shared module
- [Phase 02]: Used inputs.* syntax for workflow_dispatch defaults in seed-pipeline.yml
- [Phase 02.1]: D-03 enforced: auto-publish removed from Fact-Check Agent, deferred to QA Agent
- [Phase 02.1]: relevanceThreshold defaults to 0.6 via RELEVANCE_THRESHOLD env var
- [Phase 02.1]: QA Agent uses same batching and Haiku pattern as Fact-Check Agent for consistency
- [Phase 02.2]: Used vi.hoisted() for mock variables in vitest tests
- [Phase 02.2]: Setup screen uses local useState for picker state -- three values don't need reducer
- [Phase 260417-vpl]: Category Agent: all-duplicates returns {0,0} without throwing; pipeline workflow opens GitHub issue on failure
- [Phase 999.8]: Migration 00022 adds question_categories join table only; old questions columns (category_id, difficulty, calibration_percent) stay until Plan 05 drop migration
- [Phase 999.8]: question_categories FK to categories uses ON DELETE RESTRICT — deleting a category is intentional and should fail if rows reference it
- [Phase 999.8]: Wave 0 test files intentionally import non-existent modules to force red state until Wave 2-3 creates them
- [Phase 999.8]: Integration tests use describe.skipIf(!process.env.SUPABASE_TEST_URL) so CI runs cleanly without live test DB
- [Phase 999.8]: QuestionGeneratedSchema uses Zod .refine() to reject 'general-knowledge' in category_slugs at parse time
- [Phase 999.8]: calibrateQuestion exported with explicit client parameters for testability
- [Phase 999.8]: backfillBatch instantiates claude client + config internally — callers only pass supabase + tokenAcc + limit
- [Phase 999.8]: Used UPDATE not UPSERT for observed-score refresh — UPSERT would violate NOT NULL on estimate_score
- [Phase 999.8]: question_plays added to database.types.ts manually (missing from generated types)

### Roadmap Evolution

- Phase 2.1 inserted after Phase 2: Question Pipeline -- QA Agent & Source Relevance (URGENT)
- Phase 999.8 promoted to Phase 2.4 (Multi-Category + Per-Category % Difficulty) on 2026-04-26
- Phase 999.13 promoted to Phase 2.5 (OpenTDB Attribution) on 2026-04-26
- ROADMAP restructured 2026-05-03 (260503-rmp) into 3 sections: A. Build Path / B. Post-launch / C. Prototype Iteration (with C1 quick / C2 sequenced / C3 add-new); D archive consolidates resolved + promoted + superseded + quick-task specs

### Pending Todos

None yet.

### Blockers/Concerns

- Claude Code Remote Triggers has known HTTP 500 errors (April 2026) -- GitHub Actions cron is the fallback. Must be evaluated in Phase 1.
- 260426-bkf (deferred): Phase 2.4 Plan 05 schema cleanup blocked until ~600 published questions get question_categories rows. Old columns coexist fine; defer until next dedicated session or before any work that reads/writes legacy category_id/difficulty/calibration_percent.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260417-vpl | Fix Category Agent duplicates + add pipeline failure notification | 2026-04-17 | ff07952 | [260417-vpl-fix-category-agent-duplicates-add-pipeli](./quick/260417-vpl-fix-category-agent-duplicates-add-pipeli/) |
| 260418-stj | Add balanced General Knowledge quiz RPC (round-robin across roots) | 2026-04-18 | 0210ea0 | [260418-stj-add-general-knowledge-quiz-mode-with-bal](./quick/260418-stj-add-general-knowledge-quiz-mode-with-bal/) |
| 260418-st9 | Add live question count display to category pills in Setup | 2026-04-18 | 81288e6 | [260418-st9-add-live-question-count-display-to-categ](./quick/260418-st9-add-live-question-count-display-to-categ/) |
| 260419-oig | Fix duplicate local migration 00011 files (resolved-before-execution) | 2026-04-19 | 15511b3 | [260419-oig-fix-duplicate-local-migration-00011-file](./quick/260419-oig-fix-duplicate-local-migration-00011-file/) |
| 260419-oxa | Fix pipeline test suite drift (7 failing tests -> all green, 94/94) | 2026-04-19 | 8c0e007 | [260419-oxa-fix-pipeline-test-suite-drift](./quick/260419-oxa-fix-pipeline-test-suite-drift/) |
| 260419-pma | Tighten Category + Questions Agent prompts for pub quiz tone (closes 999.3, 999.4) | 2026-04-19 | 47d3432 | [260419-pma-tighten-category-questions-agent-prompts](./quick/260419-pma-tighten-category-questions-agent-prompts/) |
| 260424-tla | Add pipeline tracking columns + feedback resolution mechanism (migrations 00019-00021) | 2026-04-24 | 8fb242e | [260424-tla-add-pipeline-tracking-columns-and-feedba](./quick/260424-tla-add-pipeline-tracking-columns-and-feedba/) |
| 260424-uju | Fix 11 flagged feedback questions, mark all resolved | 2026-04-24 | e10cbaf | [260424-uju-fix-11-flagged-feedback-questions-and-ma](./quick/260424-uju-fix-11-flagged-feedback-questions-and-ma/) |
| 260426-czq | Wire fun_fact through to web quiz UI (migration 00024 + types + reveal render) | 2026-04-26 | be3a90a | [260426-czq-wire-fun-fact-through-to-web-quiz-ui](./quick/260426-czq-wire-fun-fact-through-to-web-quiz-ui/) |
| 260426-myq | Fix 3 open question_feedback items: 2 reworded questions + answer button focus-visible CSS fix | 2026-04-26 | b4ca9f0 | [260426-myq-fix-3-open-question-feedback-items](./quick/260426-myq-fix-3-open-question-feedback-items/) |
| 260426-ow2 | Fix sport category filter bug — migration 00025 filters via question_categories with legacy fallback | 2026-04-26 | 731785c | [260426-ow2-260427-spt-fix-sport-category-filter-bug](./quick/260426-ow2-260427-spt-fix-sport-category-filter-bug/) |
| 260426-pxh | Within-session question dedup — drop stale-repeat fallback + greedy category interleave | 2026-04-26 | 1b7b54c | [260426-pxh-260427-dup-within-session-question-dedup](./quick/260426-pxh-260427-dup-within-session-question-dedup/) |
| 260427-uf1 | End-of-quiz per-question Round summary | 2026-04-27 | 3902d79 | [260427-uf1-260427-end-end-of-quiz-per-question-summ](./quick/260427-uf1-260427-end-end-of-quiz-per-question-summ/) |
| 260427-qol | UI QoL polish — icons, palette, callouts, button colours | 2026-04-27 | 5927771 | (inline) |
| 260428-rfe | Fix 6 open question_feedback items (260428-fdb) | 2026-04-28 | (db-only, no commit) | [260428-rfe-260428-fdb-fix-6-open-question-feedback-](./quick/260428-rfe-260428-fdb-fix-6-open-question-feedback-/) |
| 260428-tao | Show/hide facts toggle on Play header + End Round summary (sessionStorage-persisted, default ON) | 2026-04-28 | 45cbf64 | [260428-tao-260428-end-toggle-show-hide-facts-toggle](./quick/260428-tao-260428-end-toggle-show-hide-facts-toggle/) |
| 260503-kxb | Fix 13 open question_feedback items per ROADMAP 999.17 (7 rewrites + 6 mark-resolved) | 2026-05-03 | (db-only, no commit) | [260503-kxb-fix-13-open-question-feedback-items](./quick/260503-kxb-fix-13-open-question-feedback-items/) |
| 260503-rmp | Restructure ROADMAP into three tracks (build path / post-launch / prototype iteration) + archive | 2026-05-03 | TBD | [260503-rmp-restructure-roadmap-three-tracks](./quick/260503-rmp-restructure-roadmap-three-tracks/) |
| 260427-prm | Questions Agent prompt nudges — British English, acronym expansion, year-of-release cap | 2026-05-03 | 3167422 | [260427-prm-questions-agent-prompt-nudges](./quick/260427-prm-questions-agent-prompt-nudges/) |

## Session Continuity

Last session: 2026-05-03
Stopped at: Phase 2.2 prototype iteration; 260426-bkf backfill deferred
Last activity: 2026-05-03 - Completed quick task 260427-prm: Questions Agent prompt nudges (British English + acronym expansion + year-of-release cap)
Prior activity:

- 2026-05-03 - Restructured ROADMAP into 3 tracks (260503-rmp); fixed 13 question_feedback items (260503-kxb)
- 2026-04-28 - Shipped facts toggle on Play header + End Round summary (260428-tao)
- 2026-04-19 - Closed 999.5 (OpenTDB import done); added 999.13 (provenance column + About/Credits)
