import { describe, it, expect } from 'vitest';
import { findUncalibrated, SCORED_LOOKUP_CHUNK } from '../calibrator.js';

// Fake PostgREST: questions paged by range(), question_categories looked up by in().
// An in() over more ids than PostgREST accepts returns an error, as the real one did
// (2026-10-30: one in() over a 1000-id page -> "Bad Request").
function fake(total: number, scored: Set<string>, opts: { maxIn?: number } = {}) {
  const all = Array.from({ length: total }, (_, i) => ({ id: `q${i}`, question_text: 'Q', correct_answer: 'A', distractors: [], status: 'published' }));
  const calls = { inSizes: [] as number[] };
  const client = {
    from: (t: string) => {
      let lo = 0; let hi = Infinity; let ids: string[] = [];
      const q: Record<string, unknown> = {};
      q.select = () => q; q.or = () => q; q.order = () => q;
      q.range = (a: number, b: number) => { lo = a; hi = b; return q; };
      q.in = (_c: string, v: string[]) => { ids = v; return q; };
      q.then = (r: (v: unknown) => void) => {
        if (t === 'questions') return r({ data: all.slice(lo, Math.min(hi + 1, lo + 1000)), error: null });
        calls.inSizes.push(ids.length);
        if (ids.length > (opts.maxIn ?? 150)) return r({ data: null, error: { message: 'Bad Request' } });
        return r({ data: ids.filter((id) => scored.has(id)).map((question_id) => ({ question_id })), error: null });
      };
      return q;
    },
  };
  return { client: client as never, calls };
}

describe('findUncalibrated', () => {
  it('skips already-scored questions (the bug: a rejected in() made all look unscored)', async () => {
    const scored = new Set(Array.from({ length: 990 }, (_, i) => `q${i}`));
    const { client, calls } = fake(1000, scored);
    const out = await findUncalibrated(client, 200);
    expect(out.map((q) => q.id)).toEqual(Array.from({ length: 10 }, (_, i) => `q${990 + i}`));
    expect(Math.max(...calls.inSizes)).toBeLessThanOrEqual(SCORED_LOOKUP_CHUNK);
  });

  it('pages past the first 1000 candidates', async () => {
    const scored = new Set(Array.from({ length: 2500 }, (_, i) => `q${i}`));
    const { client } = fake(2600, scored);
    const out = await findUncalibrated(client, 200);
    expect(out).toHaveLength(100);
    expect(out[0].id).toBe('q2500');
  });

  it('stops at the wanted count', async () => {
    const { client } = fake(3000, new Set());
    expect(await findUncalibrated(client, 200)).toHaveLength(200);
  });

  it('throws on a lookup error instead of treating it as "nothing scored"', async () => {
    const { client } = fake(500, new Set(), { maxIn: 10 });
    await expect(findUncalibrated(client, 200)).rejects.toThrow('scored lookup failed');
  });
});
