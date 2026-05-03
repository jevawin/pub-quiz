---
phase: quick-260503-kxb
status: complete
completed_date: 2026-05-03
tags: [feedback, manual-rewrite, question_feedback, roadmap-999.17]
---

# Quick Task 260503-kxb: fix 13 open question_feedback items (ROADMAP 999.17)

Manual rewrites + resolution of 13 open `question_feedback` rows accumulated 2026-04-28 → 2026-05-02. Same workflow as 260424-uju / 260426-myq / 260428-rfe.

## Rewrites (7)

| qid | feedback_id | issue | fix |
|---|---|---|---|
| 00356aeb | 3d23c4ab | "Binary isn't a programming language" | Q rewritten: "If you were to write software using 1s and 0s, what would you be writing in?" — distractors now Machine code / Python / C++. |
| 87d46d3f | 64aded68 | "Internet says rhydon" | Canonicalised to Sugimori-cited Rhydon. Q: "According to Ken Sugimori, which Pokémon was the first ever designed?" Distractors: Bulbasaur / Mew / Clefairy. |
| 3f39d670 | 73e8f501 | "Apart" | Q: "What character is NOT a part of the Grand Theft Auto series?" |
| c59f2a01 | 15a3d7bb | "All lowercase" | Capitalised: Transistor / Tube / Diode / P-N junction. |
| 082aaa09 | 1b29f772 | Grammar (missing article) | Q: 'Which one of these is the scientific term for "Brain Freeze"?' |
| e9ebf25a | 298c4662 | Duplicated `was` | Q: "Which of the following was Brazil a former colony of?" |
| 90422fe9 | 55530bc2 | Carlos Estevez missing é + meta fact | Q: "By what name is Carlos Estévez better known?" Fun_fact rewritten to drop "this batch" meta-reference (Charlie Sheen ↔ Martin Sheen ↔ Fulton J. Sheen lineage). |

## Mark resolved (no-action, 6)

| qid | feedback_id | reason |
|---|---|---|
| c130bc2c | 8c90ec82 | Covered by Phase 999.19 theme-skew audit (Overwatch volume). |
| eb1e90a5 | b0ccb748 | Flagged for Phase 999.16 style guide (year-distractors ±1yr). |
| 291841bc | 9f1ec5e3 | Already hard; no change. |
| 74d15a90 | 8c7935c8 | Covered by Phase 999.18 UI bundle (touch-highlight on scroll). |
| 74d15a90 | 922cccd0 | Covered by Phase 999.18 UI bundle (touch-highlight on scroll). |
| 7add0d30 | 20f13744 | Covered by Phase 999.18 UI bundle (cat picker X overlap + pre-highlighted answer). |

## Verification

```sql
SELECT count(*) FROM question_feedback WHERE resolved_at IS NULL;
-- → 0
```

All 7 question rewrites verified via SELECT. Inbox open count: **0**.
