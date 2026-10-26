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
  const questions: any = { select: () => questions, or: () => questions, limit: () => Promise.resolve({
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
