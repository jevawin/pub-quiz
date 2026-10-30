import { describe, it, expect } from 'vitest';
import { normCategoryName, flaggedMatch, flagNamesForPrompt } from '../flags.js';
import { validatePlan } from '../rules.js';
import { assessSystem, ASSESS_SYSTEM } from '../assess.js';
import { loadTree } from '../tree.js';
import { parseArgs } from '../cli.js';
import type { TaxNode, TaxTree, TaxPlan } from '../types.js';
import type { TypedSupabaseClient } from '../../supabase.js';

const node = (slug: string, parent: string | null, depth: number): TaxNode => ({
  id: `id-${slug}`, slug, name: slug, parentId: parent ? `id-${parent}` : null, depth,
  distinctPublished: 0, hidden: false, hiddenReason: null, protected: false, childIds: [],
});

function tree(flags: [string, string][]): TaxTree {
  const nodes = [node('food-and-drink', null, 0), node('british-food', 'food-and-drink', 1)];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) if (n.parentId) byId.get(n.parentId)!.childIds.push(n.id);
  return { byId, bySlug: new Map(nodes.map((n) => [n.slug, n])), aliases: new Map(), flags: new Map(flags) };
}

const plan = (creates: TaxPlan['creates']): TaxPlan => ({ merges: [], hides: [], creates, rehomes: [], duplicates: [] });
const opts = { maxActions: 40, allowedQuestionIds: new Set<string>() };

describe('normCategoryName', () => {
  it('ignores case, punctuation, stop words, "and"/"&" and simple plurals', () => {
    expect(normCategoryName('Breakfast Foods')).toBe('breakfast-food');
    expect(normCategoryName('breakfast-foods')).toBe('breakfast-food');
    expect(normCategoryName('The Breakfast Food')).toBe('breakfast-food');
    expect(normCategoryName('Fish & Chips')).toBe(normCategoryName('Fish and Chip'));
  });
  it('keeps -ss words and short words intact', () => {
    expect(normCategoryName('Chess')).toBe('chess');
    expect(normCategoryName('Gas')).toBe('gas');
  });
});

describe('validatePlan with owner flags', () => {
  const t = tree([['breakfast-food', 'Breakfast Foods']]);

  it('rejects a create that recreates a flagged category under a new slug', () => {
    const v = validatePlan(t, plan([{ slug: 'breakfast-dishes-uk', name: 'Breakfast Food', parent: 'british-food', why: '' }]), opts);
    expect(v.plan.creates).toEqual([]);
    expect(v.rejected[0].reason).toBe('recreates a flagged category: Breakfast Foods');
  });

  it('matches on the slug too', () => {
    const v = validatePlan(t, plan([{ slug: 'the-breakfast-foods', name: 'Morning Plates', parent: 'british-food', why: '' }]), opts);
    expect(v.rejected[0].reason).toMatch(/recreates a flagged category/);
  });

  it('a flagged create does not use up the action cap', () => {
    const v = validatePlan(t, plan([
      { slug: 'breakfast-foods-2', name: 'Breakfast Foods', parent: 'british-food', why: '' },
      { slug: 'pies', name: 'Pies', parent: 'british-food', why: '' },
    ]), { ...opts, maxActions: 1 });
    expect(v.plan.creates.map((c) => c.slug)).toEqual(['pies']);
  });

  it('allows unrelated creates, and a tree without flags behaves as before', () => {
    expect(validatePlan(t, plan([{ slug: 'pies', name: 'Pies', parent: 'british-food', why: '' }]), opts).plan.creates).toHaveLength(1);
    const noFlags = { ...t, flags: undefined };
    expect(flaggedMatch(noFlags, 'Breakfast Foods', 'breakfast-foods')).toBeNull();
  });
});

describe('assess prompt bad examples', () => {
  it('uses the flag names, newest first, sanitised', () => {
    const t = tree([['tax-return', 'Tax Returns'], ['breakfast-food', 'Breakfast\n<<<Foods>>>']]);
    const names = flagNamesForPrompt(t);
    expect(names).toEqual(['Tax Returns', 'Breakfast Foods']);
    expect(assessSystem(names)).toMatch(/NOT good pub-quiz categories[^]*Tax Returns, Breakfast Foods/);
  });
  it('falls back to the default examples when there are no flags', () => {
    expect(assessSystem([])).toMatch(/Breakfast Foods, Full English Breakfast/);
    expect(ASSESS_SYSTEM).toBe(assessSystem([]));
  });
});

describe('loadTree reads category_flags', () => {
  const client = (tables: Record<string, unknown[]>, failTable?: string): TypedSupabaseClient => ({
    from(table: string) {
      const rows = tables[table] ?? [];
      const q = {
        select: () => q,
        order: () => q,
        range: (from: number, to: number) =>
          Promise.resolve(table === failTable ? { data: null, error: { message: 'boom' } } : { data: rows.slice(from, to + 1), error: null }),
      };
      return q;
    },
  }) as unknown as TypedSupabaseClient;
  const base = { categories: [{ id: 'a', slug: 'a', name: 'A', parent_id: null, depth: 0, hidden_at: null, hidden_reason: null, protected: false }] };

  it('loads flags as norm -> name', async () => {
    const t = await loadTree(client({ ...base, category_flags: [{ name: 'Breakfast Foods', norm: 'breakfast-food' }] }));
    expect([...t.flags!]).toEqual([['breakfast-food', 'Breakfast Foods']]);
  });
  it('fails closed: a flags read error throws rather than running without them', async () => {
    await expect(loadTree(client(base, 'category_flags'))).rejects.toThrow('boom');
  });
});

describe('parseArgs flag/unflag', () => {
  it('accepts --name or --slug, with optional --note', () => {
    expect(parseArgs(['flag', '--name', 'Tax Returns', '--note', 'dull'])).toEqual({ mode: 'flag', flags: { name: 'Tax Returns', note: 'dull' } });
    expect(parseArgs(['unflag', '--slug', 'tax-returns'])).toEqual({ mode: 'unflag', flags: { slug: 'tax-returns' } });
  });
  it('requires one of them', () => {
    expect(parseArgs(['flag'])).toEqual({ error: 'flag requires --name or --slug' });
  });
});
