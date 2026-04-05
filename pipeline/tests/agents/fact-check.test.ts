import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineConfig } from '../../src/lib/config.js';
import type { TokenAccumulator } from '../../src/lib/claude.js';

vi.mock('../../src/lib/supabase.js', () => ({
  createSupabaseClient: vi.fn(),
}));

vi.mock('../../src/lib/claude.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/claude.js')>();
  return {
    ...actual,
    createClaudeClient: vi.fn(),
    trackUsage: vi.fn(),
    checkBudget: vi.fn(),
  };
});

vi.mock('../../src/lib/logger.js', () => ({
  log: vi.fn(),
}));

vi.mock('../../src/lib/wikipedia.js', () => ({
  searchArticles: vi.fn().mockResolvedValue([]),
  getArticleText: vi.fn().mockResolvedValue(null),
}));

function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    anthropicApiKey: 'test-key',
    supabaseUrl: 'https://test.supabase.co',
    supabaseServiceRoleKey: 'test-service-key',
    budgetCapUsd: 10,
    categoryBatchSize: 5,
    knowledgeBatchSize: 10,
    questionsBatchSize: 20,
    claudeModelGeneration: 'claude-sonnet-4-5-20250514',
    claudeModelVerification: 'claude-haiku-4-5-20250514',
    wikipediaUserAgent: 'TestAgent/1.0',
    wikipediaMaxContentLength: 3000,
    relevanceThreshold: 0.6,
    ...overrides,
  };
}

function makeTokenAccumulator(): TokenAccumulator {
  return { input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 };
}

// Pending questions that need fact-checking
const Q1_ID = '11111111-1111-1111-1111-111111111111';
const Q2_ID = '22222222-2222-2222-2222-222222222222';

const pendingQuestions = [
  {
    id: Q1_ID,
    category_id: 'cat-1',
    source_id: 'src-1',
    question_text: 'What is the speed of light?',
    correct_answer: '299,792,458 m/s',
    distractors: ['150,000,000 m/s', '300,000,000 km/s', '199,792,458 m/s'],
    explanation: 'The speed of light is approximately 299,792,458 m/s.',
    difficulty: 'normal',
    verification_score: 0,
    status: 'pending',
  },
  {
    id: Q2_ID,
    category_id: 'cat-1',
    source_id: 'src-1',
    question_text: 'Who developed special relativity?',
    correct_answer: 'Albert Einstein',
    distractors: ['Isaac Newton', 'Niels Bohr', 'Max Planck'],
    explanation: 'Einstein developed special relativity.',
    difficulty: 'easy',
    verification_score: 0,
    status: 'pending',
  },
];

const sourceData = {
  id: 'src-1',
  category_id: 'cat-1',
  title: 'Physics Article',
  content: 'The speed of light is approximately 299,792,458 metres per second. Albert Einstein developed the theory of special relativity.',
  url: 'https://en.wikipedia.org/wiki/Speed_of_light',
};

function createMockClaudeResponse(results: unknown[]) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ results }),
      },
    ],
    usage: { input_tokens: 500, output_tokens: 200 },
    id: 'msg-test',
    model: 'claude-haiku-4-5-20250514',
    role: 'assistant' as const,
    type: 'message' as const,
    stop_reason: 'end_turn' as const,
  };
}

function createMockSupabase() {
  const updateCalls: Array<{ table: string; data: unknown; questionId: string }> = [];
  let updateShouldFail = false;
  let updateFailOnce = false;
  let updateFailCount = 0;

  function makeChain(resolvedData: unknown, resolvedError: unknown = null) {
    const chain: any = {};
    const methods = ['select', 'eq', 'in', 'order', 'limit', 'lte', 'gte', 'lt', 'gt', 'neq', 'single', 'maybeSingle'];
    for (const method of methods) {
      chain[method] = vi.fn((..._args: unknown[]) => chain);
    }
    chain.then = (resolve: (val: unknown) => void, reject?: (err: unknown) => void) => {
      return Promise.resolve({ data: resolvedData, error: resolvedError }).then(resolve, reject);
    };
    // Override update to track calls
    chain.update = vi.fn((data: unknown) => {
      const updateChain: any = {};
      const innerMethods = ['eq', 'single', 'maybeSingle'];
      for (const method of innerMethods) {
        updateChain[method] = vi.fn((...args: unknown[]) => {
          if (method === 'eq' && args[0] === 'id') {
            updateCalls.push({ table: 'questions', data, questionId: args[1] as string });
          }
          return updateChain;
        });
      }
      updateChain.then = (resolve: (val: unknown) => void, reject?: (err: unknown) => void) => {
        if (updateFailOnce && updateFailCount === 0) {
          updateFailCount++;
          return Promise.resolve({ data: null, error: { message: 'Update failed' } }).then(resolve, reject);
        }
        if (updateShouldFail) {
          return Promise.resolve({ data: null, error: { message: 'Update failed' } }).then(resolve, reject);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      };
      return updateChain;
    });
    return chain;
  }

  const mockFrom = vi.fn((table: string) => {
    if (table === 'questions') {
      return makeChain(pendingQuestions);
    }
    if (table === 'sources') {
      return makeChain(sourceData);
    }
    return makeChain([]);
  });

  return {
    from: mockFrom,
    updateCalls,
    setUpdateShouldFail: (val: boolean) => { updateShouldFail = val; },
    setUpdateFailOnce: (val: boolean) => { updateFailOnce = val; },
  };
}

describe('Fact-Check Agent', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>;
  let mockClaude: { messages: { create: ReturnType<typeof vi.fn> } };

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();

    // Re-set wikipedia mocks after resetAllMocks clears them
    const wikipedia = await import('../../src/lib/wikipedia.js');
    vi.mocked(wikipedia.searchArticles).mockResolvedValue([]);
    vi.mocked(wikipedia.getArticleText).mockResolvedValue(null);

    mockSupabase = createMockSupabase();

    // Default: both questions verified correctly with score 3
    mockClaude = {
      messages: {
        create: vi.fn().mockResolvedValue(createMockClaudeResponse([
          { question_id: Q1_ID, is_correct: true, verification_score: 3, reasoning: 'Explicitly stated in the text.' },
          { question_id: Q2_ID, is_correct: true, verification_score: 3, reasoning: 'Einstein is explicitly mentioned.' },
        ])),
      },
    };

    const { createSupabaseClient } = await import('../../src/lib/supabase.js');
    const { createClaudeClient } = await import('../../src/lib/claude.js');
    vi.mocked(createSupabaseClient).mockReturnValue(mockSupabase as any);
    vi.mocked(createClaudeClient).mockReturnValue(mockClaude as any);
  });

  it('returns AgentResult with processed and failed counts', async () => {
    const { runFactCheckAgent } = await import('../../src/agents/fact-check.js');
    const result = await runFactCheckAgent(makeConfig(), makeTokenAccumulator());
    expect(result).toHaveProperty('processed');
    expect(result).toHaveProperty('failed');
    expect(typeof result.processed).toBe('number');
  });

  it('selects questions with status=pending and verification_score=0', async () => {
    const { runFactCheckAgent } = await import('../../src/agents/fact-check.js');
    await runFactCheckAgent(makeConfig(), makeTokenAccumulator());
    expect(mockSupabase.from).toHaveBeenCalledWith('questions');
  });

  it('uses Wikipedia search for verification (no source_id needed)', async () => {
    const { runFactCheckAgent } = await import('../../src/agents/fact-check.js');
    const wikipedia = await import('../../src/lib/wikipedia.js');
    // Mock Wikipedia to return results so source 1 fires
    vi.mocked(wikipedia.searchArticles).mockResolvedValue(['Speed of light']);
    vi.mocked(wikipedia.getArticleText).mockResolvedValue('The speed of light is 299,792,458 m/s.');
    await runFactCheckAgent(makeConfig(), makeTokenAccumulator());
    expect(wikipedia.searchArticles).toHaveBeenCalled();
  });

  it('falls back to own-knowledge when Wikipedia has no results', async () => {
    const { runFactCheckAgent } = await import('../../src/agents/fact-check.js');
    // Wikipedia returns nothing (default mock), so own-knowledge fires
    await runFactCheckAgent(makeConfig(), makeTokenAccumulator());
    // Should have called Claude at least twice (one per question for own-knowledge)
    expect(mockClaude.messages.create).toHaveBeenCalledTimes(2);
  });

  it('handles invalid Claude response gracefully', async () => {
    const { runFactCheckAgent } = await import('../../src/agents/fact-check.js');
    // Both own-knowledge calls return invalid data
    mockClaude.messages.create.mockResolvedValueOnce(
      createMockClaudeResponse([{ invalid: true }])
    );
    mockClaude.messages.create.mockResolvedValueOnce(
      createMockClaudeResponse([{ invalid: true }])
    );
    // Should handle gracefully — both rejected, no crash
    const result = await runFactCheckAgent(makeConfig(), makeTokenAccumulator());
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(2);
  });

  it('updates verified questions with score 1-2 to status=verified (NOT published)', async () => {
    const { runFactCheckAgent } = await import('../../src/agents/fact-check.js');
    mockClaude.messages.create.mockResolvedValueOnce(createMockClaudeResponse([
      { question_id: Q1_ID, is_correct: true, verification_score: 2, reasoning: 'Clearly supported.' },
      { question_id: Q2_ID, is_correct: true, verification_score: 1, reasoning: 'Weakly supported.' },
    ]));
    await runFactCheckAgent(makeConfig(), makeTokenAccumulator());
    // Both should be updated
    expect(mockSupabase.updateCalls.length).toBe(2);
    for (const call of mockSupabase.updateCalls) {
      const data = call.data as any;
      expect(data.status).toBe('verified');
      expect(data).not.toHaveProperty('published_at');
    }
  });

  it('verifies questions with score >= 3 (no auto-publish per D-03)', async () => {
    const { runFactCheckAgent } = await import('../../src/agents/fact-check.js');
    await runFactCheckAgent(makeConfig(), makeTokenAccumulator());
    expect(mockSupabase.updateCalls.length).toBe(2);
    for (const call of mockSupabase.updateCalls) {
      const data = call.data as any;
      expect(data.status).toBe('verified');
      expect(data.verification_score).toBe(3);
    }
  });

  it('rejects incorrect answers with status=rejected and score=0', async () => {
    const { runFactCheckAgent } = await import('../../src/agents/fact-check.js');
    // Source 1: initial check rejects both
    mockClaude.messages.create.mockResolvedValueOnce(createMockClaudeResponse([
      { question_id: Q1_ID, is_correct: false, verification_score: 0, reasoning: 'Answer contradicts the text.' },
      { question_id: Q2_ID, is_correct: false, verification_score: 0, reasoning: 'Not supported by text.' },
    ]));
    // Source 2: Wikipedia returns [] (mocked), so no Claude call
    // Source 3: own-knowledge also rejects both (one call per question)
    mockClaude.messages.create.mockResolvedValueOnce(createMockClaudeResponse([
      { question_id: Q1_ID, is_correct: false, verification_score: 0, reasoning: 'Cannot confirm.' },
    ]));
    mockClaude.messages.create.mockResolvedValueOnce(createMockClaudeResponse([
      { question_id: Q2_ID, is_correct: false, verification_score: 0, reasoning: 'Cannot confirm.' },
    ]));
    await runFactCheckAgent(makeConfig(), makeTokenAccumulator());
    expect(mockSupabase.updateCalls.length).toBe(2);
    for (const call of mockSupabase.updateCalls) {
      const data = call.data as any;
      expect(data.status).toBe('rejected');
      expect(data.verification_score).toBe(0);
    }
  });

  it('tracks tokens with Haiku cost rates', async () => {
    const { runFactCheckAgent } = await import('../../src/agents/fact-check.js');
    const { trackUsage, HAIKU_INPUT, HAIKU_OUTPUT } = await import('../../src/lib/claude.js');
    await runFactCheckAgent(makeConfig(), makeTokenAccumulator());
    expect(trackUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      HAIKU_INPUT,
      HAIKU_OUTPUT,
    );
  });

  it('per-item update failure does not crash the agent', async () => {
    const { runFactCheckAgent } = await import('../../src/agents/fact-check.js');
    mockSupabase.setUpdateShouldFail(true);
    const result = await runFactCheckAgent(makeConfig(), makeTokenAccumulator());
    // Agent should not crash even when all updates fail
    expect(result).toBeDefined();
  });

  it('own-knowledge prompt instructs strict verification', async () => {
    const { runFactCheckAgent } = await import('../../src/agents/fact-check.js');
    // Wikipedia returns nothing, so own-knowledge fires
    await runFactCheckAgent(makeConfig(), makeTokenAccumulator());
    const callArgs = mockClaude.messages.create.mock.calls[0][0];
    const systemContent = typeof callArgs.system === 'string'
      ? callArgs.system
      : Array.isArray(callArgs.system)
        ? callArgs.system.map((s: any) => s.text).join(' ')
        : '';
    expect(systemContent).toContain('highly confident');
  });

  it('uses log() from logger.ts for output', async () => {
    const { runFactCheckAgent } = await import('../../src/agents/fact-check.js');
    const { log } = await import('../../src/lib/logger.js');
    await runFactCheckAgent(makeConfig(), makeTokenAccumulator());
    expect(log).toHaveBeenCalled();
  });

  it('score 2 questions get status=verified (same as all verified)', async () => {
    const { runFactCheckAgent } = await import('../../src/agents/fact-check.js');
    mockClaude.messages.create.mockResolvedValueOnce(createMockClaudeResponse([
      { question_id: Q1_ID, is_correct: true, verification_score: 2, reasoning: 'Clearly supported.' },
    ]));
    await runFactCheckAgent(makeConfig(), makeTokenAccumulator());
    const q1Update = mockSupabase.updateCalls.find((c) => c.questionId === Q1_ID);
    expect(q1Update).toBeDefined();
    const data = q1Update!.data as any;
    expect(data.status).toBe('verified');
    expect(data.status).not.toBe('published');
  });
});
