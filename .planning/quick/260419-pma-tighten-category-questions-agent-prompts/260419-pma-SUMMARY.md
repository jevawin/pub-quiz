---
phase: 260419-pma
plan: 01
subsystem: pipeline
tags: [pipeline, prompts, category-agent, questions-agent, tone]
requires: []
provides:
  - Depth-aware Category Agent prompt (strict root/mid, permissive leaf)
  - Classic UK pub-quiz tone in Questions Agent (answer-first, no comprehension framing)
affects:
  - pipeline/src/agents/category.ts
  - pipeline/src/agents/questions.ts
tech-stack:
  added: []
  patterns:
    - "Shared vocabulary between Questions Agent prompt and QA Agent rules (according to source/reference/text/article/paragraph)"
    - "Depth-based suitability gate: strict top-of-tree, permissive leaves"
key-files:
  created:
    - .planning/quick/260419-pma-tighten-category-questions-agent-prompts/260419-pma-SUMMARY.md
  modified:
    - pipeline/src/agents/category.ts
    - pipeline/src/agents/questions.ts
decisions:
  - "Keep niche categories as opt-in specialist leaves (PROJECT.md niche-topics promise preserved)"
  - "Prune academic/technical feel only at depth 0-1; depth 2-3 stays permissive"
  - "Breadth rule is prompt guidance only — no hard rejection; QA Agent handles feedback"
  - "Classic UK pub quiz tone reference, example-driven prompt (Geoff Hurst, Mercury, Yen)"
  - "Seed category for dry-run: Video Game Franchises (314 questions, depth=1, mixed quality, heavy OpenTDB legacy)"
metrics:
  duration: ~15min
  completed: 2026-04-19
  tasks: 3
  files_touched: 3
---

# Quick Task 260419-pma: Tighten Category + Questions Agent prompts Summary

Prompt-only edits to Category and Questions Agents. Category Agent now distinguishes strict root/mid ("must pass pub test") from permissive leaf ("niche is welcome"). Questions Agent now has explicit classic UK pub-quiz tone section with answer-first good/bad pairs and a comprehension-framing ban that shares vocabulary with the QA Agent downscore rules. Closes backlog items 999.3 and 999.4.

## Changes

### Task 1: Category Agent (`pipeline/src/agents/category.ts`)

- Added **Depth Rule** section: depth 0/1 must pass pub test (reject Thermodynamics, Epistemology, Macroeconomics, Organic Chemistry, Linguistics, Quantum Mechanics, Cellular Biology, vague genre labels). Depth 2/3 allows niche (Harry Potter > Quidditch, Star Wars > Expanded Universe Novels, Pokemon > Gen 1 Types).
- Reinforced **What Works**: niche leaves explicitly welcome at depth 2-3.
- Extended **What Doesn't Work**: academic disciplines at root/mid explicitly banned with counter-example (Thermodynamics belongs as a leaf under Science > Famous Experiments, not a standalone round).

Commit: `c257dfc`

### Task 2: Questions Agent (`pipeline/src/agents/questions.ts`)

- Added **Tone** section: "classic UK pub quiz", "answer-first phrasing", "one breath to read aloud". Three inline good/bad pairs (Geoff Hurst hat-trick, Mercury, Yen).
- Strengthened **Anti-Patterns**: replaced vague "Referencing source material" with explicit comprehension-framing ban using the exact vocabulary the QA Agent downscores on (`according to the source/reference/text/article/paragraph`). Added hedged-opener ban.
- Added **Rule 1**: "Favour questions a table of 3+ ordinary adults would have a genuine shot at. Niche-specialist knowledge belongs in niche category rounds, not general ones." Prompt guidance only — QA Agent still owns the feedback loop.

Commit: `794a422`

## Dry-Run Comparison — Seed Category: Video Game Franchises

Depth=1 leaf under a games root. 314 existing questions, the highest-count category in the DB, with visible legacy from the OpenTDB import — mixed tone, inconsistent formatting, quirky phrasing. A good stress-test: a niche-ish topic where the AFTER set still needs to feel like a quizmaster talking, not a walkthrough guide.

### BEFORE (20 questions — pulled from live DB, generated under OLD prompts)

1. In the game Silent Hill 2, who was James Sunderland's late wife? — **Mary** (normal)
2. Which video game was recalled for containing a hidden, playable South Park episode? — **Tiger Woods 99 PGA Tour** (hard)
3. In CoD: Black Ops III, what is the name of the rogue A.I. antagonist? — **Corvus** (easy)
4. When was the first Call of Duty title released? — **October 29, 2003** (hard)
5. What happened to Half-Life 2 prior to its release, which resulted in Valve starting over the development of the game? — **The source code got leaked** (normal)
6. Without enchantments, which pickaxe in minecraft mines blocks the quickest. — **Golden** (normal)
7. If you play the Super Mario RPG and nap in a rented hotel room, you will wake up next to what familiar looking character? — **Link** (normal)
8. What's the famous line Vaas says in "Far Cry 3"? — **Did I ever tell you the definition of Insanity?** (normal)
9. What is the name of the prison in "Half Life 2"? — **Nova Prospekt** (normal)
10. What year was Super Mario Bros. released? — **1985** (easy)
11. How many obsidian blocks are required to build a nether portal in Minecraft? — **10** (easy)
12. Which popular First Person Shooter (FPS) franchise, got a Real Time Strategy (RTS) game developed based on its universe? — **Halo** (easy)
13. When was Steam first released? — **2003** (hard)
14. What was the first game in the "Battlefield" series? — **Battlefield 1942** (easy)
15. In "Rainbow Six: Siege", which of the following operators cannot breach reinforced walls? — **Buck** (easy)
16. What is the main theme song of "Sonic Adventure 2"? — **Live and Learn** (hard)
17. The city of Rockport is featured in which of the following video games? — **Need for Speed: Most Wanted (2005)** (normal)
18. What is the name of your team in Star Wars: Republic Commando? — **Delta Squad** (hard)
19. The original mascot of the popular Nintendo game, "Splatoon" was going to be... — **Mario** (normal)
20. What was the name of the game created by Masahiro Sakurai and Satoru Iwata that would eventually evolve into "Super Smash Bros."? — **Dragon King: The Fighting Game** (hard)

### AFTER (20 questions — live Sonnet 4.5 output under NEW prompts)

Generated via a direct Anthropic API call using the committed Questions Agent `SYSTEM_PROMPT` against the same seed category. 2047 input tokens, 2432 output tokens (~$0.04 for 20 questions).

1. What colour is Pac-Man? — **Yellow** (easy)
2. Which Italian city is the Assassin's Creed II protagonist Ezio from? — **Florence** (normal)
3. In Portal, what's the name of the AI that guides you through the tests? — **GLaDOS** (normal)
4. What type of creature is Spyro? — **Dragon** (easy)
5. Which Final Fantasy game introduced the materia system? — **Final Fantasy VII** (normal)
6. What's the name of Link's horse in The Legend of Zelda series? — **Epona** (easy)
7. Which Metal Gear Solid game features a boss fight where you wait for the enemy to die of old age? — **Metal Gear Solid 3** (hard)
8. What colour shell gives you wings in the Mario Kart series? — **Blue** (easy)
9. Which Grand Theft Auto game is set in Vice City? — **Grand Theft Auto: Vice City** (normal)
10. What's the name of the protagonist in the Tomb Raider series? — **Lara Croft** (easy)
11. In which city is the original Resident Evil mansion located? — **Raccoon City** (normal)
12. What's the name of Kirby's home planet? — **Pop Star** (hard)
13. Which Street Fighter character is known for the Hadouken move? — **Ryu** (normal)
14. What does the acronym RPG stand for in gaming? — **Role-Playing Game** (easy)
15. Which Dark Souls game features the area called Anor Londo? — **Dark Souls** (normal)
16. What's the name of the currency in the Fallout series? — **Caps** (normal)
17. Which Pokémon appears on the cover of Pokémon Red? — **Charizard** (easy)
18. What's the maximum number of players in a standard Fortnite Battle Royale match? — **100** (normal)
19. Which company created the Uncharted series? — **Naughty Dog** (normal)
20. In Tetris, what's the name given to the straight four-block piece? — **I-piece** (hard)

### Qualitative verdict (Claude's side)

Clear tone shift toward classic UK pub quiz. The BEFORE set shows the legacy the new prompts are trying to correct: unnecessary clauses ("which of the following" x3), clunky openers ("The original mascot of the popular Nintendo game…"), wall-of-text phrasing (Q5 at ~130 chars, Q20 at ~120 chars), question marks missing (Q6), whole-sentence quotations as answers (Q8), inconsistent casing ("minecraft"). None of it is comprehension framing per se, but a lot of it reads like a walkthrough guide rather than a quizmaster.

The AFTER set is noticeably tighter. Every question is answer-first, every one fits in one breath, openers are consistently "What…", "Which…", "In…". No "according to the source" or "it is said that" leakage. Distractors stay inside the correct domain (all Italian cities for Q2, all AI names for Q3, all Final Fantasy games for Q5, all Nintendo horses/companions for Q6) — no mixed-domain slips. Difficulty mix (7 easy / 10 normal / 3 hard) is slightly off target (should be ~35/45/20 → 7/9/4) but within tolerance.

Regressions to watch:
- **Q9 has the answer in the question** (Vice City → Grand Theft Auto: Vice City). The Questions Agent's own code-level answer-in-question check should catch this at insert time, and the QA Agent would flag it. Not a prompt failure, but a reminder the downstream guards matter.
- **Q4 distractors slightly uneven** (Dragon vs Dinosaur vs Lizard vs Griffin — Griffin is a stretch given the others are real animals). Minor.
- **Q7 hard rating is right**, but "wait for the enemy to die of old age" is a known meme — may feel borderline niche for a general VG round.

Overall: the prompt change delivers what 999.4 asked for. AFTER feels like a pub quiz. BEFORE feels like a trivia archive dump.

## Self-Check: PASSED

- pipeline/src/agents/category.ts — FOUND, commit c257dfc
- pipeline/src/agents/questions.ts — FOUND, commit 794a422
- .planning/quick/260419-pma-tighten-category-questions-agent-prompts/260419-pma-SUMMARY.md — FOUND (this file)
- Typecheck (`npx tsc --noEmit`): clean
- Tests: `agents/category` 12/12, `agents/questions` 14/14
- Checkpoint verification: BEFORE/AFTER blocks present, seed category named, verdict paragraph written

## Awaiting Approval (checkpoint:human-verify)

Please:
1. Read the BEFORE and AFTER blocks above side-by-side.
2. Confirm the AFTER set feels more like a classic UK pub quiz (answer-first, conversational, no comprehension framing).
3. Spot-check the Category Agent Depth Rule in `pipeline/src/agents/category.ts` (lines ~112-119).
4. Type **"approved"** to close the checkpoint, or describe issues + which sample numbers exemplify them and I'll revise and re-run.

---

## REVISION 1 — Answer-in-question leakage ban

User flagged Q9 ("Which Grand Theft Auto game is set in Vice City?" → Grand Theft Auto: Vice City) and Q15 ("Which Dark Souls game features the area called Anor Londo?" → Dark Souls) from the AFTER set as embedding the answer (or near-answer) in the question text.

### Prompt change

Added an explicit Anti-Patterns rule to the Questions Agent `SYSTEM_PROMPT` covering franchise/title leakage. Uses the user's canonical good/bad pairs verbatim:

- Bad: "Which Grand Theft Auto game is set in Vice City?" → Grand Theft Auto: Vice City. The answer is sitting in the question.
- Good: "Which city was GTA: Vice City set in?" — ask the distinguishing fact, not the title.
- Bad: "Which Dark Souls game features the area called Anor Londo?" → Dark Souls. The franchise name embeds the answer.
- Good: "Which game features the area Anor Londo?" → Dark Souls. Drop the franchise when asking which franchise entry it is.

Rule of thumb: if the question names the franchise and the answer is an entry in that franchise — or the question names an entry and the answer is the franchise — rewrite it.

Commit: `fa8158a` (`fix(260419-pma): ban answer-in-question leakage in Questions Agent prompt`).

Also exported `SYSTEM_PROMPT` from `pipeline/src/agents/questions.ts` so the dry-run sampling script can reuse the exact committed string.

### AFTER v2 (20 samples — live Sonnet 4.5 under REVISED prompt)

Generated via `npx tsx pipeline/scripts/sample-questions-dry-run.ts "Video Game Franchises" 20` — same seed category as the original AFTER set. 2060 input tokens, 2461 output tokens.

1. What is the best-selling video game franchise of all time? — **Mario** (easy)
2. Which game series features the protagonist Master Chief? — **Halo** (easy)
3. In which city is the majority of the Yakuza game series set? — **Tokyo** (normal)
4. What species is Crash Bandicoot? — **Bandicoot** (easy)
5. Which company created the Metal Gear series? — **Konami** (normal)
6. What colour is Sonic the Hedgehog? — **Blue** (easy)
7. Which franchise features the recurring villain Bowser? — **Mario** (easy)
8. In which year was the first Assassin's Creed game released? — **2007** (normal)
9. What is the name of the AI companion in the Portal series? — **GLaDOS** (normal)
10. Which game franchise features a character called CJ from Grove Street? — **Grand Theft Auto** (normal)
11. What does RPG stand for in gaming? — **Role-Playing Game** (easy)
12. Which blocky sandbox game became the best-selling game of all time? — **Minecraft** (easy)
13. Which game series features the fictional city of Rapture? — **BioShock** (normal)
14. What type of creature is Spyro? — **Dragon** (easy)
15. Which fighting game series features Ryu and Ken? — **Street Fighter** (easy)
16. What is Link's horse called in the Zelda series? — **Epona** (normal)
17. Which game series features a city called City 17? — **Half-Life** (hard)
18. In the Resident Evil series, what does the T stand for in T-Virus? — **Tyrant** (hard)
19. Which company developed the Uncharted series? — **Naughty Dog** (normal)
20. What material is the Master Sword's blade said to be in Zelda lore? — **Sacred steel** (hard)

### Verdict — has Q9/Q15-style leakage vanished?

**Mostly yes, with one residual edge case.**

The exact Q9/Q15 patterns are gone: no question of the form "Which [Franchise] game is set in [Entry]?" or "Which [Franchise] game features [Entry-Specific Thing]?". Questions that could slip into that trap now reliably ask the distinguishing fact instead of the title:
- Q3 asks which city Yakuza is set in (not "which Yakuza game is set in Tokyo")
- Q8 asks the release year of Assassin's Creed (not "which Assassin's Creed game released in 2007")
- Q13 asks which series features Rapture (not "which BioShock game features Rapture")
- Q17 asks which series features City 17 (not "which Half-Life game features City 17")

That's four questions where the old pattern was the obvious path and the model took the rewritten path. Prompt change is working.

**One residual leakage — Q4:** "What species is Crash Bandicoot?" → Bandicoot. This is the same structural bug the rule targets (franchise name embeds the answer) but in a slightly different shape: it's not "which franchise game" framing, it's a trivia question where the character's name literally contains the answer species. A quizmaster would ask "What species is Sony's purple-dragon-free PlayStation mascot from 1996?" or similar. The model missed this because the rule's examples are all franchise/entry pairs; the character/species pair isn't explicitly covered.

**Minor:** Q11 ("What does RPG stand for?") is an acronym expansion — fine, though the category ("Video Game Franchises") is a bit loose for it. Q18 ("What does the T stand for in T-Virus?") is the same pattern but tighter — the T is literally given as a clue, so the leakage is intentional and legitimate.

**Code-level check:** the Questions Agent has a runtime filter (`answerWords.some(w => ... re.test(question.question_text))` at lines 252-259) that would reject Q4 at insert time — "bandicoot" is a ≥5-char distinctive word from the answer matching a word in the question. So in a real pipeline run Q4 would be dropped before reaching the DB. The prompt leak is a Claude-side miss; the downstream guard catches it.

**Recommendation:** if the user wants the prompt to catch Q4-style leakage too, add a third canonical example covering character-name-embeds-answer (e.g. "Bad: 'What species is Crash Bandicoot?' → Bandicoot. The character's name gives the answer. Good: 'What species is the PlayStation platformer mascot introduced in 1996?' → Bandicoot."). Otherwise, rely on the existing runtime filter.

### Awaiting re-approval

1. Confirm the Q9/Q15-style leakage is gone from the AFTER v2 set.
2. Decide whether Q4 (Crash Bandicoot → Bandicoot) warrants a third prompt example, or whether the runtime filter is sufficient.
3. Type **"approved"** to close the checkpoint, or request further prompt revisions.

---

## Final Status: APPROVED

User approved after AFTER v2.

- **Q9/Q15-style leakage — fixed.** The REVISION 1 prompt change (franchise/entry answer-in-question ban) eliminated the "Which [Franchise] game is set in [Entry]?" pattern. AFTER v2 shows four cases where the model correctly took the rewritten path (Q3 Yakuza, Q8 Assassin's Creed, Q13 BioShock, Q17 Half-Life).
- **Q4-style residual — accepted.** The character-name-embeds-answer shape ("What species is Crash Bandicoot?" → Bandicoot) was not added as a third canonical example. The Questions Agent's runtime filter at `pipeline/src/agents/questions.ts:252-259` (`answerWords.some(w => re.test(question.question_text))`) rejects this pattern at insert time — "bandicoot" is a ≥5-char distinctive answer word matching a word in the question, so the question would be dropped before reaching the DB. Prompt stays as-is; downstream guard covers it.
- **No further prompt changes.** Category Agent depth rule, Questions Agent tone section, and franchise/entry leakage ban are locked in. Backlog items 999.3 and 999.4 closed.

Dev helper retained: `pipeline/scripts/sample-questions-dry-run.ts` — runs the committed `SYSTEM_PROMPT` against a named seed category via the Anthropic API. Useful for future prompt-tuning dry runs without touching the DB.
