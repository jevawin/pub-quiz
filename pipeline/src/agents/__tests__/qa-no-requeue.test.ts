import { describe, it, expect, vi } from 'vitest';

const state = vi.hoisted(() => ({ isCalls: [] as Array<[string, unknown]> }));

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseClient: () => ({
    from: () => ({
      select: () => {
        const q: Record<string, unknown> = {};
        q.eq = () => q;
        q.gte = () => q;
        q.is = (col: string, v: unknown) => { state.isCalls.push([col, v]); return q; };
        q.then = (res: (v: unknown) => void) => res({ data: [], error: null });
        return q;
      },
    }),
  }),
}));

import { runQaAgent } from '../qa.js';

describe('QA agent selection', () => {
  it('skips questions that already passed QA (score-2 questions stay verified, and were re-checked every cycle)', async () => {
    await runQaAgent({ supabaseUrl: 'u', supabaseServiceRoleKey: 'k' } as never, {} as never, {} as never);
    expect(state.isCalls).toContainEqual(['qa_passed_at', null]);
  });
});
