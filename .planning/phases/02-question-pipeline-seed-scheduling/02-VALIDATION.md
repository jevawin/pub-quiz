---
phase: 2
slug: question-pipeline-seed-scheduling
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| 02-01-01 | 01 | 1 | PIPE-02 | unit | `cd pipeline && npx vitest run tests/seed-threshold-check.test.ts -x` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | PIPE-02 | unit | `cd pipeline && npx vitest run tests/seed-threshold-check.test.ts -x` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | PIPE-02 | smoke | Manual review of YAML syntax | N/A | ⬜ pending |
| 02-02-01 | 02 | 1 | PIPE-03 | unit | `cd pipeline && npx vitest run tests/lib/category-selection.test.ts -x` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | PIPE-03 | smoke | `diff .github/workflows/question-pipeline.yml` against Phase 1 version | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `pipeline/tests/seed-threshold-check.test.ts` — stubs for PIPE-02 (threshold check, auto-disable, annotations)
- [ ] `pipeline/tests/lib/category-selection.test.ts` — stubs for PIPE-03 (least-covered-first category selection)

*Existing vitest infrastructure from Phase 1 covers framework setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Seed workflow YAML is valid | PIPE-02 | YAML syntax validation requires `actionlint` or CI run | Review YAML structure, verify cron schedule, env vars |
| Daily workflow unchanged | PIPE-03 | Regression check against git history | `git diff HEAD~1 .github/workflows/question-pipeline.yml` should show no changes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
