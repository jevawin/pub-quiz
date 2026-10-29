import { describe, it, expect } from 'vitest';
import { extractJson } from '../claude.js';
import { reconcileScoreKeys } from '../slug-converter.js';

describe('extractJson', () => {
  it('ignores prose after the JSON object', () => {
    const t = '{ "scores": { "a": 1 }, "reasoning": "x {y}" }\n\nHope that helps.';
    expect(JSON.parse(extractJson(t)).scores.a).toBe(1);
  });
  it('still unwraps fences', () => {
    expect(JSON.parse(extractJson('```json\n{"a":1}\n```'))).toEqual({ a: 1 });
  });
});

describe('reconcileScoreKeys', () => {
  it('maps close variants onto the expected key, exact keys win', () => {
    const out = reconcileScoreKeys({ '1990s': 40, 'General-Knowledge': 50, geography: 9 }, ['the-1990s', 'general-knowledge', 'geography']);
    expect(out['the_1990s']).toBe(40);
    expect(out['general_knowledge']).toBe(50);
    expect(out['geography']).toBe(9);
  });
  it('leaves a genuinely missing key missing', () => {
    expect('science' in reconcileScoreKeys({ geography: 1 }, ['science'])).toBe(false);
  });
});
