# Pipeline measurement, 2026-10-26

Produced by `pipeline/src/scripts/measure-pipeline.ts` (read-only: select/count only) against the production Supabase project.

## Output

```
== pipeline_runs (138 rows) ==
date       status     gen  ver  rej  qaPass qaRew qaRej   inTok     outTok    cost$
2026-04-06 success      50   46    4     46    16     0    122984     34147     0.39
2026-04-06 success      50   41    9     39     7     8    125406     35983     0.40
2026-04-06 success      50   45    5     49    14     1    124911     35346     0.40
2026-04-06 success      50   44    6     52    16    11    126278     42323     0.52
2026-04-06 success      50   43    7     60    19    10    137052     43701     0.56
2026-04-06 failed        0    0    0      0     0     0    180251     86563     1.01
2026-04-06 success      50   46    4    117    42     5    204120     63956     0.84
2026-04-06 success      50   44    6     55    25     2    275055     94469     0.99
2026-04-07 success      50   46    4     58    26     1    240834     78948     0.87
2026-04-07 success      50   37   13     48    20     1    175263     52840     0.67
2026-04-08 failed        0    0    0      0     0     0         0         0     0.00
2026-04-08 success      50   41    9     51    25     2    179541     55743     0.71
2026-04-09 failed        0    0    0      0     0     0         0         0     0.00
2026-04-10 failed        0    0    0      0     0     0         0         0     0.00
2026-04-11 failed        0    0    0      0     0     0         0         0     0.00
2026-04-12 failed        0    0    0      0     0     0         0         0     0.00
2026-04-12 success      10    7    3     20    10     1     42611     15133     0.20
2026-04-12 failed        0    0    0      0     0     0      1670       218     0.01
2026-04-12 failed        0    0    0      0     0     0      5993      1973     0.05
2026-04-12 success      20   18    2     33    14     0     80694     25779     0.77
2026-04-12 failed        0    0    0      0     0     0      1670        84     0.01
2026-04-12 success       3    3    0     23     5     0     25005      7702     0.24
2026-04-13 failed        0    0    0      0     0     0      1670       213     0.01
2026-04-14 success      20   18    2     39    10     0     83849     23578     0.72
2026-04-15 failed        0    0    0      0     0     0      1670       199     0.01
2026-04-16 failed        0    0    0      0     0     0      1670       208     0.01
2026-04-17 success      20   14    6     43    11     0     90895     24448     0.78
2026-04-18 success      20   17    3     41    10     1     87395     25174     0.77
2026-04-19 failed        0    0    0      0     0     0    148070     49607     1.00
2026-04-20 failed        0    0    0      0     0     0    136148     47705     1.00
2026-04-21 failed        0    0    0      0     0     0    142676     46381     1.00
2026-04-22 failed        0    0    0      0     0     0    156587     50423     1.00
2026-04-23 failed        0    0    0      0     0     0         0         0     0.00
2026-04-24 failed        0    0    0      0     0     0         0         0     0.00
2026-04-25 failed        0    0    0      0     0     0         0         0     0.00
2026-04-26 failed        0    0    0      0     0     0         0         0     0.00
2026-04-27 failed        0    0    0      0     0     0         0         0     0.00
2026-04-28 failed        0    0    0      0     0     0         0         0     0.00
2026-04-29 failed        0    0    0      0     0     0         0         0     0.00
2026-04-30 failed        0    0    0      0     0     0         0         0     0.00
2026-05-01 failed        0    0    0      0     0     0         0         0     0.00
2026-05-29 failed        0    0    0      0     0     0     92087     29304     1.00
2026-05-30 failed        0    0    0      0     0     0     93431     30375     1.00
2026-05-31 failed        0    0    0      0     0     0         0         0     0.00
2026-06-01 failed        0    0    0      0     0     0         0         0     0.00
2026-06-02 failed        0    0    0      0     0     0         0         0     0.00
2026-06-03 failed        0    0    0      0     0     0         0         0     0.00
2026-06-04 failed        0    0    0      0     0     0         0         0     0.00
2026-06-05 failed        0    0    0      0     0     0         0         0     0.00
2026-06-06 failed        0    0    0      0     0     0         0         0     0.00
2026-06-07 failed        0    0    0      0     0     0         0         0     0.00
2026-06-08 failed        0    0    0      0     0     0         0         0     0.00
2026-06-09 failed        0    0    0      0     0     0         0         0     0.00
2026-06-10 failed        0    0    0      0     0     0         0         0     0.00
2026-06-11 failed        0    0    0      0     0     0     55658     16100     0.47
2026-06-12 failed        0    0    0      0     0     0         0         0     0.00
2026-06-13 failed        0    0    0      0     0     0         0         0     0.00
2026-06-14 failed        0    0    0      0     0     0         0         0     0.00
2026-06-15 failed        0    0    0      0     0     0         0         0     0.00
2026-06-16 failed        0    0    0      0     0     0         0         0     0.00
2026-06-17 failed        0    0    0      0     0     0         0         0     0.00
2026-06-18 failed        0    0    0      0     0     0         0         0     0.00
2026-06-19 failed        0    0    0      0     0     0         0         0     0.00
2026-06-20 failed        0    0    0      0     0     0         0         0     0.00
2026-06-21 failed        0    0    0      0     0     0         0         0     0.00
2026-06-23 failed        0    0    0      0     0     0         0         0     0.00
2026-06-24 failed        0    0    0      0     0     0         0         0     0.00
2026-06-25 failed        0    0    0      0     0     0         0         0     0.00
2026-06-26 failed        0    0    0      0     0     0         0         0     0.00
2026-06-27 failed        0    0    0      0     0     0         0         0     0.00
2026-06-28 failed        0    0    0      0     0     0         0         0     0.00
2026-06-29 failed        0    0    0      0     0     0         0         0     0.00
2026-06-30 failed        0    0    0      0     0     0         0         0     0.00
2026-07-01 failed        0    0    0      0     0     0         0         0     0.00
2026-07-02 failed        0    0    0      0     0     0         0         0     0.00
2026-07-03 failed        0    0    0      0     0     0         0         0     0.00
2026-07-04 failed        0    0    0      0     0     0         0         0     0.00
2026-07-05 failed        0    0    0      0     0     0         0         0     0.00
2026-07-06 failed        0    0    0      0     0     0         0         0     0.00
2026-07-07 failed        0    0    0      0     0     0         0         0     0.00
2026-07-08 failed        0    0    0      0     0     0         0         0     0.00
2026-07-09 failed        0    0    0      0     0     0         0         0     0.00
2026-07-10 success      13   13    0      8     0   127     79775     28522     0.79
2026-07-11 failed        0    0    0      0     0     0         0         0     0.00
2026-07-12 failed        0    0    0      0     0     0         0         0     0.00
2026-07-13 failed        0    0    0      0     0     0         0         0     0.00
2026-07-14 failed        0    0    0      0     0     0         0         0     0.00
2026-07-15 failed        0    0    0      0     0     0         0         0     0.00
2026-07-16 failed        0    0    0      0     0     0         0         0     0.00
2026-07-17 failed        0    0    0      0     0     0         0         0     0.00
2026-07-18 failed        0    0    0      0     0     0         0         0     0.00
2026-07-19 failed        0    0    0      0     0     0         0         0     0.00
2026-07-20 failed        0    0    0      0     0     0         0         0     0.00
2026-07-21 failed        0    0    0      0     0     0         0         0     0.00
2026-07-22 failed        0    0    0      0     0     0         0         0     0.00
2026-07-23 failed        0    0    0      0     0     0         0         0     0.00
2026-07-24 failed        0    0    0      0     0     0         0         0     0.00
2026-07-25 failed        0    0    0      0     0     0         0         0     0.00
2026-07-26 failed        0    0    0      0     0     0         0         0     0.00
2026-07-27 failed        0    0    0      0     0     0         0         0     0.00
2026-07-28 failed        0    0    0      0     0     0         0         0     0.00
2026-07-29 failed        0    0    0      0     0     0         0         0     0.00
2026-07-30 failed        0    0    0      0     0     0         0         0     0.00
2026-07-31 failed        0    0    0      0     0     0         0         0     0.00
2026-08-01 failed        0    0    0      0     0     0         0         0     0.00
2026-08-02 failed        0    0    0      0     0     0         0         0     0.00
2026-08-03 failed        0    0    0      0     0     0         0         0     0.00
2026-08-04 failed        0    0    0      0     0     0         0         0     0.00
2026-08-05 failed        0    0    0      0     0     0         0         0     0.00
2026-08-06 failed        0    0    0      0     0     0         0         0     0.00
2026-08-07 failed        0    0    0      0     0     0         0         0     0.00
2026-08-08 failed        0    0    0      0     0     0         0         0     0.00
2026-08-09 success       8    6    2     73     0    72    147511     65901     1.83
2026-08-10 failed        0    0    0      0     0     0         0         0     0.00
2026-08-11 failed        0    0    0      0     0     0         0         0     0.00
2026-08-12 failed        0    0    0      0     0     0         0         0     0.00
2026-08-13 failed        0    0    0      0     0     0         0         0     0.00
2026-08-14 failed        0    0    0      0     0     0         0         0     0.00
2026-08-15 failed        0    0    0      0     0     0         0         0     0.00
2026-08-16 failed        0    0    0      0     0     0         0         0     0.00
2026-08-17 failed        0    0    0      0     0     0         0         0     0.00
2026-08-18 failed        0    0    0      0     0     0         0         0     0.00
2026-08-19 failed        0    0    0      0     0     0         0         0     0.00
2026-08-20 failed        0    0    0      0     0     0         0         0     0.00
2026-08-21 failed        0    0    0      0     0     0         0         0     0.00
2026-08-22 failed        0    0    0      0     0     0         0         0     0.00
2026-08-23 failed        0    0    0      0     0     0         0         0     0.00
2026-08-24 failed        0    0    0      0     0     0         0         0     0.00
2026-08-25 failed        0    0    0      0     0     0         0         0     0.00
2026-08-26 failed        0    0    0      0     0     0         0         0     0.00
2026-08-27 failed        0    0    0      0     0     0         0         0     0.00
2026-08-28 failed        0    0    0      0     0     0         0         0     0.00
2026-08-29 failed        0    0    0      0     0     0         0         0     0.00
2026-08-30 failed        0    0    0      0     0     0         0         0     0.00
2026-08-31 failed        0    0    0      0     0     0         0         0     0.00
2026-09-01 failed        0    0    0      0     0     0         0         0     0.00
2026-09-02 failed        0    0    0      0     0     0         0         0     0.00
2026-09-03 running       0    0    0      0     0     0         0         0     0.00
TOTAL                  614  529   85    855   270   242   3368430   1113046    20.04
runs by status: {"success":18,"failed":119,"running":1}

== derived rates (sums over all runs) ==
fact-check reject rate  = rejected / generated   = 85 / 614 = 13.8%
QA reject rate          = qa_rejected / verified = 242 / 529 = 45.7%
QA rewrite rate         = qa_rewritten / verified = 270 / 529 = 51.0%
QA pass rate            = qa_passed / verified   = 855 / 529 = 161.6%

== questions by status ==
parked               3
published            3216
rejected             262
verified             136
total                3617

== question_categories per category (depth >= 1; 259 categories, 10186 link rows total) ==
min 0 / median 5 / max 457
categories at 0: 21
```

## What this says about the two Opus passes (fact-check and QA)

**What the data shows**

- Only 18 of 138 runs succeeded (119 failed, 1 stuck in `running` since 2026-09-03). Most failed runs have zero tokens and zero cost, so they died before spending anything. Totals cover real work from only about 18 runs, mostly April 2026, plus 2026-07-10 and 2026-08-09.
- Total recorded `estimated_cost_usd` is about $20.04 (3.37M input / 1.11M output tokens) over the whole history. Caveat: many failed runs show a flat $1.00 cost, which looks like a cap or estimate rather than measured spend, so treat the total as approximate.
- Fact-check: 85 of 614 generated questions were rejected, 13.8%. Roughly 1 in 7 generated questions is stopped at this pass, so it is doing real filtering.
- QA: 270 rewrites and 242 rejects against 529 verified questions. Taken at face value this is 51.0% rewritten and 45.7% rejected, which would mean the pass touches nearly everything.
- Category balance (depth >= 1, 259 categories): min 0, median 5, max 457 questions per category; 21 categories have none. This is the baseline for the fewest-first balancing rule.

**What the data cannot show**

- **Per-stage cost is not derivable.** `pipeline_runs` stores a single token and cost total per run, with no split between generation, fact-check, QA, calibration or enrichment. We cannot say what the two Opus passes cost, or whether dropping either would save money. Answering that needs per-stage token logging (or a run with stages toggled).
- **QA rates are unreliable.** In several runs `qa_passed` + rewritten + rejected exceeds `questions_verified` (the QA pass count is 855 against 529 verified, i.e. 161.6%). QA evidently also processes questions outside the run's own verified set (backlog or re-checks), or counters overlap. The 2026-07-10 run (13 verified, 127 QA rejects) and 2026-08-09 run (6 verified, 72 QA rejects) are clear examples. So "QA reject rate = qa_rejected / verified" is not a true rate. Use it only as a rough upper bound.
- The numbers say nothing about whether QA/fact-check decisions are *correct*. A high reject rate is not evidence the pass is valuable; it could be over-strict. Judging that needs a sample of rejected and rewritten questions reviewed by hand.
- `questions.status` counts (published 3216, rejected 262, verified 136, parked 3) are current state, not per-stage outcomes, so they cannot be reconciled to the per-run counters. The run counters also cover only the recorded runs, not questions created by earlier or manual flows.
- Which model ran each stage is not in the columns this script reads, so "Opus" cost cannot be separated from cheaper-model cost from this data.

**Bottom line:** the fact-check pass demonstrably rejects about 14% of what it sees. The QA counters are too inconsistent to size the pass's effect. No decision to drop or downgrade either Opus pass is supported by this data alone.
