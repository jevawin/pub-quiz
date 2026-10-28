import { describe, it, expect } from 'vitest';
import { isJunkSlug, isProtectedOrUnder, chooseSurvivor, validatePlan } from '../rules.js';
import { TaxPlanSchema, type TaxNode, type TaxTree, type TaxPlan } from '../types.js';

function mk(
  slug: string,
  parent: string | null,
  depth: number,
  n = 0,
  extra: Partial<TaxNode> = {},
): TaxNode {
  return {
    id: `id-${slug}`,
    slug,
    name: slug,
    parentId: parent ? `id-${parent}` : null,
    depth,
    distinctPublished: n,
    hidden: false,
    hiddenReason: null,
    protected: false,
    childIds: [],
    ...extra,
  };
}

function tree(nodes: TaxNode[], aliases: Record<string, string> = {}): TaxTree {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) if (n.parentId) byId.get(n.parentId)!.childIds.push(n.id);
  return {
    byId,
    bySlug: new Map(nodes.map((n) => [n.slug, n])),
    aliases: new Map(Object.entries(aliases).map(([a, s]) => [a, `id-${s}`])),
  };
}

const empty: TaxPlan = { merges: [], hides: [], creates: [], rehomes: [], duplicates: [] };
const plan = (p: Partial<TaxPlan>): TaxPlan => ({ ...empty, ...p });

function fixture() {
  return tree(
    [
      mk('science', null, 0, 50),
      mk('physics', 'science', 1, 20),
      mk('deep', 'physics', 2, 5),
      mk('d3', 'deep', 3, 1),
      mk('d4', 'd3', 4, 1),
      mk('d5', 'd4', 5, 1),
      mk('geography', null, 0, 40),
      mk('famous-bridges', 'geography', 1, 5),
      mk('famous-world-bridges', 'geography', 1, 5),
      mk('bridges-a', 'geography', 1, 6),
      mk('bridges-b', 'geography', 1, 3),
      mk('history', null, 0, 30, { protected: true }),
      mk('wars', 'history', 1, 10),
    ],
    { 'old-bridges': 'famous-bridges' },
  );
}
const opts = { maxActions: 100, allowedQuestionIds: new Set(['q1', 'q2', 'any']) };

describe('isJunkSlug', () => {
  it('flags junk suffixes and non-kebab slugs', () => {
    expect(isJunkSlug('famous-bridges-quiz')).toBe(true);
    expect(isJunkSlug('famous-bridges')).toBe(false);
    expect(isJunkSlug('Famous_Bridges')).toBe(true);
    expect(isJunkSlug('x-subcategory')).toBe(true);
    expect(isJunkSlug('x-subcategories')).toBe(true);
    expect(isJunkSlug('x-trivia')).toBe(true);
    expect(isJunkSlug('x-questions')).toBe(true);
    expect(isJunkSlug('')).toBe(true);
    expect(isJunkSlug('a--b')).toBe(true);
    expect(isJunkSlug('quizzes-of-note')).toBe(false);
  });
});

describe('isProtectedOrUnder', () => {
  it('covers the node and descendants only', () => {
    const t = fixture();
    expect(isProtectedOrUnder(t, 'history')).toBe(true);
    expect(isProtectedOrUnder(t, 'wars')).toBe(true);
    expect(isProtectedOrUnder(t, 'physics')).toBe(false);
    expect(isProtectedOrUnder(t, 'nope')).toBe(false);
  });
});

describe('chooseSurvivor', () => {
  it('picks most questions, then shorter slug, then alphabetical', () => {
    const t = fixture();
    expect(chooseSurvivor(t, ['bridges-b', 'bridges-a'])).toBe('bridges-a');
    expect(chooseSurvivor(t, ['famous-world-bridges', 'famous-bridges'])).toBe('famous-bridges');
    const t2 = tree([mk('root', null, 0), mk('bb', 'root', 1, 2), mk('aa', 'root', 1, 2)]);
    expect(chooseSurvivor(t2, ['bb', 'aa'])).toBe('aa');
  });
});

describe('TaxPlanSchema', () => {
  it('defaults missing arrays and rejects bad shapes', () => {
    expect(TaxPlanSchema.parse({})).toEqual(empty);
    expect(TaxPlanSchema.safeParse({ merges: 'x' }).success).toBe(false);
  });
});

describe('validatePlan', () => {
  it('accepts a clean merge', () => {
    const p = plan({ merges: [{ survivor: 'bridges-a', absorbed: ['bridges-b'], why: 'dup' }] });
    const r = validatePlan(fixture(), p, opts);
    expect(r.plan.merges).toHaveLength(1);
    expect(r.rejected).toEqual([]);
  });

  it('rejects hallucinated slugs with the slug in the reason, others proceed', () => {
    const p = plan({
      merges: [{ survivor: 'bridges-a', absorbed: ['ghost-slug'], why: '' }],
      hides: [{ slug: 'bridges-b', why: 'thin' }],
    });
    const r = validatePlan(fixture(), p, opts);
    expect(r.plan.merges).toHaveLength(0);
    expect(r.plan.hides).toHaveLength(1);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].reason).toContain('ghost-slug');
  });

  it('rejects merges naming a protected or under-protected node, on either side', () => {
    const p = plan({
      merges: [
        { survivor: 'bridges-a', absorbed: ['wars'], why: '' },
        { survivor: 'wars', absorbed: ['bridges-b'], why: '' },
        { survivor: 'bridges-a', absorbed: ['history'], why: '' },
      ],
      hides: [{ slug: 'wars', why: '' }],
    });
    const r = validatePlan(fixture(), p, opts);
    expect(r.plan.merges).toHaveLength(0);
    expect(r.plan.hides).toHaveLength(0);
    expect(r.rejected).toHaveLength(4);
  });

  it('drops the survivor from its own absorbed list', () => {
    const p = plan({ merges: [{ survivor: 'bridges-a', absorbed: ['bridges-a', 'bridges-b'], why: '' }] });
    const r = validatePlan(fixture(), p, opts);
    expect(r.plan.merges[0].absorbed).toEqual(['bridges-b']);
  });

  it('rejects a merge left with nothing to absorb', () => {
    const p = plan({ merges: [{ survivor: 'bridges-a', absorbed: ['bridges-a'], why: '' }] });
    const r = validatePlan(fixture(), p, opts);
    expect(r.plan.merges).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
  });

  it('overrides the survivor but still merges, recording a note', () => {
    const p = plan({ merges: [{ survivor: 'bridges-b', absorbed: ['bridges-a'], why: '' }] });
    const r = validatePlan(fixture(), p, opts);
    expect(r.plan.merges).toEqual([{ survivor: 'bridges-a', absorbed: ['bridges-b'], why: '' }]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].kind).toBe('merges');
    expect(r.rejected[0].reason).toContain('survivor overridden');
  });

  it('rejects absorbing an ancestor of the survivor', () => {
    // (science, a root, is now rejected earlier by the root guard; use a non-root ancestor)
    const p = plan({ merges: [{ survivor: 'deep', absorbed: ['physics'], why: '' }] });
    const r = validatePlan(fixture(), p, opts);
    expect(r.plan.merges).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/ancestor/);
  });

  it('rejects absorbing a node whose subtree holds a protected node; survivor may', () => {
    const t = fixture();
    t.bySlug.get('bridges-b')!.protected = false;
    const mkTree = (aN: number, bN: number) =>
      tree([mk('root', null, 0), mk('a', 'root', 1, aN), mk('b', 'root', 1, bN), mk('b-kid', 'b', 2, 1, { protected: true })]);
    const bad = validatePlan(mkTree(9, 3), plan({ merges: [{ survivor: 'a', absorbed: ['b'], why: '' }] }), opts);
    expect(bad.plan.merges).toHaveLength(0);
    expect(bad.rejected[0].reason).toContain('b');
    const ok = validatePlan(mkTree(3, 9), plan({ merges: [{ survivor: 'b', absorbed: ['a'], why: '' }] }), opts);
    expect(ok.plan.merges).toHaveLength(1);
  });

  it('rejects when an override makes the model survivor absorbed and it has a protected child', () => {
    const t = tree([
      mk('root', null, 0),
      mk('small', 'root', 1, 3),
      mk('small-kid', 'small', 2, 1, { protected: true }),
      mk('big', 'root', 1, 9),
    ]);
    const r = validatePlan(t, plan({ merges: [{ survivor: 'small', absorbed: ['big'], why: '' }] }), opts);
    expect(r.plan.merges).toHaveLength(0);
    expect(r.rejected.some((x) => x.reason.includes('small'))).toBe(true);
  });

  it('rejects hiding a node with a protected descendant', () => {
    const t = tree([mk('root', null, 0), mk('b', 'root', 1, 3), mk('b-kid', 'b', 2, 1, { protected: true })]);
    const r = validatePlan(t, plan({ hides: [{ slug: 'b', why: '' }] }), opts);
    expect(r.plan.hides).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
  });

  it('merge chains are rejected in both orders, naming the slug', () => {
    const t = fixture();
    const survivorFirst = validatePlan(t, plan({ merges: [
      { survivor: 'bridges-a', absorbed: ['bridges-b'], why: '' },
      { survivor: 'famous-bridges', absorbed: ['bridges-a'], why: '' },
    ] }), opts);
    expect(survivorFirst.plan.merges).toHaveLength(1);
    expect(survivorFirst.rejected[0].reason).toContain('bridges-a');
    const absorbedFirst = validatePlan(t, plan({ merges: [
      { survivor: 'bridges-a', absorbed: ['bridges-b'], why: '' },
      { survivor: 'bridges-b', absorbed: ['famous-bridges'], why: '' },
    ] }), opts);
    expect(absorbedFirst.plan.merges).toHaveLength(1);
    expect(absorbedFirst.rejected[0].reason).toContain('bridges-b');
  });

  it('rejects a slug absorbed twice in one plan', () => {
    const p = plan({
      merges: [
        { survivor: 'bridges-a', absorbed: ['bridges-b'], why: '' },
        { survivor: 'famous-bridges', absorbed: ['bridges-b'], why: '' },
      ],
    });
    const r = validatePlan(fixture(), p, opts);
    expect(r.plan.merges).toHaveLength(1);
    expect(r.rejected).toHaveLength(1);
  });

  describe('creates', () => {
    const c = (o: Partial<TaxPlan['creates'][0]>) => ({
      slug: 'new-thing',
      name: 'New thing',
      parent: 'physics',
      why: '',
      ...o,
    });
    it('accepts a valid create', () => {
      const r = validatePlan(fixture(), plan({ creates: [c({})] }), opts);
      expect(r.plan.creates).toHaveLength(1);
    });
    it('rejects junk, existing slug, existing alias, missing parent, depth-5 parent', () => {
      const r = validatePlan(
        fixture(),
        plan({
          creates: [
            c({ slug: 'new-thing-quiz' }),
            c({ slug: 'physics' }),
            c({ slug: 'old-bridges' }),
            c({ parent: 'nowhere' }),
            c({ parent: 'd5' }),
          ],
        }),
        opts,
      );
      expect(r.plan.creates).toHaveLength(0);
      expect(r.rejected).toHaveLength(5);
    });
    it('accepts depth 5 under a depth-4 parent', () => {
      const r = validatePlan(fixture(), plan({ creates: [c({ parent: 'd4' })] }), opts);
      expect(r.plan.creates).toHaveLength(1);
    });
    it('allows a create under a parent created earlier in the plan, with depth tracked', () => {
      const r = validatePlan(
        fixture(),
        plan({ creates: [c({ slug: 'kid', parent: 'd4' }), c({ slug: 'grandkid', parent: 'kid' })] }),
        opts,
      );
      expect(r.plan.creates).toHaveLength(1);
      expect(r.rejected).toHaveLength(1);
    });
    it('rejects a duplicate create within the plan', () => {
      const r = validatePlan(fixture(), plan({ creates: [c({}), c({})] }), opts);
      expect(r.plan.creates).toHaveLength(1);
      expect(r.rejected).toHaveLength(1);
    });
    it('allows creating under a protected parent', () => {
      const r = validatePlan(fixture(), plan({ creates: [c({ parent: 'history' })] }), opts);
      expect(r.plan.creates).toHaveLength(1);
    });
  });

  describe('rehomes', () => {
    const allowed = new Set(['q1', 'q2']);
    it('accepts a rehome to a slug created in the same plan', () => {
      const r = validatePlan(
        fixture(),
        plan({
          creates: [{ slug: 'fresh', name: 'Fresh', parent: 'physics', why: '' }],
          rehomes: [{ questionId: 'q1', from: 'physics', to: 'fresh' }],
        }),
        { maxActions: 10, allowedQuestionIds: allowed },
      );
      expect(r.plan.rehomes).toHaveLength(1);
    });
    it('rejects an unknown target, unknown source, unknown question, protected source', () => {
      const r = validatePlan(
        fixture(),
        plan({
          rehomes: [
            { questionId: 'q1', from: 'physics', to: 'nowhere' },
            { questionId: 'q1', from: 'nowhere', to: 'physics' },
            { questionId: 'ghost', from: 'physics', to: 'deep' },
            { questionId: 'q2', from: 'wars', to: 'physics' },
          ],
        }),
        { maxActions: 10, allowedQuestionIds: allowed },
      );
      expect(r.plan.rehomes).toHaveLength(0);
      expect(r.rejected).toHaveLength(4);
      expect(r.rejected[2].reason).toContain('ghost');
    });
    it('does not accept a rehome to a create that was itself rejected', () => {
      const r = validatePlan(
        fixture(),
        plan({
          creates: [{ slug: 'bad-quiz', name: 'Bad', parent: 'physics', why: '' }],
          rehomes: [{ questionId: 'q1', from: 'physics', to: 'bad-quiz' }],
        }),
        opts,
      );
      expect(r.plan.rehomes).toHaveLength(0);
    });
    it('rejects an id outside the set (empty set rejects all)', () => {
      const p = plan({ rehomes: [{ questionId: 'q1', from: 'physics', to: 'deep' }] });
      const r = validatePlan(fixture(), p, { maxActions: 10, allowedQuestionIds: new Set<string>() });
      expect(r.plan.rehomes).toHaveLength(0);
      expect(r.rejected[0].reason).toContain('q1');
    });
  });

  describe('duplicates', () => {
    it('checks ids against the allowed set', () => {
      const r = validatePlan(
        fixture(),
        plan({
          duplicates: [
            { keep: 'q1', flag: 'q2', why: '' },
            { keep: 'q1', flag: 'zzz', why: '' },
            { keep: 'q1', flag: 'q1', why: '' },
          ],
        }),
        { maxActions: 10, allowedQuestionIds: new Set(['q1', 'q2']) },
      );
      expect(r.plan.duplicates).toHaveLength(1);
      expect(r.rejected).toHaveLength(2);
    });
  });

  describe('action cap', () => {
    it('rejects overflow: 3 hides with maxActions 2', () => {
      const p = plan({
        hides: [
          { slug: 'bridges-a', why: '' },
          { slug: 'bridges-b', why: '' },
          { slug: 'famous-bridges', why: '' },
        ],
      });
      const r = validatePlan(fixture(), p, { maxActions: 2, allowedQuestionIds: new Set<string>() });
      expect(r.plan.hides).toHaveLength(2);
      expect(r.rejected).toHaveLength(1);
      expect(r.rejected[0].reason).toBe('over action cap');
    });
    it('counts in order merges, hides, creates, rehomes, duplicates; rejected items use no budget', () => {
      const p = plan({
        merges: [
          { survivor: 'bridges-a', absorbed: ['ghost'], why: '' },
          { survivor: 'bridges-a', absorbed: ['bridges-b'], why: '' },
        ],
        hides: [{ slug: 'famous-bridges', why: '' }],
        creates: [{ slug: 'fresh', name: 'Fresh', parent: 'physics', why: '' }],
        rehomes: [{ questionId: 'q1', from: 'physics', to: 'deep' }],
        duplicates: [{ keep: 'q1', flag: 'q2', why: '' }],
      });
      const r = validatePlan(fixture(), p, { maxActions: 3, allowedQuestionIds: new Set(['q1', 'q2']) });
      expect(r.plan.merges).toHaveLength(1);
      expect(r.plan.hides).toHaveLength(1);
      expect(r.plan.creates).toHaveLength(1);
      expect(r.plan.rehomes).toHaveLength(0);
      expect(r.plan.duplicates).toHaveLength(0);
      expect(r.rejected.filter((x) => x.reason === 'over action cap').map((x) => x.kind)).toEqual([
        'rehomes',
        'duplicates',
      ]);
    });
    it('a survivor-override note does not consume budget', () => {
      const p = plan({
        merges: [{ survivor: 'bridges-b', absorbed: ['bridges-a'], why: '' }],
        hides: [{ slug: 'famous-bridges', why: '' }],
      });
      const r = validatePlan(fixture(), p, { maxActions: 2, allowedQuestionIds: new Set<string>() });
      expect(r.plan.merges).toHaveLength(1);
      expect(r.plan.hides).toHaveLength(1);
    });
  });
});
