import type { TaxTree } from './types.js';

const STOP_WORDS = new Set(['the', 'a', 'an', 'of']);

/**
 * Normalised key for matching a category against the owner's flags (category_flags.norm).
 * Case, punctuation, "&"/"and", stop words and simple plurals are ignored, so "Breakfast Foods",
 * "breakfast-foods" and "The Breakfast Food" all give "breakfast-food". Deliberately NOT semantic
 * ("Morning Meals" does not match): meaning-level avoidance is the prompt's job, this is the hard stop.
 */
export function normCategoryName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP_WORDS.has(w) && w !== 'and')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join('-');
}

/** The flag a create would recreate (by name or slug), or null. */
export function flaggedMatch(tree: TaxTree, name: string, slug: string): string | null {
  const flags = tree.flags;
  if (!flags || flags.size === 0) return null;
  return flags.get(normCategoryName(name)) ?? flags.get(normCategoryName(slug)) ?? null;
}

/** Flag names for the assess prompt: newest first (tree.flags is loaded newest first), capped, one line each. */
export function flagNamesForPrompt(tree: TaxTree, cap = 20): string[] {
  return [...(tree.flags?.values() ?? [])]
    .map((n) => n.replace(/[\r\n<>`]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, cap);
}

type Db = import('../supabase.js').TypedSupabaseClient;

/** Record an owner flag. Idempotent on the normalised name (an existing flag is kept as-is). Returns the norm. */
export async function addFlag(sb: Db, name: string, categoryId: string | null, note: string | null): Promise<string> {
  const norm = normCategoryName(name);
  if (!norm) throw new Error(`flag name normalises to nothing: ${name}`);
  const { error } = await sb
    .from('category_flags')
    .upsert({ name: name.trim().slice(0, 120), norm, category_id: categoryId, note }, { onConflict: 'norm', ignoreDuplicates: true });
  if (error) throw new Error(`add flag failed: ${error.message}`);
  return norm;
}

/** Remove owner flags by normalised name and/or category id. Returns how many were removed. */
export async function removeFlags(sb: Db, by: { name?: string; categoryId?: string }): Promise<number> {
  let removed = 0;
  if (by.name) {
    const { data, error } = await sb.from('category_flags').delete().eq('norm', normCategoryName(by.name)).select('id');
    if (error) throw new Error(`remove flag failed: ${error.message}`);
    removed += data?.length ?? 0;
  }
  if (by.categoryId) {
    const { data, error } = await sb.from('category_flags').delete().eq('category_id', by.categoryId).select('id');
    if (error) throw new Error(`remove flag failed: ${error.message}`);
    removed += data?.length ?? 0;
  }
  return removed;
}

/** Note written on a flag created by `hide --reason veto`; unhide/undo remove ONLY flags carrying it. */
export const VETO_NOTE_PREFIX = 'veto hide ';

/**
 * Remove the flags a veto hide created: for one category (unhide) or one run (undo). Flags the owner
 * set directly with `flag` are never touched. Returns how many were removed.
 */
export async function removeVetoFlags(sb: Db, by: { categoryId?: string; runId?: string }): Promise<number> {
  let q = sb.from('category_flags').select('id, note');
  if (by.categoryId) q = q.eq('category_id', by.categoryId);
  if (by.runId) q = q.eq('note', VETO_NOTE_PREFIX + by.runId);
  const { data, error } = await q;
  if (error) throw new Error(`flag lookup failed: ${error.message}`);
  let removed = 0;
  for (const r of data ?? []) {
    if (!r.note?.startsWith(VETO_NOTE_PREFIX)) continue;
    const del = await sb.from('category_flags').delete().eq('id', r.id);
    if (del.error) throw new Error(`remove flag failed: ${del.error.message}`);
    removed++;
  }
  return removed;
}
