import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';

export async function resolveSlugsToIds(
  supabase: SupabaseClient<Database>,
  slugs: string[],
): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map();
  const { data, error } = await supabase
    .from('categories')
    .select('id, slug')
    .in('slug', slugs);
  if (error) throw error;
  const map = new Map<string, string>();
  for (const row of data ?? []) map.set(row.slug, row.id);
  for (const slug of slugs) {
    if (!map.has(slug)) throw new Error(`Unknown category slug: ${slug}`);
  }
  return map;
}
