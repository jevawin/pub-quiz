import { describe, it, expect } from 'vitest';
import { jsonKeyToSlug, slugToJsonKey } from '../slug-converter';

// Wave 0 — RED scaffolds.
// slug-converter.ts does not exist yet — Wave 2 creates it.
// Expected failure mode: "Cannot find module '../slug-converter'"

describe('slug-converter', () => {
  it('jsonKeyToSlug converts underscores to hyphens', () => {
    expect(jsonKeyToSlug('science_and_nature')).toBe('science-and-nature');
  });

  it('slugToJsonKey converts hyphens to underscores', () => {
    expect(slugToJsonKey('science-and-nature')).toBe('science_and_nature');
  });

  it('round-trips cleanly', () => {
    expect(slugToJsonKey(jsonKeyToSlug('a_b_c'))).toBe('a_b_c');
  });

  it('handles general_knowledge canonical form', () => {
    expect(jsonKeyToSlug('general_knowledge')).toBe('general-knowledge');
  });

  it('handles single-word slugs', () => {
    expect(jsonKeyToSlug('geography')).toBe('geography');
  });
});
