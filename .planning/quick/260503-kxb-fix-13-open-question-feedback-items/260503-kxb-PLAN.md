---
phase: quick-260503-kxb
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: []
autonomous: true
requirements: [KXB-01]
must_haves:
  truths:
    - "All 7 flagged questions have been corrected per ROADMAP 999.17 spec"
    - "All 13 question_feedback rows have resolved_at + resolved_note set"
    - "Open question_feedback inbox count = 0 after run"
---

<objective>
Resolve 13 open `question_feedback` rows per ROADMAP 999.17 (May 2026 batch). 7 question rewrites + 6 mark-resolved (no-action) covering 12 distinct questions. Same workflow as 260424-uju / 260426-myq / 260428-rfe — DB-only `supabase db query --linked` UPDATEs, no app code.
</objective>

## Mapping

| # | qid | feedback_id | action |
|---|---|---|---|
| 1 | 00356aeb | 3d23c4ab-792d-4324-9b46-e610bf02d31a | rewrite Q + answers (binary) |
| 2 | 87d46d3f | 64aded68-2121-4cf5-b107-4a4256b53f81 | rewrite Q + correct=Rhydon, distractors |
| 3 | 3f39d670 | 73e8f501-8a0d-4608-b07e-7c9d79fa7c59 | "apart of" → "a part of" |
| 4 | c59f2a01 | 15a3d7bb-2355-4efe-a6ae-804f092f79b4 | capitalise all options |
| 5 | 082aaa09 | 1b29f772-6fa1-422d-ae4c-0878ec0462cf | add "the" |
| 6 | e9ebf25a | 298c4662-331e-4c73-aadc-d54cb3a4abf5 | drop duplicated "was" |
| 7 | 90422fe9 | 55530bc2-64b6-4480-b618-66cab0cbaf23 | canonicalise Q (é) + rewrite fun_fact |
| 8 | c130bc2c | 8c90ec82-c5f1-4744-9235-7c4906ff7fbc | mark resolved → 999.19 |
| 9 | eb1e90a5 | b0ccb748-e16c-4812-889a-ae8e642465c8 | mark resolved → 999.16 |
| 10 | 291841bc | 9f1ec5e3-f2c1-4d28-bbc9-3be5747428be | mark resolved (already hard) |
| 11 | 74d15a90 | 8c7935c8-96f2-483d-8de0-1f7a190745cc | mark resolved → 999.18 |
| 12 | 74d15a90 | 922cccd0-3700-4272-b8ce-4df93b08f12d | mark resolved → 999.18 |
| 13 | 7add0d30 | 20f13744-6859-4b62-9111-7d07d3433931 | mark resolved → 999.18 |

## Verify

```sql
SELECT count(*) FROM question_feedback WHERE resolved_at IS NULL;
-- Expect: 0
```
