#!/usr/bin/env node
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import { writeFileSync } from 'node:fs';
import { createSupabaseClient } from '../lib/supabase.js';

async function main(): Promise<void> {
  const supabase = createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: cats, error: cErr } = await supabase
    .from('categories')
    .select('id, slug, name, parent_id');
  if (cErr) throw new Error(cErr.message);

  const byId = new Map(cats!.map((c) => [c.id, c]));
  const slugById = new Map(cats!.map((c) => [c.id, c.slug]));

  // Q count per cat (direct, no walk)
  const counts = new Map<string, number>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('question_categories')
      .select('category_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data) counts.set(r.category_id, (counts.get(r.category_id) ?? 0) + 1);
    if (data.length < PAGE) break;
  }

  function rootOf(id: string): string {
    let cur = byId.get(id);
    while (cur?.parent_id) cur = byId.get(cur.parent_id);
    return cur?.slug ?? '?';
  }

  const enriched = cats!.map((c) => ({
    slug: c.slug,
    name: c.name,
    parent_slug: c.parent_id ? slugById.get(c.parent_id) ?? null : null,
    root_slug: rootOf(c.id),
    direct_q_count: counts.get(c.id) ?? 0,
  }));

  enriched.sort((a, b) =>
    a.root_slug.localeCompare(b.root_slug) || (a.parent_slug ?? '').localeCompare(b.parent_slug ?? '') || a.slug.localeCompare(b.slug),
  );

  const path = '/Users/jamiepersonal/Developer/pub-quiz/.planning/phases/999.21-categories-cleanup/data/cat-tree-with-counts.json';
  const fs = await import('node:fs');
  fs.mkdirSync(path.replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(path, JSON.stringify({ fetched_at: new Date().toISOString(), total: enriched.length, categories: enriched }, null, 2));
  console.log(`Wrote ${enriched.length} cats → ${path}`);
}

void main().catch((e) => { console.error(e); process.exit(1); });
