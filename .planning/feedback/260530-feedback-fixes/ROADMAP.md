# Feedback Fix Roadmap — 260530

Subagent-driven cleanup of the **29 open `question_feedback` items** (28 distinct questions) from the web prototype (5260 plays / 121 sessions). Built 2026-05-30. Companion: [DOSSIER.md](./DOSSIER.md) — full content of every flagged question, embedded.

## Goal

Clear the open feedback queue: fix or consciously dismiss each item, stamp `resolved_at`, and stop the recurring classes (Americanisms, bad fun_facts) at the prompt level.

## Ground rules

- **No pipeline budget.** Retroactive per-question edits run on the **Claude Code subscription** (subagents in-context), not the paid pipeline. No `ANTHROPIC_API_KEY` spend.
- **British English** house style: mother not mom, -ise not -ize, no US-centric phrasing unless the answer demands it.
- Writes via **service-role client** (`pipeline/.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). PATCH `questions`; keep `distractors` at exactly 3.
- **`questions.difficulty` no longer exists** (dropped Phase 2.4). Difficulty = `question_categories.estimate_score` per pill.
- **Verify before patch.** Re-fetch the live question; the dossier is a 2026-05-30 snapshot. If already fixed, just resolve the feedback row.

## Per-item contract (each subagent)

For an assigned `question_id` + the feedback `created_at`:
1. Fetch live question (`question_text, correct_answer, distractors, fun_fact, status`) + the feedback text.
2. Judge against house style + fact. Decide `fix` / `keep` / `escalate`.
3. If fix: PATCH only changed fields; re-read to confirm.
4. Resolve: `UPDATE question_feedback SET resolved_at=now(), resolved_note='<one line>' WHERE question_id='<id>' AND created_at='<ts>';`
5. Return: `qid | verdict | what_changed`.

---

## Wave 1 — fun_fact rewrites (fan out, parallel)

The biggest cluster. All are fun_fact-only edits — question + answer stay.

- **FB01** `5aff8f40` — Ferengi. fun_fact factually wrong twice: the 1995 *The Ferengi Rules of Acquisition* was **Ira Steven Behr alone** (not "co-written"); and it does **not** contain all 285 rules (many never stated in canon). Rewrite the fact. Answer is correct.
- **FB10** `c1feb5ea` — Gold/Au. "I don't understand this fact." Fact is actually fine ("Au from Latin aurum, shining dawn") — likely a UI/render confusion. Lean **keep** unless the rendered fact reads oddly; resolve with note.
- **FB11** `760c02a0` — Zeus. Typo **"mytological" → "mythological"** in fun_fact. One-word fix.
- **FB18** `055f3644` — Mona Lisa. "1500 is the year, 1500s?" — reword fact so "around 1500" reads as a year cleanly (or "the early 1500s").
- **FB20** `04384032` — body water %. "Mostly entirely" — user objects to the fact's framing; tighten ("The brain and heart are about 73% water…").
- **FB24** `e0ad4271` — darts highest single dart = 60 (treble 20). "single outer and single inner should be specified" — clarify the fact distinguishes treble/outer/inner bull. Answer 60 correct.
- **FB26** `00b5173f` — chef's toque. "Grammar chef's" — check the apostrophe/possessive in question + fact; fix if wrong.

## Wave 2 — question wording fixes (fan out, parallel)

Question text edits.

- **FB04** `1b4cfeb3` — UK 3-pin plug max power = 3000W. "Unclear — over a time period? Max draw?" Reword to "maximum continuous power" to disambiguate (fuse 13A×230V≈3000W). Fact already explains 3120W fuse vs 3000W continuous.
- **FB05** `8f808c6b` — The Thing / "It's clobberin' time!". "Weird word phrasing" — smooth the question wording.
- **FB07** `c2cbf357` — American football touchdown = 6. "American centric." This one **is** legitimately American (the sport). Options: `keep` + note (sport is inherently US), or ensure it's tagged under an American-sports / NFL category so it doesn't surface in general rounds. Lean keep-with-tag-check.
- **FB08** `ecf8ceb3` — Anglo-Zanzibar War, shortest war. "Fewer than 10 hours?" — the question already says "38–45 minutes", so the answer is half-given. Reword to remove the duration giveaway, OR keep duration but accept it's an easy gimme. Recommend removing "lasting between 38 and 45 minutes" from the stem.
- **FB09** `6b3198ad` — "Bad Guy" / Billie Eilish. Feedback "'Who worked with'" — suggests rewording toward "Which artist had a 2019 hit with 'Bad Guy'?" Clarify; answer correct.
- **FB19** `03dd8ef4` — Peter Gabriel "Sledgehammer". Casing/quoting of song/video title in the stem — apply consistent quoting (e.g. 'Sledgehammer'). Cosmetic.
- **FB23** `132e86c1` — Mrs. Doubtfire. "disguise themselves into a woman" → **"disguise himself as a woman"**. Clear grammar fix.
- **FB25** `0325a30f` — crème brûlée. **Answer-in-question**: "…blowtorched on top?" telegraphs it. Reword to remove the blowtorch/caramelised-sugar giveaway, or accept as easy. Recommend trimming the stem.

## Wave 3 — difficulty re-rating (one subagent, data-informed)

Four "mislabelled difficulty" reports. Pull each question's **observed correct-rate** from `question_plays`, then set `question_categories.estimate_score` to match the band (don't trust user OR current label blindly).

- **FB12** `f8f93c73` — hardest substance = Diamond. "Not hard, more like medium GK."
- **FB13** `cb32b2de` — smallest prime = 2. "Medium to hard in GK."
- **FB14** `d2cfe267` — hexagon sides = 6. "More of a medium-difficulty question."
- **FB15** `8c965d9f` — Berlin Wall fell 1989. "Little too hard for easy GK."

(These read as genuine calibration signal — simple facts rated too hard, or vice versa. The observed correct-rate is now the arbiter.)

## Wave 4 — taxonomy decisions (sequential, needs human/decision)

Not per-Q content; a category-model choice. Escalate if it needs a migration.

- **FB16 + FB17** `00fb2eb5` (two reports) — Wonder Woman, currently feels mis-categorised under literature. "Is Steve Trevor a superhero?" + "superheroes don't feel like literature, need another cat." Decide: superheroes/comics leaf, or re-tag to existing fit. Resolve **both** rows.
- **FB22** `047b0fc8` — Queen / Bohemian Rhapsody. "Need a pop culture category, or movies and music." Recurring request (migration 00031 had pop-culture intent). Decide create `pop-culture` vs re-tag to `music`.

## Close-only — no content change (one subagent)

Resolve with a note, no edit:

- **FB02** `8fa7d153` — *It's Always Sunny* / Paddy's Pub. "Chuck was not happy" is a joke (Chuck = *Gossip Girl*, wrong show — troll/banter). Answer correct. Close.
- **FB06** `0927b6e9` — Cards Against Humanity, "a card". "Penis isn't an option" = joke. Close.
- **FB27** `7ce1283a` — 7×8=56. "Ah, I get it now. Sorry." — user self-resolved. Close.
- **FB03 + FB28** `092ec0b3` — Friends, Judy Geller. **The question already says "mother"** — both reports ("mom > mother", "mom = American") refer to the *fun_fact*, which starts "mom"-style? Check the live fun_fact; if it contains "mom", fix to "mother" (Wave-1-style) then resolve both. If clean already, close both. Verify which.

> Note FB03/FB28: dossier shows the question stem uses "mother" correctly; the offending "mom" is likely in the fun_fact (FB28's fact text was truncated mid-edit in an earlier session). **Confirm against live fun_fact**, fix if "mom" present, resolve both rows.

## Wave 5 — systemic prevention (optional, highest leverage)

Stop the recurring classes at source. Not feedback-row work.

- **Americanism guard** — add British-English rule to `pipeline/src/agents/questions.ts` + `enrichment.ts` system prompts (mother/-ise; flag mom/candy/“movie theater”). Sample-test 20 before merge. Evidence: FB03/FB28, FB07.
- **fun_fact quality** — already tracked as **260428-fact** (ROADMAP C1). Evidence here: FB01, FB10, FB18, FB20, FB24. Tighten Enrichment prompt: factually exact, 1–2 complete sentences, adds info beyond the question, no year/century slips, no typos.

## App bug — route out

- **FB21** `00356aeb` — Mars/Red Planet. "Repeat question, check the question memory logic." This is a **within-session dedup regression** in `apps/web`, not content. Prior work: quick task `260426-pxh` (session dedup). File a separate debug task; resolve this row pointing at it.

---

## Suggested execution

1. **Wave 1 + Wave 2** — ~15 content items, fan out (1 subagent per item, or ~4 batches of 4). Each: verify → patch → resolve. Collect return lines.
2. **Wave 3** — one subagent, pulls play-data, re-rates four.
3. **Close-only** — one subagent, 5 rows (incl. the FB03/FB28 verify).
4. **Wave 4** — surface the two taxonomy calls to the human; apply once decided.
5. **Wave 5** — prompt edits when ready to stop the bleed (highest ROI).
6. **Reconcile** — re-query `question_feedback WHERE resolved_at IS NULL`; expect only Wave-4 + app-bug stragglers. Log the resolved count.

## State at build (2026-05-30)
- Open feedback: 29 rows / 28 questions. Ever: 62 (33 already resolved).
- All 28 flagged questions confirmed **live** in `questions` (none deleted/rejected).
- Two-report questions: `092ec0b3` (FB03+FB28), `00fb2eb5` (FB16+FB17). `7ce1283a` self-resolved (FB27).
- Dominant themes: fun_fact errors (7), question wording (8), difficulty (4), taxonomy (2), Americanism (recurring), one app dedup bug.
