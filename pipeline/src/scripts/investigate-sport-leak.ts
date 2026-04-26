#!/usr/bin/env node
/**
 * One-off investigation script for quick task 260426-ow2.
 * Confirms the sport category leak hypothesis using PostgREST queries.
 * Service role key bypasses RLS.
 *
 * Run: tsx src/scripts/investigate-sport-leak.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function getSportsTree(): Promise<string[]> {
  // Find sports root
  const { data: roots, error: rootErr } = await sb
    .from('categories')
    .select('id, slug, parent_id')
    .eq('slug', 'sports')
    .single();
  if (rootErr || !roots) throw new Error('sports root not found: ' + rootErr?.message);

  // Walk descendants by repeatedly fetching by parent_id
  const tree: string[] = [roots.id];
  let frontier: string[] = [roots.id];
  while (frontier.length) {
    const { data: kids, error } = await sb
      .from('categories')
      .select('id, parent_id')
      .in('parent_id', frontier);
    if (error) throw error;
    const ids = (kids ?? []).map((k) => k.id);
    if (!ids.length) break;
    tree.push(...ids);
    frontier = ids;
  }
  return tree;
}

async function main() {
  const tree = await getSportsTree();
  console.log(`Sports subtree size: ${tree.length} category ids`);

  // Q1a: legacy_sports — published questions whose questions.category_id is in the sports subtree.
  const { count: legacyCount, error: q1aErr } = await sb
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .in('category_id', tree);
  if (q1aErr) throw q1aErr;

  // Q1b: join_sports — distinct published questions linked via question_categories to any cat in tree.
  // PostgREST: select question_id from question_categories filtered by category_id in tree, then dedupe + join with published.
  // We'll fetch all qc rows in tree and filter by published questions in app.
  const qcAll: { question_id: string }[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('question_categories')
      .select('question_id')
      .in('category_id', tree)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    qcAll.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  const qcQuestionIds = Array.from(new Set(qcAll.map((r) => r.question_id)));

  // Filter to published only — chunk because URL length matters.
  const publishedSportsViaJoin = new Set<string>();
  for (let i = 0; i < qcQuestionIds.length; i += 200) {
    const slice = qcQuestionIds.slice(i, i + 200);
    const { data, error } = await sb
      .from('questions')
      .select('id')
      .eq('status', 'published')
      .in('id', slice);
    if (error) throw error;
    (data ?? []).forEach((r) => publishedSportsViaJoin.add(r.id));
  }

  console.log(`Q1: legacy_sports=${legacyCount}  join_sports=${publishedSportsViaJoin.size}`);

  // Q2: leaks — questions the legacy filter returns that are NOT linked to sports in the join table,
  // AMONG those that DO have at least one question_categories row.
  // First, get all published questions whose legacy category_id is in tree.
  const legacyRows: { id: string; question_text: string; category_id: string }[] = [];
  {
    let f = 0;
    while (true) {
      const { data, error } = await sb
        .from('questions')
        .select('id, question_text, category_id')
        .eq('status', 'published')
        .in('category_id', tree)
        .range(f, f + pageSize - 1);
      if (error) throw error;
      legacyRows.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
      f += pageSize;
    }
  }

  // For each legacy row check existence + sports-link in question_categories.
  // Batch-fetch all qc rows for the legacy question ids.
  const legacyIds = legacyRows.map((r) => r.id);
  const qcByQuestion = new Map<string, Set<string>>(); // question_id -> set(category_id)
  for (let i = 0; i < legacyIds.length; i += 200) {
    const slice = legacyIds.slice(i, i + 200);
    const { data, error } = await sb
      .from('question_categories')
      .select('question_id, category_id')
      .in('question_id', slice);
    if (error) throw error;
    (data ?? []).forEach((r) => {
      let s = qcByQuestion.get(r.question_id);
      if (!s) {
        s = new Set();
        qcByQuestion.set(r.question_id, s);
      }
      s.add(r.category_id);
    });
  }
  const treeSet = new Set(tree);
  const leaks = legacyRows.filter((r) => {
    const cats = qcByQuestion.get(r.id);
    if (!cats || cats.size === 0) return false; // un-backfilled, not a leak
    // has join rows but none in sports subtree
    for (const c of cats) if (treeSet.has(c)) return false;
    return true;
  });

  console.log(`\nQ2: ${leaks.length} legacy-sport questions whose join data does NOT include sports`);
  console.log('Sample (up to 20):');
  leaks.slice(0, 20).forEach((r) => {
    console.log(`  ${r.id} | ${r.question_text.slice(0, 90)}`);
  });

  // Q3: inverse leaks — sport per join, but legacy category_id is NOT in tree.
  const inverseIds = Array.from(publishedSportsViaJoin);
  const inverseRows: { id: string; question_text: string; category_id: string }[] = [];
  for (let i = 0; i < inverseIds.length; i += 200) {
    const slice = inverseIds.slice(i, i + 200);
    const { data, error } = await sb
      .from('questions')
      .select('id, question_text, category_id')
      .in('id', slice);
    if (error) throw error;
    (data ?? []).forEach((r) => {
      if (!treeSet.has(r.category_id)) inverseRows.push(r);
    });
  }
  console.log(`\nQ3: ${inverseRows.length} join-sport questions whose legacy category_id is NOT in sports tree`);
  console.log('Sample (up to 20):');
  inverseRows.slice(0, 20).forEach((r) => {
    console.log(`  ${r.id} | ${r.question_text.slice(0, 90)}`);
  });

  // Q4: backfill state — published questions with NO question_categories rows.
  // Pull all published ids, subtract those present in qc.
  const publishedIds: string[] = [];
  {
    let f = 0;
    while (true) {
      const { data, error } = await sb
        .from('questions')
        .select('id')
        .eq('status', 'published')
        .range(f, f + pageSize - 1);
      if (error) throw error;
      publishedIds.push(...(data ?? []).map((r) => r.id));
      if (!data || data.length < pageSize) break;
      f += pageSize;
    }
  }
  // Get all distinct question_ids in question_categories
  const qcAllIds = new Set<string>();
  {
    let f = 0;
    while (true) {
      const { data, error } = await sb
        .from('question_categories')
        .select('question_id')
        .range(f, f + pageSize - 1);
      if (error) throw error;
      (data ?? []).forEach((r) => qcAllIds.add(r.question_id));
      if (!data || data.length < pageSize) break;
      f += pageSize;
    }
  }
  const unbackfilled = publishedIds.filter((id) => !qcAllIds.has(id)).length;
  console.log(`\nQ4: backfill missing — ${unbackfilled} published questions have NO question_categories rows (of ${publishedIds.length} total)`);

  // Q2b: legacy-sport published questions that have NO join rows yet (un-backfilled subset).
  // These would be served under Sports today purely off legacy category_id. If misclassified by Category Agent at insert time, they leak.
  const unbackfilledLegacySport = legacyRows.filter((r) => !qcByQuestion.has(r.id));
  console.log(`\nQ2b: ${unbackfilledLegacySport.length} legacy-sport published questions with NO question_categories rows yet (served via legacy fallback after fix).`);
  unbackfilledLegacySport.slice(0, 10).forEach((r) => {
    console.log(`  ${r.id} | ${r.question_text.slice(0, 90)}`);
  });

  console.log('\n--- conclusion ---');
  if (leaks.length > 0 || inverseRows.length > 0) {
    console.log('leak confirmed');
  } else {
    console.log('leak NOT confirmed — abort plan');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
