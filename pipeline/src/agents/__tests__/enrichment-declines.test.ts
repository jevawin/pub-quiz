import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  isCalls: [] as Array<[string, unknown]>,
  updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  reply: '' as string,
  wiki: 'article text' as string | null,
}));

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseClient: () => ({
    from: () => ({
      select: () => {
        const q: Record<string, unknown> = {};
        q.eq = () => q;
        q.is = (col: string, v: unknown) => { state.isCalls.push([col, v]); return q; };
        q.limit = () => Promise.resolve({ data: [{ id: 'q1', question_text: 'Q?', correct_answer: 'A' }], error: null });
        return q;
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (_c: string, id: string) => { state.updates.push({ id, patch }); return Promise.resolve({ error: null }); },
      }),
    }),
  }),
}));
vi.mock('../../lib/wikipedia.js', () => ({
  searchArticles: async () => (state.wiki ? ['T'] : []),
  getArticleText: async () => state.wiki,
}));
vi.mock('../../lib/claude.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/claude.js')>()),
  callGoverned: async () => ({ text: state.reply }),
}));

import { runEnrichmentAgent } from '../enrichment.js';

const cfg = { supabaseUrl: 'u', supabaseServiceRoleKey: 'k', wikipediaUserAgent: 'ua', wikipediaMaxContentLength: 100, claudeModelVerification: 'haiku' } as never;
const run = () => runEnrichmentAgent(cfg, {} as never, {} as never);

beforeEach(() => { state.isCalls = []; state.updates = []; state.wiki = 'article text'; });

describe('enrichment: a deliberate decline must not be retried forever', () => {
  it('only selects questions that have not been attempted yet', async () => {
    state.reply = '{"fun_fact": null}';
    await run();
    expect(state.isCalls).toContainEqual(['enriched_at', null]);
  });
  it('stamps enriched_at (no fun_fact) when the model declines with null, and counts it skipped', async () => {
    state.reply = '{"fun_fact": null}';
    const r = await run();
    expect(r).toEqual({ enriched: 0, skipped: 1, failed: 0 });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].patch).toHaveProperty('enriched_at');
    expect(state.updates[0].patch).not.toHaveProperty('fun_fact');
  });
  it('stamps enriched_at when there is no Wikipedia source', async () => {
    state.wiki = null;
    const r = await run();
    expect(r.skipped).toBe(1);
    expect(state.updates[0]?.patch).toHaveProperty('enriched_at');
  });
  it('still counts malformed output as failed and does NOT stamp it (retry later)', async () => {
    state.reply = 'not json at all';
    const r = await run();
    expect(r).toEqual({ enriched: 0, skipped: 0, failed: 1 });
    expect(state.updates).toHaveLength(0);
  });
  it('writes the fun fact on success', async () => {
    state.reply = '{"fun_fact": "A genuinely surprising fact about it."}';
    const r = await run();
    expect(r.enriched).toBe(1);
    expect(state.updates[0].patch).toMatchObject({ fun_fact: 'A genuinely surprising fact about it.' });
  });
});
