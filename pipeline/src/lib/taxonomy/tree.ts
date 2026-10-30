import type { TypedSupabaseClient } from '../supabase.js';
import type { TaxNode, TaxTree } from './types.js';

// = the live PostgREST max-rows (MEASURED 2026-10-27, see apply.ts pageAll); a lower max-rows would silently truncate.
const PAGE = 1000;

async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

export async function loadTree(supabase: TypedSupabaseClient): Promise<TaxTree> {
  const cats = await fetchAll((f, t) =>
    supabase
      .from('categories')
      .select('id, slug, name, parent_id, depth, hidden_at, hidden_reason, protected')
      .order('id', { ascending: true })
      .range(f, t),
  );
  const aliasRows = await fetchAll((f, t) =>
    supabase.from('category_aliases').select('old_slug, category_id').order('old_slug', { ascending: true }).range(f, t),
  );
  // A failed flags read throws (fetchAll): running the review without the owner's flags would let it
  // recreate exactly what he hid. Only the weekly taxonomy CLI loads the tree, never the nightly run.
  const flagRows = await fetchAll((f, t) =>
    supabase.from('category_flags').select('name, norm, created_at').order('created_at', { ascending: false }).order('id').range(f, t),
  );
  const visRows = await fetchAll((f, t) =>
    supabase
      .from('category_visibility')
      .select('category_id, distinct_published')
      .order('category_id', { ascending: true })
      .range(f, t),
  );

  const distinct = new Map<string, number>();
  for (const v of visRows) if (v.category_id) distinct.set(v.category_id, v.distinct_published ?? 0);

  const ids = new Set(cats.map((c) => c.id));
  const byId = new Map<string, TaxNode>();
  const bySlug = new Map<string, TaxNode>();
  for (const c of cats) {
    const node: TaxNode = {
      id: c.id,
      slug: c.slug,
      name: c.name,
      // A parent missing from the loaded set makes the node a root; nothing is invented.
      parentId: c.parent_id && ids.has(c.parent_id) ? c.parent_id : null,
      depth: c.depth,
      distinctPublished: distinct.get(c.id) ?? 0,
      hidden: c.hidden_at != null,
      hiddenReason: c.hidden_reason ?? null,
      protected: !!c.protected,
      childIds: [],
    };
    byId.set(node.id, node);
    bySlug.set(node.slug, node);
  }
  for (const n of byId.values()) if (n.parentId) byId.get(n.parentId)!.childIds.push(n.id);

  const aliases = new Map<string, string>();
  for (const a of aliasRows) if (byId.has(a.category_id)) aliases.set(a.old_slug, a.category_id);

  const flags = new Map<string, string>();
  for (const r of flagRows) if (!flags.has(r.norm)) flags.set(r.norm, r.name);

  return { byId, bySlug, aliases, flags };
}

function walk(tree: TaxTree, rootSlug: string): TaxNode[] {
  const root = tree.bySlug.get(rootSlug);
  if (!root) throw new Error(`unknown category slug: ${JSON.stringify(rootSlug)}`);
  const out: TaxNode[] = [];
  const seen = new Set<string>();
  const visit = (n: TaxNode): void => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    out.push(n);
    const kids = n.childIds.map((id) => tree.byId.get(id)).filter((k): k is TaxNode => !!k);
    kids.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    kids.forEach(visit);
  };
  visit(root);
  return out;
}

export function subtreeSlugs(tree: TaxTree, rootSlug: string): string[] {
  return walk(tree, rootSlug).map((n) => n.slug);
}

// Model-facing text. Names are untrusted DB data: strip the field separator and line breaks.
const clean = (s: string): string => s.replace(/[|\r\n\u2028\u2029]+/g, ' ').trim();

export function renderSubtree(tree: TaxTree, rootSlug: string): string {
  return walk(tree, rootSlug)
    .map((n) => `${n.depth}|${clean(n.slug)}|${clean(n.name)}|${n.distinctPublished}|${n.hidden}|${n.protected}`)
    .join('\n');
}
