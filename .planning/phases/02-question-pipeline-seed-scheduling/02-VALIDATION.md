---
phase: 2
slug: question-pipeline-seed-scheduling
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-05
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x |
| **Config file** | `pipeline/vitest.config.ts` |
| **Quick run command** | `cd pipeline && npm test` |
| **Full suite command** | `cd pipeline && npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd pipeline && npm test`
- **After every plan wave:** Run `cd pipeline && npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | PIPE-02 | unit | `cd pipeline && npx vitest run tests/seed-threshold-check.test.ts -x` | ✅ TDD | ⬜ pending |
| 02-01-02 | 01 | 1 | PIPE-02 | unit | `cd pipeline && npx vitest run tests/agents/questions.test.ts -x` | ✅ exists | ⬜ pending |
| 02-02-01 | 02 | 2 | PIPE-02, PIPE-03 | smoke | `git diff --exit-code .github/workflows/question-pipeline.yml && grep -c seed-threshold-check .github/workflows/seed-pipeline.yml` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 is satisfied by the TDD approach in Task 02-01-01. That task is marked `tdd="true"` and its `<behavior>` block defines test expectations for both:

- `pipeline/tests/seed-threshold-check.test.ts` — created as part of TDD RED phase in Task 02-01-01
- `pipeline/tests/lib/category-selection.test.ts` — created as part of TDD RED phase in Task 02-01-01

No separate Wave 0 pre-execution step is needed.

*Existing vitest infrastructure from Phase 1 covers framework setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Seed workflow YAML is valid | PIPE-02 | YAML syntax validation requires `actionlint` or CI run | Review YAML structure, verify cron schedule, env vars |
| Daily workflow unchanged | PIPE-03 | Regression check against git history | `git diff --exit-code .github/workflows/question-pipeline.yml` should show no changes |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (satisfied by TDD task structure)
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
