import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({ active: 0, peak: 0, calls: 0, stopAfter: Infinity }));

vi.mock('../../lib/supabase.js', () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ id: `q${i}`, question_text: 'Q', correct_answer: 'A', distractors: ['b', 'c', 'd'], status: 'published' }));
  const chain = (data: unknown) => { const q: Record<string, unknown> = {}; for (const m of ['or', 'limit', 'in', 'eq']) q[m] = () => q; q.then = (r: (v: unknown) => void) => r({ data, error: null }); return q; };
  return { createSupabaseClient: () => ({ from: (t: string) => ({
    select: () => chain(t === 'questions' ? rows : []),
    upsert: () => Promise.resolve({ error: null }),
  }) }) };
});
vi.mock('../../lib/categories.js', () => ({ resolveSlugsToIds: async (_s: unknown, slugs: string[]) => ({ ids: new Map(slugs.map((s) => [s, `id-${s}`])), dropped: [] }) }));
vi.mock('../../lib/claude.js', async (orig) => {
  const { UsageStopError } = await import('../../lib/usage.js');
  return {
    ...(await orig<typeof import('../../lib/claude.js')>()),
    callGoverned: async () => {
      st.calls++;
      if (st.calls > st.stopAfter) throw new UsageStopError('five-hour window');
      st.active++; st.peak = Math.max(st.peak, st.active);
      await new Promise((r) => setTimeout(r, 5));
      st.active--;
      return { text: JSON.stringify({ scores: { general_knowledge: 50 }, reasoning: 'x' }), rateLimit: null, inputTokens: 1, outputTokens: 1, costUsd: 0 };
    },
  };
});

import { runCalibratorAgent, CALIBRATOR_CONCURRENCY } from '../calibrator.js';
const cfg = { supabaseUrl: 'u', supabaseServiceRoleKey: 'k', claudeModelVerification: 'haiku' } as never;

beforeEach(() => { st.active = 0; st.peak = 0; st.calls = 0; st.stopAfter = Infinity; });

describe('runCalibratorAgent concurrency', () => {
  it('calibrates every question, overlapping calls up to the limit', async () => {
    const r = await runCalibratorAgent(cfg, {} as never, {} as never);
    expect(r.processed).toBe(9);
    expect(st.peak).toBe(CALIBRATOR_CONCURRENCY);
    expect(CALIBRATOR_CONCURRENCY).toBe(3);
  });
  it('a usage stop ends the run: rethrown, and no calls start after it', async () => {
    st.stopAfter = 4;
    await expect(runCalibratorAgent(cfg, {} as never, {} as never)).rejects.toThrow('five-hour window');
    expect(st.calls).toBeLessThan(9 + 3);
    expect(st.calls).toBeLessThanOrEqual(4 + CALIBRATOR_CONCURRENCY);
  });
});
