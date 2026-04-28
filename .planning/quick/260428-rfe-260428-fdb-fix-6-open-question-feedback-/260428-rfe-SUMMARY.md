---
phase: quick-260428-rfe
status: complete
completed_date: 2026-04-28
tags: [feedback, manual-rewrite, question_feedback]
---

# Quick Task 260428-rfe (260428-fdb): fix 6 open question_feedback items

Manual rewrites + resolution of 6 open `question_feedback` rows accumulated 2026-04-27/28. Same workflow as 260424-uju and 260426-myq.

## Items resolved

| feedback id | qid | issue | fix |
|---|---|---|---|
| f2285df6 | 09aa4f7e | "Fact doesn't make sense" — falsely claimed John Lennon's first name was James | Rewrote fun_fact: "He's been called Paul since childhood — when knighted in 1997, he became Sir James McCartney in formal correspondence." |
| b17185e1 | aed6cc1d | "Badly worded" — double "in", awkward | Q: "In which Disney movie can you spot Pac-Man hidden in some scenes?" |
| 19e7b757 | 22aeee49 | "Keyboard not capitalised here" | Q: "How many keys are on a standard Windows keyboard?" |
| 09f0fd8b | f746e6a0 | "Chemical is singular" — verb agreement | Q: "Which of the following chemicals is found in eggplant seeds?" |
| d8e55749 | 291ffce3 | "Confusing fact badly written" — muddled France-final phrasing | Rewrote: "New Zealand won the final 29–9 at Eden Park as co-hosts. France have now lost all three Rugby World Cup finals they have reached — 1987, 1999, and 2011." |
| d9c362dd | 3267b640 | "Should be 'who' not 'which' for people" | Q: "Who created and directed the Katamari Damacy series?" |

All rows updated via service-role PATCH on `questions`. All `question_feedback` rows marked `resolved_at` + `resolved_note`. Open inbox count: 0.

## Why agent-side follow-up

3 of 6 items were grammar issues in OpenTDB-imported questions (capitalisation, verb agreement, awkward phrasing, "which"/"who"). This is exactly the pattern Phase 2.6 (refocused as grammar+style pass) is designed to solve in bulk. 1 item was a wrong fun_fact — feeds into 260428-fact (Enrichment Agent prompt tightening).
