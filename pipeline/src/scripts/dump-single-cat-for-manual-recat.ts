#!/usr/bin/env node
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import { writeFileSync } from 'node:fs';
import { createSupabaseClient } from '../lib/supabase.js';

const PAGE = 1000;
const IN_CHUNK = 100;

interface QRow {
  id: string;
  question_text: string;
  correct_answer: string;
  distractors: string[];
  existing_slugs: string[];
}

async function fetchSingleCatQuestionsChunked(
  supabase: ReturnType<typeof createSupabaseClient>,
): Promise<QRow[]> {
  const pubIds: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('questions').select('id').eq('status', 'published')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    pubIds.push(...data.map((r) => r.id));
    if (data.length < PAGE) break;
  }

  const qidToSlugs = new Map<string, string[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = (await supabase
      .from('question_categories').select('question_id, categories(slug)')
      .range(from, from + PAGE - 1)) as unknown as {
        data: Array<{ question_id: string; categories: { slug: string } | null }> | null;
        error: { message: string } | null;
      };
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const row of data) {
      const slug = row.categories?.slug;
      if (!slug) continue;
      const arr = qidToSlugs.get(row.question_id) ?? [];
      arr.push(slug);
      qidToSlugs.set(row.question_id, arr);
    }
    if (data.length < PAGE) break;
  }

  const singleCatIds = pubIds.filter((id) => (qidToSlugs.get(id)?.length ?? 0) === 1);
  const out: QRow[] = [];
  for (let i = 0; i < singleCatIds.length; i += IN_CHUNK) {
    const chunk = singleCatIds.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from('questions').select('id, question_text, correct_answer, distractors')
      .in('id', chunk);
    if (error) throw new Error(error.message);
    for (const q of data ?? []) {
      out.push({
        id: q.id,
        question_text: q.question_text,
        correct_answer: q.correct_answer,
        distractors: q.distractors as string[],
        existing_slugs: qidToSlugs.get(q.id) ?? [],
      });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const supabase = createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: cats, error: cErr } = await supabase
    .from('categories')
    .select('id, slug, name, parent_id');
  if (cErr) throw new Error(cErr.message);

  const byId = new Map<string, { id: string; slug: string; name: string; parent_id: string | null }>();
  for (const c of cats ?? []) byId.set(c.id, c);

  function rootOf(slug: string): { root_slug: string; path: string[] } {
    const path: string[] = [];
    let cur = [...byId.values()].find((c) => c.slug === slug);
    while (cur) {
      path.push(cur.slug);
      if (!cur.parent_id) return { root_slug: cur.slug, path: path.reverse() };
      cur = byId.get(cur.parent_id);
    }
    return { root_slug: slug, path };
  }

  const categories = (cats ?? []).map((c) => {
    const r = rootOf(c.slug);
    return {
      slug: c.slug,
      name: c.name,
      parent_slug: c.parent_id ? byId.get(c.parent_id)?.slug ?? null : null,
      root_slug: r.root_slug,
    };
  });

  const qs = await fetchSingleCatQuestionsChunked(supabase);
  const enriched = qs.map((q) => {
    const slug = q.existing_slugs[0];
    const r = rootOf(slug);
    return {
      id: q.id,
      question_text: q.question_text,
      correct_answer: q.correct_answer,
      distractors: q.distractors,
      existing_slug: slug,
      root_slug: r.root_slug,
      root_path: r.path,
    };
  });

  enriched.sort((a, b) => a.root_slug.localeCompare(b.root_slug) || a.existing_slug.localeCompare(b.existing_slug));

  const out = {
    fetched_at: new Date().toISOString(),
    total: enriched.length,
    categories,
    questions: enriched,
  };

  const path = '/Users/jamiepersonal/Developer/pub-quiz/.planning/phases/999.20-recategorise-single-cat-questions/data/single-cat.json';
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`Wrote ${enriched.length} questions + ${categories.length} categories → ${path}`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
