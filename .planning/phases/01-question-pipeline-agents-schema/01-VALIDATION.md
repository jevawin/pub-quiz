---
phase: 1
slug: question-pipeline-agents-schema
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-04
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (TypeScript-native) |
| **Config file** | `pipeline/vitest.config.ts` (Wave 0 installs) |
| **Quick run command** | `cd pipeline && npx vitest run --reporter=verbose` |
| **Full suite command** | `cd pipeline && npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd pipeline && npx vitest run --reporter=verbose`
- **After every plan wave:** Run `cd pipeline && npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-T1 | 01 | 1 | DB-01, DB-02 | static | `grep -c "CREATE TABLE" pipeline/supabase/migrations/*.sql` | ❌ W0 | ⬜ pending |
| 01-01-T2 | 01 | 1 | PIPE-01, PIPE-08, COST-03 | compile | `cd pipeline && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 01-02-T1 | 02 | 2 | PIPE-04 | unit (TDD) | `cd pipeline && npx vitest run tests/agents/category.test.ts` | ❌ created by task | ⬜ pending |
| 01-02-T2 | 02 | 2 | PIPE-05, PIPE-08 | unit (TDD) | `cd pipeline && npx vitest run tests/agents/knowledge.test.ts tests/lib/wikipedia.test.ts` | ❌ created by task | ⬜ pending |
| 01-03-T1 | 03 | 2 | PIPE-06 | unit (TDD) | `cd pipeline && npx vitest run tests/agents/questions.test.ts` | ❌ created by task | ⬜ pending |
| 01-03-T2 | 03 | 2 | PIPE-07 | unit (TDD) | `cd pipeline && npx vitest run tests/agents/fact-check.test.ts` | ❌ created by task | ⬜ pending |
| 01-04-T1 | 04 | 3 | PIPE-09, COST-03 | unit (TDD) | `cd pipeline && npx vitest run tests/run-pipeline.test.ts` | ❌ created by task | ⬜ pending |
| 01-04-T2 | 04 | 3 | PIPE-09 | static | `grep -q "schedule:" .github/workflows/question-pipeline.yml` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `pipeline/vitest.config.ts` — Vitest configuration (created by Plan 01-01 Task 2)
- [ ] `pipeline/tests/` — directory structure (created by TDD tasks in Plans 01-02, 01-03, 01-04)
- [ ] Framework install: `cd pipeline && npm install -D vitest` (Plan 01-01 Task 2)
- [ ] Mock helpers for Claude API responses (created by TDD tasks)
- [ ] Mock helpers for Supabase client (created by TDD tasks)

*Note: DB-01/DB-02 verified via static migration file inspection (grep). COST-03 budget logic verified via orchestrator tests in Plan 01-04. All agent test files created by their respective TDD tasks.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pipeline runs end-to-end in GitHub Actions | PIPE-09 | Requires GitHub environment and secrets | Trigger `gh workflow run question-pipeline.yml`, verify run completes successfully |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
