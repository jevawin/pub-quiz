import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/supabase.js', () => ({ createSupabaseClient: vi.fn() }));
vi.mock('../../lib/claude.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/claude.js')>();
  return { ...actual, callGoverned: vi.fn() };
});
vi.mock('../../lib/logger.js', () => ({ log: vi.fn() }));

import { createSupabaseClient } from '../../lib/supabase.js';
import { callGoverned } from '../../lib/claude.js';
import { UsageStopError } from '../../lib/usage.js';
import { calibrateQuestion, runCalibratorAgent } from '../calibrator.js';
import type { PipelineConfig } from '../../lib/config.js';

const input = {
  id: 'q1', question_text: 'Q?', correct_answer: 'A', distractors: ['B', 'C', 'D'], assigned_slugs: ['science'],
};

function fakeSupabase() {
  const questions: any = { select: () => questions, or: () => questions, order: () => questions, range: () => Promise.resolve({
    data: [{ id: 'q1', question_text: 'Q?', correct_answer: 'A', distractors: ['B', 'C', 'D'], status: 'pending' }],
    error: null,
  }) };
  const qc: any = {
    select: () => qc,
    in: () => Promise.resolve({ data: [], error: null }),
    eq: () => Promise.resolve({ data: [], error: null }),
  };
  return { from: (t: string) => (t === 'questions' ? questions : qc) };
}

describe('calibrator usage stops', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('calibrateQuestion rethrows UsageStopError from the call', async () => {
    const call = vi.fn().mockRejectedValue(new UsageStopError('budget'));
    await expect(
      calibrateQuestion({} as never, input, call, { claudeModelVerification: 'sonnet' }),
    ).rejects.toBeInstanceOf(UsageStopError);
  });

  it('calibrateQuestion still reports other call errors as success=false', async () => {
    const call = vi.fn().mockRejectedValue(new Error('boom'));
    const out = await calibrateQuestion({} as never, input, call, { claudeModelVerification: 'sonnet' });
    expect(out).toEqual({ success: false, error: 'boom' });
  });

  it('runCalibratorAgent propagates UsageStopError out of the per-question catch', async () => {
    vi.mocked(createSupabaseClient).mockReturnValue(fakeSupabase() as never);
    vi.mocked(callGoverned).mockRejectedValue(new UsageStopError('budget'));
    const config = { supabaseUrl: 'u', supabaseServiceRoleKey: 'k', claudeModelVerification: 'sonnet' } as PipelineConfig;
    const acc = { input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 };
    await expect(runCalibratorAgent(config, acc, {} as never)).rejects.toBeInstanceOf(UsageStopError);
    const [, passedAcc] = vi.mocked(callGoverned).mock.calls[0];
    expect(passedAcc).toBe(acc);
  });
});

describe('calibrateQuestion upsert dedupe', () => {
  it('sends one row per category id when an alias and its survivor are both scored', async () => {
    const upserts: any[][] = [];
    const sb: any = {
      from: (t: string) => {
        const c: any = {
          select: () => c,
          in: () => c,
          upsert: (rows: any[]) => (upserts.push(rows), Promise.resolve({ error: null })),
          then: (res: (v: unknown) => void) => Promise.resolve({
            data: t === 'category_aliases'
              ? [{ old_slug: 'science-old', category_id: 'c-sci' }]
              : [{ id: 'c-sci', slug: 'science', hidden_reason: null }, { id: 'c-gk', slug: 'general-knowledge', hidden_reason: null }],
            error: null,
          }).then(res),
        };
        return c;
      },
    };
    const call = vi.fn().mockResolvedValue({
      text: JSON.stringify({ scores: { science_old: 11, science: 60, general_knowledge: 30 }, reasoning: 'r' }),
    });
    const out = await calibrateQuestion(sb, { ...input, assigned_slugs: ['science-old', 'science'] }, call, { claudeModelVerification: 'sonnet' });
    expect(out.success).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].map((r) => r.category_id).sort()).toEqual(['c-gk', 'c-sci']);
    expect(upserts[0].find((r) => r.category_id === 'c-sci').estimate_score).toBe(11);
  });
});
