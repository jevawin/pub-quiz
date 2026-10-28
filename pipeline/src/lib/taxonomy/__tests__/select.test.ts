import { describe, it, expect } from 'vitest';
import { pickWeeklyRoots, pickRehomeCategories, leafQuestionIds, directCounts } from '../select.js';
import type { TaxNode, TaxTree } from '../types.js';

describe('pickWeeklyRoots (persisted state)', () => {
  it('never-assessed first, ties alphabetical', () => {
    expect(pickWeeklyRoots(['sport', 'art', 'music', 'film'], { sport: '2026-10-01T00:00:00Z' }, 3)).toEqual(['art', 'film', 'music']);
  });
  it('then oldest first', () => {
    const last = { a: '2026-10-20T00:00:00Z', b: '2026-10-10T00:00:00Z' };
    expect(pickWeeklyRoots(['a', 'b', 'c'], last, 2)).toEqual(['c', 'b']);
  });
  it('ties on time are alphabetical; bad timestamps count as never; n edge cases', () => {
    const t = '2026-10-10T00:00:00Z';
    expect(pickWeeklyRoots(['b', 'a'], { a: t, b: t }, 2)).toEqual(['a', 'b']);
    expect(pickWeeklyRoots(['a', 'b'], { a: 'junk', b: '2026-10-10T00:00:00Z' }, 2)).toEqual(['a', 'b']);
    expect(pickWeeklyRoots(['a'], {}, 5)).toEqual(['a']);
    expect(pickWeeklyRoots(['a'], {}, 0)).toEqual([]);
  });
  it('actually rotates: a processed root moves to the back', () => {
    const last: Record<string, string> = {};
    const seen: string[] = [];
    for (let w = 0; w < 4; w++) {
      const pick = pickWeeklyRoots(['a', 'b', 'c'], last, 1)[0];
      seen.push(pick);
      last[pick] = new Date(2026, 9, 1 + w).toISOString();
    }
    expect(seen).toEqual(['a', 'b', 'c', 'a']);
  });
});

const node = (slug: string, parent: string | null, extra: Partial<TaxNode> = {}): TaxNode => ({
  id: `id-${slug}`, slug, name: slug, parentId: parent ? `id-${parent}` : null, depth: parent ? 1 : 0, distinctPublished: 0,
  hidden: false, hiddenReason: null, protected: false, childIds: [], ...extra,
});
const mk = (...ns: TaxNode[]): TaxTree => ({
  byId: new Map(ns.map((n) => [n.id, n])), bySlug: new Map(ns.map((n) => [n.slug, n])), aliases: new Map(),
});
const L = (q: string, ...cats: string[]) => cats.map((c) => ({ question_id: q, category_id: `id-${c}` }));

describe('leaf questions and direct counts (chain-tagged links)', () => {
  // root > mid > leaf ; root2 ; general-knowledge (root) ; prot (child of root) protected ; under-prot
  const tree = mk(
    node('root', null), node('mid', 'root'), node('leaf', 'mid'), node('general-knowledge', null),
    node('prot', 'root', { protected: true }), node('under', 'prot'), node('sib', 'root'),
  );
  const links = [
    ...L('q1', 'leaf', 'mid', 'root', 'general-knowledge'), // leaf is leaf
    ...L('q2', 'mid', 'root'), // mid is leaf
    ...L('q3', 'root'), // root is leaf
    ...L('q4', 'mid', 'root', 'general-knowledge'),
    ...L('q5', 'prot', 'root'),
    ...L('q6', 'general-knowledge'),
    ...L('q7', 'leaf', 'sib', 'mid', 'root'), // two leaves
  ];
  it('leafQuestionIds excludes questions with a link below the category', () => {
    expect(leafQuestionIds(tree, 'id-mid', links)).toEqual(['q2', 'q4']); // q1, q7 go deeper
    expect(leafQuestionIds(tree, 'id-leaf', links)).toEqual(['q1', 'q7']);
    expect(leafQuestionIds(tree, 'id-root', links)).toEqual(['q3']);
    expect(leafQuestionIds(tree, 'id-nope', links)).toEqual([]);
  });
  it('directCounts counts leaves only', () => {
    const d = directCounts(tree, links);
    expect(d.get('id-leaf')).toBe(2);
    expect(d.get('id-mid')).toBe(2);
    expect(d.get('id-root')).toBe(1);
    expect(d.get('id-sib')).toBe(1);
    expect(d.get('id-general-knowledge')).toBe(3); // GK is a leaf of q1, q4, q6
  });
  const now = new Date('2026-10-29T12:00:00Z');
  it('selects by direct count, excluding roots, GK, protected (and under), hidden, empty', () => {
    const d = directCounts(tree, links);
    expect(pickRehomeCategories(tree, d, {}, 10, now)).toEqual(['leaf', 'mid', 'sib']);
    expect(pickRehomeCategories(tree, d, {}, 2, now)).toEqual(['leaf', 'mid']);
  });
  it('subtree-heavy parents do not outrank by their chain-tagged count', () => {
    const d = new Map([['id-mid', 1], ['id-leaf', 5]]);
    expect(pickRehomeCategories(tree, d, {}, 1, now)).toEqual(['leaf']);
  });
  it('28-day cooldown comes from the persisted state', () => {
    const d = directCounts(tree, links);
    const state = { leaf: '2026-10-20T00:00:00Z', mid: '2026-08-01T00:00:00Z' };
    expect(pickRehomeCategories(tree, d, state, 2, now)).toEqual(['mid', 'sib']);
  });
});
