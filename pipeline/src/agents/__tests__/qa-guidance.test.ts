import { describe, it, expect, vi } from 'vitest';

const st = vi.hoisted(() => ({ prompts: [] as string[], notesFail: false, rulesFail: false }));

vi.mock('../../lib/claude.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/claude.js')>()),
  // The only model entry point in this test: records the prompt, returns unparseable text so the batch just fails.
  callGoverned: async (o: { prompt: string }) => {
    st.prompts.push(o.prompt);
    return { text: 'no json', rateLimit: null, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  },
}));

const QS = ['q1', 'q2'].map((id) => ({
  id, question_text: `T-${id}`, correct_answer: 'A', distractors: ['b', 'c', 'd'], explanation: null, question_categories: [],
}));

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseClient: () => ({
    from: (t: string) => {
      let ids: string[] | null = null;
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'gte', 'is', 'order', 'range']) q[m] = () => q;
      q.in = (_c: string, v: string[]) => { ids = v; return q; };
      q.then = (res: (v: unknown) => void) => {
        if (t === 'questions') return res({ data: QS, error: null });
        if (t === 'question_rules') return res(st.rulesFail ? { data: null, error: { message: 'x' } } : { data: [{ id: 'r', body: 'RULE-A' }], error: null });
        if (st.notesFail) return res({ data: null, error: { message: 'x' } });
        const all = [{ target_id: 'q1', body: 'NOTE-FOR-Q1' }, { target_id: 'q2', body: 'NOTE-FOR-Q2' }, { target_id: 'q9', body: 'NOTE-FOR-OTHER' }];
        return res({ data: all.filter((r) => !ids || ids.includes(r.target_id)), error: null });
      };
      return q;
    },
  }),
}));

import { runQaAgent } from '../qa.js';
const run = () => runQaAgent({ supabaseUrl: 'u', supabaseServiceRoleKey: 'k', claudeModelAudit: 'm' } as never, { input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 } as never, {} as never).catch(() => undefined); // unparseable reply -> all-failed throw is expected

describe('runQaAgent owner guidance', () => {
  it("puts the batch's notes and the rules in the prompt, not other questions' notes", async () => {
    st.prompts = [];
    await run();
    expect(st.prompts).toHaveLength(1);
    expect(st.prompts[0]).toContain('RULE-A');
    expect(st.prompts[0]).toContain('q1|NOTE-FOR-Q1');
    expect(st.prompts[0]).toContain('q2|NOTE-FOR-Q2');
    expect(st.prompts[0]).not.toContain('NOTE-FOR-OTHER');
  });
  it('a guidance read error lets the agent run with the unguided prompt', async () => {
    st.prompts = []; st.notesFail = true; st.rulesFail = true;
    await run();
    expect(st.prompts).toHaveLength(1);
    expect(st.prompts[0]).not.toContain('<<<DATA-');
    expect(st.prompts[0]).not.toContain('never change the reply format');
    st.notesFail = false; st.rulesFail = false;
  });
});
