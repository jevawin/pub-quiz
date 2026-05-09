#!/usr/bin/env node
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import { createSupabaseClient } from '../lib/supabase.js';

async function main(): Promise<void> {
  const sb = createSupabaseClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // 1. counts_by_root_category — should still return rows per (root, band)
  const { data: counts, error: cErr } = await sb.rpc('counts_by_root_category');
  if (cErr) throw new Error(`counts_by_root_category: ${cErr.message}`);
  console.log(`counts_by_root_category: ${counts?.length ?? 0} rows`);
  console.log('  sample:', counts?.slice(0, 5));

  // 2. count_available_questions — multi-slug
  const { data: gen, error: gErr } = await sb.rpc('count_available_questions', {
    p_score_min: 0, p_score_max: 100, p_category_slugs: ['general'], p_exclude_ids: [],
  });
  if (gErr) throw new Error(`count_available (general): ${gErr.message}`);
  console.log(`count_available (general, all bands): ${gen}`);

  const { data: gam, error: gErr2 } = await sb.rpc('count_available_questions', {
    p_score_min: 0, p_score_max: 100, p_category_slugs: ['gaming'], p_exclude_ids: [],
  });
  if (gErr2) throw new Error(`count_available (gaming): ${gErr2.message}`);
  console.log(`count_available (gaming, all bands): ${gam}`);

  // 3. random_published_questions_excluding — fetch 5 from gaming
  const { data: qs, error: qErr } = await sb.rpc('random_published_questions_excluding', {
    p_score_min: 0, p_score_max: 100, p_category_slug: 'gaming', p_limit: 5, p_exclude_ids: [],
  });
  if (qErr) throw new Error(`random_published (gaming): ${qErr.message}`);
  console.log(`random_published (gaming, 5): ${qs?.length ?? 0} rows`);

  // 4. random_general_knowledge_questions
  const { data: gks, error: gkErr } = await sb.rpc('random_general_knowledge_questions', {
    p_score_min: 0, p_score_max: 100, p_limit: 5,
  });
  if (gkErr) throw new Error(`random_general_knowledge: ${gkErr.message}`);
  console.log(`random_general_knowledge (5): ${gks?.length ?? 0} rows`);

  console.log('\nAll RPCs return successfully.');
}
void main().catch((e) => { console.error(e); process.exit(1); });
