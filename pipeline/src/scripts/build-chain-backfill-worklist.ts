#!/usr/bin/env node
/**
 * Phase 999.22 Wave 4 — build backfill worklist for chain tagging.
 *
 * Output: per-Q records identifying which chain ancestor rows need to be added.
 * Each batch JSON is consumed by a fresh-context subagent that proposes scores
 * and applies inserts via service-role.
 *
 * No API calls. Pure DB read + JSON write.
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import { writeFileSync, mkdirSync } from 'node:fs';
import { createSupabaseClient } from '../lib/supabase.js';
import { expandSlugsToChain } from '../lib/category-chain.js';

const PAGE = 1000;
const BATCH_SIZE = 100;
const OUT_DIR = '/Users/jamiepersonal/Developer/pub-quiz/.planning/phases/999.22-chain-tagging-architecture/data';

interface ExistingRow {
  category_id: string;
  estimate_score: number;
  observed_score: number | null;
  observed_n: number;
}

interface AncestorToAdd {
  slug: string;
  name: string;
  parent_slug: string | null;
  chain_depth: number; // 0 = root, increases toward leaf
}

interface WorklistRow {
  id: string;
  question_text: string;
  correct_answer: string;
  distractors: string[];
  existing_slugs: Array<{ slug: string; estimate_score: number; observed_n: number }>;
  ancestors_to_add: AncestorToAdd[]; // missing chain rows; subagent scores + inserts
}

async function main(): Promise<void> {
  const sb = createSupabaseClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // 1. Categories tree
  const { data: cats, error: cErr } = await sb.from('categories').select('id, slug, name, parent_id');
  if (cErr) throw new Error(`categories: ${cErr.message}`);
  const byId = new Map((cats ?? []).map((c) => [c.id, c]));
  const slugById = new Map((cats ?? []).map((c) => [c.id, c.slug]));
  const slugToParent = new Map<string, string | null>(
    (cats ?? []).map((c) => [c.slug, c.parent_id ? slugById.get(c.parent_id) ?? null : null]),
  );
  const slugToCat = new Map((cats ?? []).map((c) => [c.slug, c]));

  // 2. All qc rows
  const qcByQ = new Map<string, ExistingRow[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('question_categories')
      .select('question_id, category_id, estimate_score, observed_score, observed_n')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`qc page: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) {
      const arr = qcByQ.get(r.question_id) ?? [];
      arr.push(r as ExistingRow);
      qcByQ.set(r.question_id, arr);
    }
    if (data.length < PAGE) break;
  }

  // 3. All published Qs
  const allPublished: Array<{
    id: string; question_text: string; correct_answer: string; distractors: string[];
  }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('questions')
      .select('id, question_text, correct_answer, distractors')
      .eq('status', 'published')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`questions page: ${error.message}`);
    if (!data?.length) break;
    allPublished.push(...(data as typeof allPublished));
    if (data.length < PAGE) break;
  }

  console.log(`Loaded: ${cats?.length ?? 0} cats, ${qcByQ.size} Qs with qc rows, ${allPublished.length} published Qs`);

  // 4. Build worklist: only Qs that need at least one new ancestor row
  const worklist: WorklistRow[] = [];

  function depthOf(slug: string): number {
    let d = 0;
    let cur: string | null | undefined = slug;
    while (cur) {
      const parent = slugToParent.get(cur);
      if (!parent) break;
      d++;
      cur = parent;
    }
    return d;
  }

  for (const q of allPublished) {
    const existing = qcByQ.get(q.id) ?? [];
    const existingSlugSet = new Set(
      existing.map((r) => slugById.get(r.category_id)).filter((s): s is string => !!s),
    );
    const existingNonGk = Array.from(existingSlugSet).filter((s) => s !== 'general-knowledge');

    if (existingNonGk.length === 0) {
      // Only GK row or no rows — chain unknown. Skip (manual review territory).
      continue;
    }

    const desiredChain = expandSlugsToChain(slugToParent, existingNonGk);
    const missing = desiredChain.filter((s) => !existingSlugSet.has(s));

    if (missing.length === 0) continue; // Already chain-tagged

    const ancestors_to_add: AncestorToAdd[] = missing.map((slug) => {
      const cat = slugToCat.get(slug);
      const parentSlug = slugToParent.get(slug) ?? null;
      return {
        slug,
        name: cat?.name ?? slug,
        parent_slug: parentSlug,
        chain_depth: depthOf(slug),
      };
    });

    const existing_with_scores = existing
      .map((r) => {
        const slug = slugById.get(r.category_id);
        if (!slug) return null;
        return { slug, estimate_score: r.estimate_score, observed_n: r.observed_n };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    worklist.push({
      id: q.id,
      question_text: q.question_text,
      correct_answer: q.correct_answer,
      distractors: q.distractors as string[],
      existing_slugs: existing_with_scores,
      ancestors_to_add,
    });
  }

  console.log(`Worklist: ${worklist.length} Qs need chain rows added`);

  // 5. Sort by primary root then existing slug for topical clustering
  worklist.sort((a, b) => {
    const aSlug = a.existing_slugs.find((s) => s.slug !== 'general-knowledge')?.slug ?? 'zzz';
    const bSlug = b.existing_slugs.find((s) => s.slug !== 'general-knowledge')?.slug ?? 'zzz';
    return aSlug.localeCompare(bSlug);
  });

  // 6. Write summary + per-batch files
  mkdirSync(`${OUT_DIR}/batches`, { recursive: true });

  const totalRowsToAdd = worklist.reduce((sum, q) => sum + q.ancestors_to_add.length, 0);
  const summary = {
    generated_at: new Date().toISOString(),
    total_published: allPublished.length,
    total_needing_backfill: worklist.length,
    total_ancestor_rows_to_add: totalRowsToAdd,
    batch_size: BATCH_SIZE,
    batch_count: Math.ceil(worklist.length / BATCH_SIZE),
  };
  writeFileSync(`${OUT_DIR}/worklist-summary.json`, JSON.stringify(summary, null, 2));
  console.log('Summary:', summary);

  for (let i = 0; i < worklist.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = worklist.slice(i, i + BATCH_SIZE);
    const path = `${OUT_DIR}/batches/batch-${String(batchNum).padStart(3, '0')}.json`;
    writeFileSync(path, JSON.stringify({
      batch_num: batchNum,
      batch_size: batch.length,
      questions: batch,
    }, null, 2));
  }

  console.log(`Wrote ${Math.ceil(worklist.length / BATCH_SIZE)} batch files → ${OUT_DIR}/batches/`);
}

void main().catch((e) => { console.error(e); process.exit(1); });
