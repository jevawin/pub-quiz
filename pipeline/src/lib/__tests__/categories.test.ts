import { describe, it, expect } from 'vitest';
import { resolveSlugsToIds, listUsableSlugs } from '../categories.js';

type Cat = { id: string; slug: string; hidden_reason: string | null; depth?: number };

function fake(cats: Cat[], aliases: Array<{ old_slug: string; category_id: string }> = []) {
  const pageCalls: Array<[number, number]> = [];
  const from = (table: string) => {
    const rows: any[] = table === 'categories' ? cats : aliases;
    let result = rows;
    const chain: any = {
      select: () => chain,
      in: (col: string, vals: string[]) => ((result = result.filter((r) => vals.includes(r[col]))), chain),
      is: (col: string, v: null) => ((result = result.filter((r) => (r[col] ?? null) === v)), chain),
      gte: (col: string, v: number) => ((result = result.filter((r) => r[col] >= v)), chain),
      order: (col: string) => ((result = [...result].sort((a, b) => (a[col] < b[col] ? -1 : 1))), chain),
      range: (a: number, b: number) => ((pageCalls.push([a, b]), (result = result.slice(a, b + 1))), chain),
      then: (res: (v: unknown) => void) => Promise.resolve({ data: result, error: null }).then(res),
    };
    return chain;
  };
  return { client: { from } as any, pageCalls };
}

const cats: Cat[] = [
  { id: 'c-bridges', slug: 'famous-bridges', hidden_reason: null, depth: 2 },
  { id: 'c-old', slug: 'famous-bridges-quiz', hidden_reason: 'merged', depth: 2 },
  { id: 'c-veto', slug: 'vetoed', hidden_reason: 'veto', depth: 2 },
  { id: 'c-trim', slug: 'trimmed', hidden_reason: 'trimmed', depth: 2 },
  { id: 'c-root', slug: 'science', hidden_reason: null, depth: 0 },
  { id: 'c-low', slug: 'low-count', hidden_reason: null, depth: 3 },
];
const aliases = [
  { old_slug: 'famous-bridges-quiz', category_id: 'c-bridges' },
  { old_slug: 'to-veto', category_id: 'c-veto' },
];

describe('resolveSlugsToIds', () => {
  it('resolves an alias to the survivor id', async () => {
    const { client } = fake(cats, aliases);
    const r = await resolveSlugsToIds(client, ['famous-bridges-quiz']);
    expect(r.ids.get('famous-bridges-quiz')).toBe('c-bridges');
    expect(r.dropped).toEqual([]);
  });
  it('drops unknown with dropUnknown, no throw', async () => {
    const { client } = fake(cats, aliases);
    const r = await resolveSlugsToIds(client, ['famous-bridges', 'x'], { dropUnknown: true });
    expect(r.dropped).toEqual(['x']);
    expect(r.ids.get('famous-bridges')).toBe('c-bridges');
  });
  it('throws on unknown by default', async () => {
    const { client } = fake(cats, aliases);
    await expect(resolveSlugsToIds(client, ['x'])).rejects.toThrow('Unknown category slug: x');
  });
  it('treats an alias whose target is hidden as unknown', async () => {
    const { client } = fake(cats, aliases);
    const r = await resolveSlugsToIds(client, ['to-veto'], { dropUnknown: true });
    expect(r.dropped).toEqual(['to-veto']);
    await expect(resolveSlugsToIds(client, ['to-veto'])).rejects.toThrow();
  });
  it('drops a directly named hidden category with no alias under dropUnknown, accepts it in legacy mode', async () => {
    const { client } = fake(cats, aliases);
    expect((await resolveSlugsToIds(client, ['trimmed'], { dropUnknown: true })).dropped).toEqual(['trimmed']);
    expect((await resolveSlugsToIds(client, ['trimmed'])).ids.get('trimmed')).toBe('c-trim');
  });
  it('drops malformed slugs before the query (never reaches .in)', async () => {
    const { client } = fake(cats, aliases);
    const inArgs: string[][] = [];
    const orig = client.from;
    client.from = (t: string) => {
      const c = orig(t);
      const origIn = c.in;
      c.in = (col: string, vals: string[]) => (inArgs.push(vals), origIn(col, vals));
      return c;
    };
    const r = await resolveSlugsToIds(client, ['famous-bridges', 'bad"slug', 'a,b'], { dropUnknown: true });
    expect(r.dropped).toEqual(['bad"slug', 'a,b']);
    expect(r.ids.get('famous-bridges')).toBe('c-bridges');
    expect(inArgs.flat().some((v) => /["',]/.test(v))).toBe(false);
    await expect(resolveSlugsToIds(client, ['bad"slug'])).rejects.toThrow('Unknown category slug');
    expect((await resolveSlugsToIds(client, ['bad"slug'], { dropUnknown: true })).dropped).toEqual(['bad"slug']);
  });
  it('empty input', async () => {
    const { client } = fake(cats);
    expect(await resolveSlugsToIds(client, [])).toEqual({ ids: new Map(), dropped: [] });
  });
});

describe('listUsableSlugs', () => {
  it('excludes merged/trimmed/veto and roots, includes low-count, sorted', async () => {
    const { client } = fake(cats);
    expect(await listUsableSlugs(client)).toEqual(['famous-bridges', 'low-count']);
  });
  it('pages past the 1000-row cap', async () => {
    const many: Cat[] = Array.from({ length: 2500 }, (_, i) => ({
      id: `i${i}`, slug: `s-${String(i).padStart(5, '0')}`, hidden_reason: null, depth: 1,
    }));
    const { client, pageCalls } = fake(many);
    const out = await listUsableSlugs(client);
    expect(out.length).toBe(2500);
    expect(pageCalls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
});
