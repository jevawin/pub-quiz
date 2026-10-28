import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';

const HIDDEN_REASONS = new Set(['merged', 'trimmed', 'veto']);
const PAGE_SIZE = 1000;
const SLUG_RE = /^[a-z0-9-]+$/;

export interface ResolveResult {
  /** Input slug (as given, possibly an alias) → category id (the survivor for aliases). */
  ids: Map<string, string>;
  /** Slugs that could not be resolved (only populated with `dropUnknown: true`). */
  dropped: string[];
}

/**
 * Resolve slugs to category ids.
 *  - A live (non-hidden) category with that slug wins.
 *  - Otherwise `category_aliases` is consulted (aliases point at the survivor of a merge).
 *    A resolved target that is itself hidden (merged/trimmed/veto) counts as unknown.
 *  - Unknown slugs throw (default, legacy behaviour) or are returned in `dropped`.
 * A directly matched but hidden category with no alias is accepted in legacy (throwing) mode so
 * existing-row rescoring keeps working, and treated as unknown with `dropUnknown`.
 */
export async function resolveSlugsToIds(
  supabase: SupabaseClient<Database>,
  slugs: string[],
  opts: { dropUnknown?: boolean } = {},
): Promise<ResolveResult> {
  const ids = new Map<string, string>();
  const dropped: string[] = [];
  if (slugs.length === 0) return { ids, dropped };

  // A malformed slug (quote, comma, ...) must never reach the .in() filter: PostgREST would reject
  // the whole query. Real slugs are all kebab-case, so treat anything else as unknown up front.
  const wellFormed = slugs.filter((s) => SLUG_RE.test(s));
  const malformed = new Set(slugs.filter((s) => !SLUG_RE.test(s)));
  if (wellFormed.length === 0 && malformed.size > 0 && !opts.dropUnknown) {
    throw new Error(`Unknown category slug: ${[...malformed][0]}`);
  }
  if (wellFormed.length === 0) return { ids, dropped: [...malformed] };

  const { data, error } = await supabase
    .from('categories')
    .select('id, slug, hidden_reason')
    .in('slug', wellFormed);
  if (error) throw error;

  const direct = new Map<string, { id: string; hidden: boolean }>();
  for (const row of data ?? []) {
    direct.set(row.slug, { id: row.id, hidden: HIDDEN_REASONS.has(row.hidden_reason ?? '') });
  }

  // Slugs not usable directly: absent, or present but hidden. Try aliases for these.
  const needAlias = wellFormed.filter((s) => !direct.get(s) || direct.get(s)!.hidden);
  const aliasTarget = new Map<string, string>();
  if (needAlias.length > 0) {
    const { data: aliasRows, error: aErr } = await supabase
      .from('category_aliases')
      .select('old_slug, category_id')
      .in('old_slug', needAlias);
    if (aErr) throw aErr;
    for (const a of aliasRows ?? []) aliasTarget.set(a.old_slug, a.category_id);
  }

  const targetHidden = new Map<string, boolean>();
  const targetIds = [...new Set(aliasTarget.values())];
  if (targetIds.length > 0) {
    const { data: tRows, error: tErr } = await supabase
      .from('categories')
      .select('id, hidden_reason')
      .in('id', targetIds);
    if (tErr) throw tErr;
    for (const t of tRows ?? []) targetHidden.set(t.id, HIDDEN_REASONS.has(t.hidden_reason ?? ''));
  }

  for (const slug of slugs) {
    if (malformed.has(slug)) {
      if (!opts.dropUnknown) throw new Error(`Unknown category slug: ${slug}`);
      dropped.push(slug);
      continue;
    }
    const d = direct.get(slug);
    if (d && !d.hidden) {
      ids.set(slug, d.id);
      continue;
    }
    const target = aliasTarget.get(slug);
    // Target must be known and visible; an unreadable target counts as unknown.
    if (target && targetHidden.get(target) === false) {
      ids.set(slug, target);
      continue;
    }
    if (d && !target && !opts.dropUnknown) {
      ids.set(slug, d.id); // legacy: hidden category rescored in place
      continue;
    }
    if (opts.dropUnknown) {
      dropped.push(slug);
    } else {
      throw new Error(`Unknown category slug: ${slug}`);
    }
  }
  return { ids, dropped };
}

/** Slugs the generator may assign: hidden_reason NULL (threshold-hidden included), depth >= 1, sorted. */
export async function listUsableSlugs(supabase: SupabaseClient<Database>): Promise<string[]> {
  const slugs: string[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('categories')
      .select('slug')
      .is('hidden_reason', null)
      .gte('depth', 1)
      .order('slug', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) slugs.push(r.slug);
    if (rows.length < PAGE_SIZE) break;
  }
  return slugs;
}
