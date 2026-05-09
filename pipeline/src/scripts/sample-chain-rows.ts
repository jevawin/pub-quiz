#!/usr/bin/env node
/**
 * Phase 999.22 Wave 6 — sample 10 random published Qs and dump their qc rows
 * for visual inspection. Confirms chain tagging looks reasonable per tier.
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import { createSupabaseClient } from '../lib/supabase.js';

async function main(): Promise<void> {
  const sb = createSupabaseClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Fetch all published Q ids
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('questions').select('id').eq('status', 'published').range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    ids.push(...data.map((r) => r.id));
    if (data.length < 1000) break;
  }

  // Random sample of 10
  const sample = ids.sort(() => Math.random() - 0.5).slice(0, 10);

  for (const id of sample) {
    const { data: q } = await sb
      .from('questions')
      .select('question_text, correct_answer')
      .eq('id', id)
      .single();
    const { data: qcs } = await (sb
      .from('question_categories')
      .select('estimate_score, observed_n, categories(slug, parent_id)')
      .eq('question_id', id) as unknown as Promise<{
        data: Array<{ estimate_score: number; observed_n: number; categories: { slug: string; parent_id: string | null } | null }> | null;
      }>);

    console.log(`\n=== ${id.slice(0, 8)} ===`);
    console.log(`  Q: ${q?.question_text}`);
    console.log(`  A: ${q?.correct_answer}`);
    console.log(`  qc rows (${qcs?.length ?? 0}):`);
    for (const r of qcs ?? []) {
      console.log(`    - ${r.categories?.slug?.padEnd(30)} score=${r.estimate_score}`);
    }
  }
}
void main().catch((e) => { console.error(e); process.exit(1); });
