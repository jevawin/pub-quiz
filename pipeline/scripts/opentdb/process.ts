// Batch-process filtered OpenTDB questions through the local `claude` CLI.
// Uses user's Claude plan (OAuth), not the Anthropic API.
//
// Per batch of 20:
//   - Pass category tree + candidate duplicates from existing questions
//   - Claude returns: category_slug, fun_fact, verdict (keep/skip/uncertain), reason, dup_of
//   - Write each row to questions_staging (idempotent on source+external_id)
//
// Resumable: rows already in questions_staging are skipped on re-run.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

type Filtered = {
  external_id: string;
  category: string;              // OpenTDB category label
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  correct_answer: string;
  incorrect_answers: string[];
};

type Category = { id: string; name: string; slug: string; parent_id: string | null; depth: number };
type ExistingQuestion = { id: string; question_text: string };

type ClaudeJudgement = {
  external_id: string;
  category_slug: string;
  fun_fact: string;
  verdict: 'keep' | 'skip' | 'uncertain';
  reason: string;
  dup_of: string | null;
};

const BATCH_SIZE = 20;
const MODEL = 'opus';
const MAX_BATCHES = Number(process.env.MAX_BATCHES ?? '0') || Infinity;
const FILTERED_PATH = '/tmp/opentdb/filtered.json';
const LOG_PATH = '/tmp/opentdb/process.log';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function jaccard(a: string, b: string): number {
  const wa = new Set(normalize(a).split(' ').filter((w) => w.length > 2));
  const wb = new Set(normalize(b).split(' ').filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  return overlap / (wa.size + wb.size - overlap);
}

function buildCategoryTreeText(cats: Category[]): string {
  const byId = new Map(cats.map((c) => [c.id, c]));
  function fullPath(c: Category): string {
    const parts = [c.name];
    let cur = c;
    while (cur.parent_id) {
      const p = byId.get(cur.parent_id);
      if (!p) break;
      parts.unshift(p.name);
      cur = p;
    }
    return parts.join(' > ');
  }
  return cats
    .filter((c) => c.depth >= 1) // leaves & mid-branches; avoid root-only assignment
    .sort((a, b) => fullPath(a).localeCompare(fullPath(b)))
    .map((c) => `${c.slug}: ${fullPath(c)}`)
    .join('\n');
}

function findCandidateDupes(
  q: Filtered,
  existing: ExistingQuestion[],
  threshold = 0.5,
): { id: string; text: string; score: number }[] {
  const scored = existing
    .map((e) => ({ id: e.id, text: e.question_text, score: jaccard(q.question, e.question_text) }))
    .filter((x) => x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return scored;
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          external_id: { type: 'string' },
          category_slug: { type: 'string' },
          fun_fact: { type: 'string' },
          verdict: { type: 'string', enum: ['keep', 'skip', 'uncertain'] },
          reason: { type: 'string' },
          dup_of: { type: ['string', 'null'] },
        },
        required: ['external_id', 'category_slug', 'fun_fact', 'verdict', 'reason', 'dup_of'],
      },
    },
  },
  required: ['results'],
};

function buildPrompt(batch: Filtered[], catTree: string, dupesByExt: Map<string, { id: string; text: string; score: number }[]>): string {
  const items = batch.map((q) => ({
    external_id: q.external_id,
    question: q.question,
    correct_answer: q.correct_answer,
    distractors: q.incorrect_answers,
    difficulty: q.difficulty,
    opentdb_category: q.category,
    candidate_dupes: dupesByExt.get(q.external_id) ?? [],
  }));

  return `You are mapping trivia questions to a category tree and generating short fun facts for a pub quiz app.

CATEGORY TREE (pick the most specific leaf slug):
${catTree}

TASK: For each question below, return a JSON object in the "results" array with:
- external_id: the id from the input
- category_slug: the most specific slug that fits (from the tree above, never invent one)
- fun_fact: one extra interesting fact about the topic (20-40 words), plain sentence, not a question
- verdict: "keep" | "skip" | "uncertain"
- reason: short reason for skip/uncertain; empty string if keep
- dup_of: if a candidate_dupe is a clear duplicate/near-duplicate, its id; otherwise null

SKIP when:
- Answer is given away by the question wording (self-answering).
- Typos or garbled wording in the source.
- Hyper-niche and unlikely to be fair in a pub quiz.
- Date-sensitive ("currently", "as of", "recent").
- Offensive, risque, or inappropriate for a general audience.
- Duplicate of an existing question (also set dup_of).

UNCERTAIN when borderline — reviewer should eyeball.
KEEP otherwise. Be generous with keep — reviewer will filter further.

If an existing category doesn't fit well, still pick the closest match (don't invent new slugs). Flag mismatch in "reason".

QUESTIONS (${items.length}):
${JSON.stringify(items, null, 0)}
`;
}

function callClaude(prompt: string): ClaudeJudgement[] {
  const result = spawnSync(
    'claude',
    [
      '--print',
      '--model', MODEL,
      '--output-format', 'json',
      '--json-schema', JSON.stringify(OUTPUT_SCHEMA),
      prompt,
    ],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`claude CLI failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  const outer = JSON.parse(result.stdout);
  // Claude -p with --json-schema returns structured output in `structured_output`.
  const payload = outer.structured_output
    ?? (typeof outer.result === 'string' && outer.result ? JSON.parse(outer.result) : null);
  if (!payload) {
    throw new Error(`no structured_output in claude response: ${result.stdout.slice(0, 300)}`);
  }
  return payload.results as ClaudeJudgement[];
}

async function main() {
  const all: Filtered[] = JSON.parse(readFileSync(FILTERED_PATH, 'utf8'));
  console.log(`loaded ${all.length} filtered questions`);

  const { data: cats, error: catErr } = await supabase
    .from('categories')
    .select('id,name,slug,parent_id,depth');
  if (catErr) throw catErr;
  const catTree = buildCategoryTreeText(cats!);
  const slugToId = new Map(cats!.map((c) => [c.slug, c.id]));

  const { data: existing, error: exErr } = await supabase
    .from('questions')
    .select('id,question_text');
  if (exErr) throw exErr;

  const { data: alreadyStaged } = await supabase
    .from('questions_staging')
    .select('external_id')
    .eq('source', 'opentdb');
  const stagedIds = new Set((alreadyStaged ?? []).map((r) => r.external_id));

  const todo = all.filter((q) => !stagedIds.has(q.external_id));
  console.log(`already staged: ${stagedIds.size}, todo: ${todo.length}`);

  const totalBatches = Math.min(Math.ceil(todo.length / BATCH_SIZE), MAX_BATCHES);
  for (let i = 0, n = 0; i < todo.length && n < MAX_BATCHES; i += BATCH_SIZE, n++) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    console.log(`\nbatch ${n + 1} / ${totalBatches} (${batch.length} qs)`);

    const dupesByExt = new Map(batch.map((q) => [q.external_id, findCandidateDupes(q, existing!)]));
    const prompt = buildPrompt(batch, catTree, dupesByExt);

    let judgements: ClaudeJudgement[];
    try {
      judgements = callClaude(prompt);
    } catch (e) {
      console.error(`  batch failed: ${(e as Error).message}`);
      writeFileSync(LOG_PATH, `batch ${i} failed: ${(e as Error).message}\n`, { flag: 'a' });
      continue;
    }

    const byExt = new Map(judgements.map((j) => [j.external_id, j]));
    const rows = batch.map((q) => {
      const j = byExt.get(q.external_id);
      const difficulty = q.difficulty === 'medium' ? 'normal' : q.difficulty;
      const category_id = j?.category_slug ? slugToId.get(j.category_slug) ?? null : null;
      const candidateDupes = dupesByExt.get(q.external_id) ?? [];
      const dupMatch = j?.dup_of ? candidateDupes.find((d) => d.id === j.dup_of) : null;
      return {
        source: 'opentdb',
        external_id: q.external_id,
        raw_payload: q,
        category_id,
        question_text: q.question,
        correct_answer: q.correct_answer,
        distractors: q.incorrect_answers,
        fun_fact: j?.fun_fact ?? null,
        difficulty,
        claude_verdict: j?.verdict ?? 'uncertain',
        claude_reason: j?.reason ?? 'no judgement returned',
        dup_of_question_id: dupMatch?.id ?? null,
        dup_score: dupMatch?.score ?? null,
        review_status: 'pending' as const,
      };
    });

    const { error: insErr } = await supabase
      .from('questions_staging')
      .upsert(rows, { onConflict: 'source,external_id' });
    if (insErr) {
      console.error(`  insert failed: ${insErr.message}`);
      writeFileSync(LOG_PATH, `batch ${i} insert: ${insErr.message}\n`, { flag: 'a' });
      continue;
    }
    const counts = { keep: 0, skip: 0, uncertain: 0 };
    for (const r of rows) counts[r.claude_verdict as keyof typeof counts]++;
    console.log(`  inserted: keep=${counts.keep} skip=${counts.skip} uncertain=${counts.uncertain}`);
  }

  console.log('\ndone');
}

main().catch((e) => { console.error(e); process.exit(1); });
