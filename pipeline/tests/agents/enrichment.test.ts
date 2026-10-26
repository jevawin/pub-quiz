import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineConfig } from '../../src/lib/config.js';
import type { TokenAccumulator } from '../../src/lib/claude.js';
import { UsageStopError } from '../../src/lib/usage.js';

vi.mock('../../src/lib/supabase.js', () => ({ createSupabaseClient: vi.fn() }));
vi.mock('../../src/lib/claude.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/claude.js')>();
  return { ...actual, callGoverned: vi.fn() };
});
vi.mock('../../src/lib/logger.js', () => ({ log: vi.fn() }));
vi.mock('../../src/lib/wikipedia.js', () => ({
  searchArticles: vi.fn(),
  getArticleText: vi.fn(),
}));

import { createSupabaseClient } from '../../src/lib/supabase.js';
import { callGoverned } from '../../src/lib/claude.js';
import { searchArticles, getArticleText } from '../../src/lib/wikipedia.js';
import { runEnrichmentAgent } from '../../src/agents/enrichment.js';

const mockGov = {} as never;

function makeConfig(): PipelineConfig {
  return {
    supabaseUrl: 'https://test.supabase.co',
    supabaseServiceRoleKey: 'k',
    categoryBatchSize: 5,
    knowledgeBatchSize: 10,
    questionsBatchSize: 20,
    claudeModelGeneration: 'sonnet',
    claudeModelVerification: 'sonnet',
    claudeModelAudit: 'opus',
    wikipediaUserAgent: 'T/1.0',
    wikipediaMaxContentLength: 3000,
    relevanceThreshold: 0.6,
    enableCategoryAgent: false,
    staleRunMs: 1,
  };
}

const acc = (): TokenAccumulator => ({ input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 });

function supabaseWith(questions: unknown[]) {
  const updates: unknown[] = [];
  const query: any = {
    select: () => query,
    eq: () => query,
    is: () => query,
    limit: () => Promise.resolve({ data: questions, error: null }),
    update: (d: unknown) => { updates.push(d); return { eq: () => Promise.resolve({ error: null }) }; },
  };
  return { client: { from: () => query }, updates };
}

const Q = { id: 'q1', question_text: 'Capital of France?', correct_answer: 'Paris' };

describe('Enrichment Agent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(searchArticles).mockResolvedValue(['Paris']);
    vi.mocked(getArticleText).mockResolvedValue('Paris is the capital of France.');
  });

  it('writes the fun fact returned through callGoverned', async () => {
    const { client, updates } = supabaseWith([Q]);
    vi.mocked(createSupabaseClient).mockReturnValue(client as never);
    vi.mocked(callGoverned).mockResolvedValue({
      text: JSON.stringify({ fun_fact: 'The Eiffel Tower grows in summer heat.' }),
      rateLimit: null, inputTokens: 1, outputTokens: 1, costUsd: 0,
    });
    const r = await runEnrichmentAgent(makeConfig(), acc(), mockGov);
    expect(r.enriched).toBe(1);
    expect(updates).toHaveLength(1);
    expect(vi.mocked(callGoverned).mock.calls[0][0].model).toBe('sonnet');
  });

  it('UsageStopError propagates out of the per-question catch', async () => {
    const { client } = supabaseWith([Q]);
    vi.mocked(createSupabaseClient).mockReturnValue(client as never);
    vi.mocked(callGoverned).mockRejectedValue(new UsageStopError('budget'));
    await expect(runEnrichmentAgent(makeConfig(), acc(), mockGov)).rejects.toBeInstanceOf(UsageStopError);
  });

  it('other errors are counted as failures, not thrown', async () => {
    const { client } = supabaseWith([Q]);
    vi.mocked(createSupabaseClient).mockReturnValue(client as never);
    vi.mocked(callGoverned).mockRejectedValue(new Error('boom'));
    const r = await runEnrichmentAgent(makeConfig(), acc(), mockGov);
    expect(r.failed).toBe(1);
  });
});
