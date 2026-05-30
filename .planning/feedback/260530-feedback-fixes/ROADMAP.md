# Feedback Fix Roadmap — 260530

Subagent-driven cleanup of the **29 open `question_feedback` rows** (27 distinct questions) from the web prototype (5260 plays / 121 sessions). Built 2026-05-30 from live DB content. Companion: [DOSSIER.md](./DOSSIER.md) — full content of every flagged question, embedded.

> Every item below is grouped by the fix it needs, with the **real** question text/answer/fun_fact. Still **re-verify against the live DB before patching** — this is a 2026-05-30 snapshot.

## Goal

Clear the open feedback queue: fix or consciously dismiss each row, stamp `resolved_at`, and stop the recurring classes (Americanisms, bad fun_facts) at the prompt level.

## Ground rules

- **No pipeline budget.** Retroactive edits run on the **Claude Code subscription** (subagents in-context), not the paid pipeline. No `ANTHROPIC_API_KEY` spend.
- **British English** house style: mother not mom, liquorice not licorice, sweets not candy, -ise not -ize. Don't change a term when the answer/subject is inherently American (a US sport, a US brand name).
- Writes via **service-role client** (`pipeline/.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). PATCH `questions`; keep `distractors` at exactly 3.
- **`questions.difficulty` no longer exists** (dropped Phase 2.4). Difficulty = `question_categories.estimate_score` (0-100) per chosen pill.
- **Resolve:** `UPDATE question_feedback SET resolved_at=now(), resolved_note='<one line>' WHERE question_id='<id>' AND created_at='<ts>';` (use `created_at` to target the right row — some questions have two reports).

## Per-item contract (each subagent)

1. Fetch live question (`question_text, correct_answer, distractors, fun_fact, status`) + the feedback text.
2. Judge against house style + fact. Decide `fix` / `keep` / `escalate`.
3. If fix: PATCH only changed fields; re-read to confirm.
4. Resolve the feedback row(s) with a note.
5. Return: `qid | verdict | what_changed`.

---

## Wave 1 — question-text fixes (fan out, parallel)

Edits to `question_text` (and answer spelling where noted). Independent rows.

- **FB03 + FB27** `092ec0b3` — *"What is the profession of Elon Musk's **mom**, Maye Musk?"* → **"mother"**. Two reports, same fix. Resolve both rows.
- **FB07** `c2cbf357` — *"Red Vines is a brand of what type of **candy**?"* answer **"Licorice"**. Americanism: → *"…type of **sweet**?"*, answer **"Liquorice"** (UK), and fix the fun_fact's "licorice". (Brand stays "Red Vines" — it's a proper noun.)
- **FB11** `760c02a0` — typo in stem: *"What **mytological** creatures…"* → **"mythological"**.
- **FB23** `132e86c1` — *"…have to disguise **themselves into** a woman?"* → **"himself as a woman"** (Mrs. Doubtfire).
- **FB26** `00b5173f` — *"What was Raekwon **the Chefs** debut solo album?"* → **"the Chef's"** (possessive).
- **FB20** `04384032` — *"'Rollercoaster Tycoon' was programmed **mostly entirely** in…"* → drop the redundancy: **"almost entirely in"** (answer x86 Assembly).
- **FB09** `6b3198ad` — *"Terry Gilliam was an animator **that** worked with which British comedy group?"* → **"who worked with"**.
- **FB05** `8f808c6b` — MTG originally titled "Mana Clash". "Weird word phrasing" — read the live stem and smooth ("When first solicited, Magic: The Gathering was originally titled…").
- **FB19** `03dd8ef4` — *"…animation for Peter Gabriel's **Video Sledgehammer** (1986)?"* — "Video Sledgehammer" isn't the title; the song/video is "Sledgehammer". Fix to *"…for the video for Peter Gabriel's 'Sledgehammer' (1986)?"*

## Wave 2 — answer-in-question / clarity (fan out, parallel)

- **FB25** `0325a30f` — *"Which custard-based French dessert is **brûléed with a torch**?"* answer **Crème brûlée**. The stem telegraphs the answer. Reword: *"Which custard-based French dessert has a hard caramelised-sugar top?"*
- **FB04** `1b4cfeb3` — *"Generally, which component of a computer draws the most power?"* answer Video Card. "Unclear — over a time period? max draw?" Reword: *"Under heavy load, which component of a typical gaming PC draws the most power?"*
- **FB08** `ecf8ceb3` — *"Which planet completes one full rotation in less than 10 hours…?"* answer Jupiter. Feedback "Fewer than 10 hours?" questions the premise — Jupiter's day is ~9.9h, so it's correct. Lean **keep** (+ note); only reword if the stem reads as doubtful.
- **FB28 + FB29** `7ce1283a` — *"Which of these countries is NOT the only country to start with that letter of the alphabet?"* answer Zambia. Double-negative confusion (two users tripped; one then said "Ah, I get it now. Sorry."). Reword for clarity: *"Which of these countries shares its first letter with another country?"* — then resolve both rows. (If you'd rather not touch a working Q, close both with note "self-resolved".)

## Wave 3 — fun_fact errors (fan out, parallel)

Question + answer correct; only the fun_fact is wrong/unclear.

- **FB01** `5aff8f40` — Ferengi First Rule. fun_fact wrong twice: the 1995 *The Ferengi Rules of Acquisition* was **Ira Steven Behr alone** (Behr + Robert Hewitt Wolfe co-wrote *Legends of the Ferengi*, 1997); and it does **not** contain "all 285 rules". Rewrite.
- **FB10** `c1feb5ea` — Trump middle name "John". fun_fact is **factually nonsense** ("joining John F. Kennedy and Lyndon B. Johnson among others" — JFK's middle name was Fitzgerald, LBJ had none, and the "starts with J" claim is invented). Replace with a true fact or a neutral one. High priority — it's confidently wrong.
- **FB24** `e0ad4271` — dartboard, answer "82". fun_fact claims "20 segments × single/double/treble + outer bull + bullseye = 82". User: outer/inner single zones should be specified. Verify the count and clarify the breakdown (or reconsider the answer — many sources say 82 only if you count single-inner and single-outer separately).
- **FB18** `055f3644` — Dürer, answer Nürnberg. fun_fact mentions "a striking 1500 painting". Feedback "1500 is the year, 1500s?" The 1500 self-portrait is a real, specific year — fact is correct. Lean **keep**; optionally reword to "his 1500 self-portrait" for clarity.

## Wave 4 — difficulty re-rating (one subagent, data-informed)

Four "mislabelled difficulty" reports. Pull each question's **observed correct-rate** from `question_plays`, then set `question_categories.estimate_score` to match. Don't trust user or current label blindly — the play data is the arbiter.

- **FB12** `f8f93c73` — first sport on the moon = Golf. "More like medium GK."
- **FB13** `cb32b2de` — retro game released first = Space Invaders. "Medium to hard in GK."
- **FB14** `d2cfe267` — Khyber Pass = Afghanistan & Pakistan. "More of a medium question."
- **FB15** `8c965d9f` — Overwatch dev = Blizzard. "Little too hard for easy GK."

## Wave 5 — taxonomy / question-content decisions (sequential, needs a call)

- **FB16 + FB17** `00fb2eb5` — *"Which of the following **superheros** did Wonder Woman NOT have a love interest in?"* answer Green Arrow. **Two issues:** (1) typo "superheros" → "superheroes"; (2) Steve Trevor (a likely distractor) is **not** a superhero, so calling the options "superheroes" is wrong, and the user objects the Q sits under *literature*. Decide: reword stem to "characters", and re-tag the category (superheroes/comics or pop-culture, not literature). Resolve both rows. The "superheros" typo fix is safe to do regardless.
- **FB22** `047b0fc8` — Iron Man = Tony Stark. "Need a pop culture category, or movies and music." Recurring request (migration 00031 had pop-culture intent). Decide create `pop-culture` vs re-tag to `movies-and-tv` / `comics`. Escalate if it needs a migration.

## Close-only — no content change (one subagent)

Resolve with a note, no edit:

- **FB02** `8fa7d153` — standard animation frame rate = 24 FPS. "Chuck was not happy with this, do better" — banter, no actionable issue; answer + fact correct. Close.
- **FB06** `0927b6e9` — Persona 5 talking cat = Morgana. "Penis isn't an option" — joke about the multiple-choice options. Close.

## Wave 6 — systemic prevention (optional, highest leverage)

- **Americanism guard** — add a British-English rule to `pipeline/src/agents/questions.ts` + `enrichment.ts` system prompts (mother/-ise/sweets/liquorice; flag mom/candy/“movie theater”). Sample-test 20 before merge. Evidence: FB03/FB07/FB27.
- **fun_fact quality** — already tracked as **260428-fact** (ROADMAP C1). Evidence: FB01, FB10, FB24. Tighten the Enrichment `fun_fact` prompt: factually exact (no invented "joins X and Y" claims), 1–2 complete sentences, adds info beyond the question, no typos.

## App bug — route out of this roadmap

- **FB21** `00356aeb` — binary question. "Repeat question, we need to check the question memory logic." This is a **within-session dedup regression** in `apps/web`, not content. Prior work: quick task `260426-pxh` (session dedup). **RESOLVED 2026-05-30** via `/gsd:debug` → `.planning/debug/resolved/fb21-within-session-repeat-recurrence.md`. Root cause was upstream of both prior dedup passes: `seen-store.save()` had no try/catch (Safari private/ITP/quota write failure silently dropped the seen ID) + views recorded only on Lock-In. Fixed on branch `fix/fb21-seen-store-repeat`.

---

## Suggested execution (subagent-driven)

1. **Waves 1–3** — ~17 content items, fan out (1 subagent per item, or ~4 batches of 4). Each: verify → patch → resolve.
2. **Wave 4** — one subagent, pulls play-data, re-rates four.
3. **Close-only** — one subagent, FB02 + FB06.
4. **Wave 5** — apply the safe typo fixes; surface the two taxonomy calls to the human.
5. **Wave 6** — prompt edits when ready (highest ROI on recurrence).
6. **Reconcile** — re-query `question_feedback WHERE resolved_at IS NULL`; expect only Wave-5 + app-bug stragglers. Log resolved count.

## State at build (2026-05-30)
- Open feedback: 29 rows / 27 distinct questions. Ever: 62 (33 already resolved).
- All flagged questions confirmed **live** in `questions` (none deleted).
- Two-report questions: `092ec0b3` (FB03+FB27, "mom"), `00fb2eb5` (FB16+FB17, Wonder Woman), `7ce1283a` (FB28+FB29, Zambia).
- Theme tally: question-text fixes 9 · answer-in-Q/clarity 4 · fun_fact errors 4 · difficulty 4 · taxonomy 2 · close-only 2 · app bug 1. (Some rows double-count across the two-report questions.)
