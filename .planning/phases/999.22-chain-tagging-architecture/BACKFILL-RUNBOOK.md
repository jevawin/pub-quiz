# 999.22 Backfill Runbook

Subagent-driven chain-tagging backfill. Main loop dispatches one subagent per batch (~100 Qs). Each subagent has fresh context, scores ancestor rows for its batch, applies via service-role.

## Files

- **Worklist:** `data/batches/batch-NNN.json` — 16 batches, ~100 Qs each
- **Summary:** `data/worklist-summary.json` — total counts
- **Progress:** `PROGRESS.md` — batch checklist (committed per batch)
- **Apply script:** `pipeline/src/scripts/apply-chain-rows.ts` — stdin JSON, upserts

## Subagent prompt template

Use this template when spawning a subagent (general-purpose, Opus). Replace `{N}` and `{batch_path}`.

---

You are a Phase 999.22 backfill subagent for batch {N}.

**Context:** Pub Quiz uses chain tagging — each question has one `question_categories` row per ancestor in its category tree (root → sub → optional sub-sub), with a per-tier audience score. Your job: for each Q in the batch, propose `estimate_score` (0-100 integer) for each ancestor in `ancestors_to_add`, then apply via the helper script.

**Input file:** `{batch_path}` — JSON with `questions[]`. Each Q has:
- `id`, `question_text`, `correct_answer`, `distractors`
- `existing_slugs[]` — already-tagged cats with their scores (DO NOT re-score these)
- `ancestors_to_add[]` — chain ancestors needing rows. Each: `{slug, name, parent_slug, chain_depth}`. Score these.

**Scoring rule (per locked decision 8):** estimate the % of players who picked THAT specific category as their pill, who would answer correctly. Independent reasoning per tier. Anchor examples:

- "Who won The International 2016 (Dota 2)?":
  - `gaming` (broad pill): 15
  - `esports-and-competitive-gaming` (niche pill): 50
- "What was David Bowie's first album?":
  - `music`: 30
  - `rock-and-roll-legends`: 50
  - `david-bowie`: 75
- "What's the capital of France?":
  - `geography`: 80 (broad knowledge)
  - `european-geography`: 90 (european-pill picker should know)

Bands: hard 0-33, normal 34-66, easy 67-100. Aim to land in the band that matches how that audience would experience it.

**Workflow:**

1. Read the batch JSON.
2. For each Q, reason briefly (in your thinking) about each ancestor in `ancestors_to_add`. Pick estimate_score per ancestor.
3. Build a decisions array: `[{question_id, slug, estimate_score}, ...]`.
4. Apply via:
   ```bash
   echo '<JSON_ARRAY>' | npx tsx pipeline/src/scripts/apply-chain-rows.ts
   ```
   (cwd = `/Users/jamiepersonal/Developer/pub-quiz/pipeline`; the script reads from stdin)
5. Return a final summary: total Qs processed, total rows inserted, any anomalies (e.g. Qs you couldn't score confidently — mark `null` and skip those decisions).

**Constraints:**
- Don't touch `existing_slugs` rows. Don't propose new slugs. Only score what's in `ancestors_to_add`.
- Don't add cousin tags (e.g. don't propose `pop-culture` as cousin) — that's Phase 999.23.
- Max one decision per (question_id, slug) pair.
- If unsure on a Q (text ambiguous, answer wrong-looking, etc), skip it and note in summary.

**Output format (final message):**
```
Batch {N} complete.
- Qs processed: X
- Rows inserted: Y (= sum of ancestors_to_add scored)
- Skipped: Z (with reasons listed)
- Notable observations: ...
```

---

## Main loop pseudocode

```
for N in 1..16:
  if PROGRESS.md marks batch {N} as done → skip
  spawn subagent with template above, batch path = data/batches/batch-NNN.json
  capture summary
  append to PROGRESS.md: "Batch N: ✓ — Qs:X Rows:Y Skipped:Z"
  git add PROGRESS.md && git commit -m "backfill(999.22): batch N — X Qs, Y rows" && git push
```

## Resume

If interrupted: re-read PROGRESS.md, find next un-checked batch, continue.

## Verification (Wave 6)

After all 16 batches:
- Re-run `pipeline/src/scripts/build-chain-backfill-worklist.ts` — should report ~0 Qs needing backfill.
- Sample-check 50 random Qs: confirm chain rows exist + scores look sensible per tier.
