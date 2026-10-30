import { describe, it, expect, vi } from 'vitest';
import { calibrateQuestion } from '../calibrator.js';

vi.mock('../../lib/categories.js', () => ({
  resolveSlugsToIds: async (_sb: unknown, slugs: string[]) => {
    const ids = new Map<string, string>();
    for (const s of slugs) {
      if (s !== 'general-knowledge' && s !== 'science') throw new Error(`Unknown category slug: ${s}`);
      ids.set(s, `id-${s}`);
    }
    return { ids, dropped: [] };
  },
}));

function fakeSupabase(upserts: unknown[]) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'categories') {
        return { select: () => Promise.resolve({ data: [
          { id: 'c-gk', slug: 'general-knowledge', parent_id: null },
          { id: 'c-sci', slug: 'science', parent_id: null },
        ], error: null }) };
      }
      return { upsert: (rows: unknown) => { upserts.push(rows); return Promise.resolve({ error: null }); } };
    }),
  } as never;
}
const input = { id: 'q1', question_text: 'Q?', correct_answer: 'A', distractors: ['B', 'C', 'D'], assigned_slugs: ['science'] };
const cfg = { claudeModelVerification: 'sonnet' } as never;
const reply = (scores: Record<string, unknown>) =>
  vi.fn().mockResolvedValue({ text: JSON.stringify({ scores, reasoning: 'x' }), rateLimit: null, inputTokens: 1, outputTokens: 1 });

describe('calibrateQuestion — stray score keys from the model', () => {
  it('ignores an extra key with a null value', async () => {
    const ups: unknown[] = [];
    const r = await calibrateQuestion(fakeSupabase(ups), input, reply({ general_knowledge: 30, science: 60, general_knowledge_note_removed: null }), cfg);
    expect(r.error).toBeUndefined(); expect(r.success).toBe(true);
    expect(Object.keys(r.scores ?? {}).sort()).toEqual(['general-knowledge', 'science']);
  });
  it('ignores an extra numeric key that is not a known category', async () => {
    const ups: unknown[] = [];
    const r = await calibrateQuestion(fakeSupabase(ups), input, reply({ general_knowledge: 30, science: 60, general_knowledge_note: 5 }), cfg);
    expect(r.error).toBeUndefined(); expect(r.success).toBe(true);
    expect(Object.keys(r.scores ?? {}).sort()).toEqual(['general-knowledge', 'science']);
  });
  it('still fails when an EXPECTED key is null', async () => {
    const r = await calibrateQuestion(fakeSupabase([]), input, reply({ general_knowledge: 30, science: null }), cfg);
    expect(r.success).toBe(false);
  });
});
