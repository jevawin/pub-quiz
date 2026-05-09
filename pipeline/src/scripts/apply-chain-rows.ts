#!/usr/bin/env node
/**
 * Phase 999.22 Wave 4 — apply chain rows from a decisions JSON.
 *
 * Input: stdin JSON array of { question_id, slug, estimate_score }.
 * Output: stdout JSON { inserted, skipped_existing, errors }.
 *
 * Uses upsert with ignoreDuplicates so existing rows are preserved (insert-only
 * per locked decision 5). Resolves slugs to category_ids in one batch query.
 *
 * Usage (subagent pattern):
 *   echo '[{"question_id":"...","slug":"music","estimate_score":35}, ...]' | \
 *     npx tsx pipeline/src/scripts/apply-chain-rows.ts
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import { createSupabaseClient } from '../lib/supabase.js';

interface Decision {
  question_id: string;
  slug: string;
  estimate_score: number;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const raw = await readStdin();
  if (!raw.trim()) {
    console.error('No input on stdin');
    process.exit(1);
  }

  let decisions: Decision[];
  try {
    decisions = JSON.parse(raw);
  } catch (e) {
    console.error('Invalid JSON input:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  if (!Array.isArray(decisions) || decisions.length === 0) {
    console.error('Input must be a non-empty array of decisions');
    process.exit(1);
  }

  // Validate
  for (const d of decisions) {
    if (typeof d.question_id !== 'string' || typeof d.slug !== 'string' || typeof d.estimate_score !== 'number') {
      console.error('Invalid decision shape:', d);
      process.exit(1);
    }
    if (d.estimate_score < 0 || d.estimate_score > 100) {
      console.error('estimate_score out of range [0,100]:', d);
      process.exit(1);
    }
  }

  const sb = createSupabaseClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Resolve slugs to ids in one batch
  const uniqueSlugs = Array.from(new Set(decisions.map((d) => d.slug)));
  const { data: cats, error: cErr } = await sb.from('categories').select('id, slug').in('slug', uniqueSlugs);
  if (cErr) {
    console.error('categories fetch error:', cErr.message);
    process.exit(1);
  }
  const slugToId = new Map<string, string>((cats ?? []).map((c) => [c.slug, c.id]));

  const missingSlugs = uniqueSlugs.filter((s) => !slugToId.has(s));
  if (missingSlugs.length > 0) {
    console.error('Slugs not found in categories table:', missingSlugs);
    process.exit(1);
  }

  // Build rows
  const rows = decisions.map((d) => ({
    question_id: d.question_id,
    category_id: slugToId.get(d.slug)!,
    estimate_score: d.estimate_score,
    observed_n: 0,
  }));

  // Upsert with ignoreDuplicates (insert-only per locked decision 5)
  const upsertRet = await (sb
    .from('question_categories')
    .upsert(rows as never, {
      onConflict: 'question_id,category_id',
      ignoreDuplicates: true,
    }) as unknown as Promise<{ data: unknown; error: { message: string } | null }>);

  if (upsertRet.error) {
    console.error('upsert error:', upsertRet.error.message);
    process.exit(1);
  }

  // Note: with ignoreDuplicates we can't easily count actual inserts vs skips
  // in one query. Report total attempted; verification queries can confirm.
  const summary = {
    attempted: rows.length,
    unique_questions: new Set(decisions.map((d) => d.question_id)).size,
    unique_slugs: uniqueSlugs.length,
  };
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
