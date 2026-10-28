import { describe, it, expect } from 'vitest';
import { loadTree, subtreeSlugs, renderSubtree } from '../tree.js';
import type { TypedSupabaseClient } from '../../supabase.js';

type Row = Record<string, unknown>;

function fakeClient(tables: Record<string, Row[]>): TypedSupabaseClient {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const q = {
        select: () => q,
        order: () => q,
        range: (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
      };
      return q;
    },
  } as unknown as TypedSupabaseClient;
}

const cat = (slug: string, parent: string | null, depth: number, extra: Row = {}): Row => ({
  id: `id-${slug}`, slug, name: slug, parent_id: parent ? `id-${parent}` : null, depth,
  hidden_at: null, hidden_reason: null, protected: false, ...extra,
});
const vis = (slug: string, n: number): Row => ({ category_id: `id-${slug}`, distinct_published: n });

const fixture = () => ({
  categories: [
    cat('science', null, 0, { protected: true, name: 'Science' }),
    cat('physics', 'science', 1, { name: 'Physics' }),
    cat('biology', 'science', 1, { name: 'Biology', hidden_at: '2026-01-01', hidden_reason: 'thin' }),
    cat('quantum', 'physics', 2, { name: 'Quantum' }),
  ],
  category_aliases: [{ old_slug: 'old-physics', category_id: 'id-physics' }],
  category_visibility: [vis('science', 50), vis('physics', 20), vis('biology', 2), vis('quantum', 11)],
});

describe('loadTree', () => {
  it('wires children, depth, hidden, protected, aliases', async () => {
    const t = await loadTree(fakeClient(fixture()));
    expect(t.byId.size).toBe(4);
    expect(t.bySlug.get('science')!.childIds.sort()).toEqual(['id-biology', 'id-physics']);
    expect(t.bySlug.get('quantum')!.depth).toBe(2);
    expect(t.bySlug.get('quantum')!.distinctPublished).toBe(11);
    const bio = t.bySlug.get('biology')!;
    expect(bio.hidden).toBe(true);
    expect(bio.hiddenReason).toBe('thin');
    expect(t.bySlug.get('science')!.protected).toBe(true);
    expect(t.aliases.get('old-physics')).toBe('id-physics');
  });

  it('pages past 1000 rows', async () => {
    const f = fixture();
    for (let i = 0; i < 1500; i++) {
      f.categories.push(cat(`c${i}`, 'science', 1));
      f.category_visibility.push(vis(`c${i}`, 1));
    }
    const t = await loadTree(fakeClient(f));
    expect(t.byId.size).toBe(1504);
    expect(t.bySlug.get('science')!.childIds.length).toBe(1502);
  });

  it('skips aliases pointing at a missing category', async () => {
    const f = fixture();
    f.category_aliases.push({ old_slug: 'ghost', category_id: 'id-nope' });
    const t = await loadTree(fakeClient(f));
    expect(t.aliases.has('ghost')).toBe(false);
    expect(t.aliases.size).toBe(1);
  });

  it('treats a node with a missing parent as a root (parentId null)', async () => {
    const f = fixture();
    f.categories.push(cat('lost', 'gone', 1));
    const t = await loadTree(fakeClient(f));
    expect(t.bySlug.get('lost')!.parentId).toBeNull();
    expect(t.bySlug.get('science')!.childIds).not.toContain('id-lost');
  });

  it('defaults distinct to 0 when the view has no row', async () => {
    const f = fixture();
    f.category_visibility = [];
    const t = await loadTree(fakeClient(f));
    expect(t.bySlug.get('physics')!.distinctPublished).toBe(0);
  });
});

describe('subtreeSlugs / renderSubtree', () => {
  it('lists the subtree depth-first, children by slug', async () => {
    const t = await loadTree(fakeClient(fixture()));
    expect(subtreeSlugs(t, 'science')).toEqual(['science', 'biology', 'physics', 'quantum']);
    expect(subtreeSlugs(t, 'quantum')).toEqual(['quantum']);
  });

  it('renders one line per node', async () => {
    const t = await loadTree(fakeClient(fixture()));
    expect(renderSubtree(t, 'science')).toMatchInlineSnapshot(`
      "0|science|Science|50|false|true
      1|biology|Biology|2|true|false
      1|physics|Physics|20|false|false
      2|quantum|Quantum|11|false|false"
    `);
  });

  it('throws naming an unknown slug', async () => {
    const t = await loadTree(fakeClient(fixture()));
    expect(() => subtreeSlugs(t, 'nope')).toThrow(/nope/);
    expect(() => renderSubtree(t, 'nope')).toThrow(/nope/);
  });

  it('strips pipes and newlines from names so lines cannot be forged', async () => {
    const f = fixture();
    f.categories.push(cat('evil', 'science', 1, { name: 'Bad|9|x\n1|forged|Forged|99|false|true' }));
    const t = await loadTree(fakeClient(f));
    const lines = renderSubtree(t, 'science').split('\n');
    expect(lines).toHaveLength(5);
    const evil = lines.find((l) => l.includes('|evil|'))!;
    expect(evil.split('|')).toHaveLength(6);
  });
});
