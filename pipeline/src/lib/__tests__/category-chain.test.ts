// Wave 0 — RED scaffold for Phase 999.22.
// `expandSlugsToChain` does not exist yet — Wave 1 adds it in src/lib/category-chain.ts.
// Expected failure mode: "Cannot find module '../category-chain'".
//
// Contract: given a slug→parent_slug map and a list of leaf slugs, return the
// deduplicated set of slugs covering each leaf and all its ancestors up to root.
// Used by the chain-tagging calibrator to know which qc rows to emit per question.

import { describe, it, expect } from 'vitest';
import { expandSlugsToChain } from '../category-chain';

describe('expandSlugsToChain', () => {
  // Tree fixture (parent map). null parent = root.
  const tree = new Map<string, string | null>([
    ['gaming', null],
    ['video-game-franchises', 'gaming'],
    ['esports-and-competitive-gaming', 'gaming'],
    ['food-and-drink', null],
    ['wine-and-spirits', 'food-and-drink'],
    ['cocktails', 'wine-and-spirits'], // 3-deep chain
    ['general-knowledge', null],
    ['orphan-no-parent-listed', undefined as unknown as string | null], // simulate missing entry
  ]);

  it('returns leaf + parent for a 2-deep chain', () => {
    const out = expandSlugsToChain(tree, ['video-game-franchises']);
    expect(out.sort()).toEqual(['gaming', 'video-game-franchises'].sort());
  });

  it('returns full 3-deep chain', () => {
    const out = expandSlugsToChain(tree, ['cocktails']);
    expect(out.sort()).toEqual(['cocktails', 'food-and-drink', 'wine-and-spirits'].sort());
  });

  it('returns root-only when slug is itself a root', () => {
    const out = expandSlugsToChain(tree, ['gaming']);
    expect(out).toEqual(['gaming']);
  });

  it('deduplicates when multiple inputs share an ancestor', () => {
    const out = expandSlugsToChain(tree, [
      'video-game-franchises',
      'esports-and-competitive-gaming',
    ]);
    // Both share 'gaming' root — collapse.
    expect(out.sort()).toEqual(
      ['video-game-franchises', 'esports-and-competitive-gaming', 'gaming'].sort(),
    );
  });

  it('returns empty for empty input', () => {
    expect(expandSlugsToChain(tree, [])).toEqual([]);
  });

  it('falls back to slug-as-is when slug missing from tree (graceful)', () => {
    const out = expandSlugsToChain(tree, ['unknown-slug']);
    expect(out).toEqual(['unknown-slug']);
  });

  it('handles slug with missing parent entry by treating as root', () => {
    // Defensive: tree fetch may have race; treat unknown-parent slug as root.
    const out = expandSlugsToChain(tree, ['orphan-no-parent-listed']);
    expect(out).toEqual(['orphan-no-parent-listed']);
  });
});
