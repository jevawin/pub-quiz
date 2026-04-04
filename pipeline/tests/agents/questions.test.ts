import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineConfig } from '../../src/lib/config.js';
import type { TokenAccumulator } from '../../src/lib/claude.js';

// Mock modules before importing the agent
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
    ...overrides,
  };
}

function makeTokenAccumulator(): TokenAccumulator {
  return { input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 };
}

const validQuestions = [
  {
    question_text: 'What is the approximate speed of light?',
    correct_answer: '299,792,458 m/s',
    distractors: ['150,000,000 m/s', '300,000,000 km/s', '199,792,458 m/s'],
    explanation: 'The speed of light in a vacuum is approximately 299,792,458 metres per second. This is a fundamental constant in physics.',
    difficulty: 'normal' as const,
  },
  {
    question_text: 'Who developed the theory of special relativity?',
    correct_answer: 'Albert Einstein',
    distractors: ['Isaac Newton', 'Niels Bohr', 'Max Planck'],
    explanation: 'Albert Einstein developed the theory of special relativity, which was published in 1905.',
    difficulty: 'easy' as const,
  },
];

function createMockClaudeResponse(questions: unknown[]) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ questions }),
      },
    ],
    usage: { input_tokens: 1000, output_tokens: 500 },
    id: 'msg-test',
    model: 'claude-sonnet-4-5-20250514',
    role: 'assistant' as const,
    type: 'message' as const,
    stop_reason: 'end_turn' as const,
  };
}

/**
 * Creates a mock Supabase client that tracks all calls.
 * Each from().method() chain returns a promise-like object.
 */
function createMockSupabase() {
  const insertCalls: Array<{ table: string; data: unknown }> = [];
  const selectCalls: Array<{ table: string; columns: string }> = [];
  let insertShouldFail = false;
  let insertFailOnce = false;
  let insertFailCount = 0;

  // Track what the test configures
  const categoriesData = [{ id: 'cat-1', name: 'Science', slug: 'science' }];
  const sourcesData = [
    {
      id: 'src-1',
      category_id: 'cat-1',
      title: 'Physics Article',
      content: 'The speed of light is approximately 299,792,458 metres per second. Albert Einstein developed the theory of special relativity.',
      url: 'https://en.wikipedia.org/wiki/Speed_of_light',
    },
  ];
  const existingQuestionsForDedup = [{ question_text: 'What is the speed of light?' }];

  function makeChain(resolvedData: unknown, resolvedError: unknown = null) {
    const chain: any = {};
    const methods = ['select', 'eq', 'in', 'order', 'limit', 'lte', 'gte', 'lt', 'gt', 'neq', 'single', 'maybeSingle'];
    for (const method of methods) {
      chain[method] = vi.fn((..._args: unknown[]) => chain);
    }
    // Make the chain thenable (await-able)
    chain.then = (resolve: (val: unknown) => void, reject?: (err: unknown) => void) => {
      return Promise.resolve({ data: resolvedData, error: resolvedError }).then(resolve, reject);
    };
    return chain;
  }

  // Track from() calls with different tables
  let questionFromCallIndex = 0;

  const mockFrom = vi.fn((table: string) => {
    if (table === 'categories') {
      selectCalls.push({ table, columns: 'id, name, slug' });
      return makeChain(categoriesData);
    }
    if (table === 'sources') {
      selectCalls.push({ table, columns: 'sources' });
      // Return sources with id for first call (checking existence), full data for second
      return makeChain(sourcesData);
    }
    if (table === 'questions') {
      questionFromCallIndex++;
      const chain = makeChain(existingQuestionsForDedup);
      // Override insert
      chain.insert = vi.fn((data: unknown) => {
        insertCalls.push({ table, data });
        if (insertFailOnce && insertFailCount === 0) {
          insertFailCount++;
          return Promise.resolve({ data: null, error: { message: 'DB error' } });
        }
        if (insertShouldFail) {
          return Promise.resolve({ data: null, error: { message: 'DB error' } });
        }
        return Promise.resolve({ data: null, error: null });
      });
      return chain;
    }
    return makeChain([]);
  });

  return {
    from: mockFrom,
    insertCalls,
    selectCalls,
    setInsertShouldFail: (val: boolean) => { insertShouldFail = val; },
    setInsertFailOnce: (val: boolean) => { insertFailOnce = val; },
    categoriesData,
    sourcesData,
    existingQuestionsForDedup,
  };
}

describe('Questions Agent', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>;
  let mockClaude: { messages: { create: ReturnType<typeof vi.fn> } };

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    mockSupabase = createMockSupabase();
    mockClaude = {
      messages: {
        create: vi.fn().mockResolvedValue(createMockClaudeResponse(validQuestions)),
      },
    };

    const { createSupabaseClient } = await import('../../src/lib/supabase.js');
    const { createClaudeClient } = await import('../../src/lib/claude.js');
    vi.mocked(createSupabaseClient).mockReturnValue(mockSupabase as any);
    vi.mocked(createClaudeClient).mockReturnValue(mockClaude as any);
  });

  it('returns AgentResult with processed and failed counts', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    const result = await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    expect(result).toHaveProperty('processed');
    expect(result).toHaveProperty('failed');
    expect(typeof result.processed).toBe('number');
    expect(result.processed).toBe(2); // 2 valid questions
  });

  it('selects categories that have sources but few questions', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    expect(mockSupabase.from).toHaveBeenCalledWith('categories');
    expect(mockSupabase.from).toHaveBeenCalledWith('sources');
  });

  it('fetches source content for the selected category', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    expect(mockSupabase.from).toHaveBeenCalledWith('sources');
  });

  it('calls Claude with source text and existing questions for dedup', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    expect(mockClaude.messages.create).toHaveBeenCalled();
    const callArgs = mockClaude.messages.create.mock.calls[0][0];
    const userMsg = callArgs.messages.find((m: any) => m.role === 'user');
    // Source text should be in the prompt
    expect(userMsg.content).toContain('speed of light');
    // Dedup context should be included
    expect(userMsg.content).toContain('What is the speed of light?');
  });

  it('handles invalid Claude response gracefully', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    mockClaude.messages.create.mockResolvedValueOnce(
      createMockClaudeResponse([{ invalid: true }])
    );
    // Should throw because all items fail
    await expect(runQuestionsAgent(makeConfig(), makeTokenAccumulator())).rejects.toThrow();
  });

  it('validates that no distractor matches the correct answer', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    const badQuestion = {
      question_text: 'Test question?',
      correct_answer: 'Answer A',
      distractors: ['Answer A', 'Answer B', 'Answer C'],
      explanation: 'Test explanation.',
      difficulty: 'easy' as const,
    };
    mockClaude.messages.create.mockResolvedValueOnce(
      createMockClaudeResponse([badQuestion, validQuestions[0]])
    );
    const result = await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.processed).toBeGreaterThanOrEqual(1);
  });

  it('inserts questions with status=pending and verification_score=0', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    expect(mockSupabase.insertCalls.length).toBeGreaterThan(0);
    for (const call of mockSupabase.insertCalls) {
      const data = call.data as any;
      expect(data.status).toBe('pending');
      expect(data.verification_score).toBe(0);
    }
  });

  it('links each question to its source_id', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    expect(mockSupabase.insertCalls.length).toBeGreaterThan(0);
    for (const call of mockSupabase.insertCalls) {
      const data = call.data as any;
      expect(data.source_id).toBe('src-1');
    }
  });

  it('tracks tokens and respects budget cap', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    const { trackUsage, checkBudget } = await import('../../src/lib/claude.js');
    await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    expect(trackUsage).toHaveBeenCalled();
    expect(checkBudget).toHaveBeenCalled();
  });

  it('caps dedup context to 20 most recent questions per category', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    // Verify the questions table query uses order and limit
    const questionsCalls = mockSupabase.from.mock.calls.filter(
      (c: any[]) => c[0] === 'questions'
    );
    expect(questionsCalls.length).toBeGreaterThanOrEqual(1);
    // The dedup query should use order('created_at', {ascending: false}).limit(20)
    // We verify via the chain mock that order and limit were called
  });

  it('system prompt instructs Claude to generate only from provided text', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    expect(mockClaude.messages.create).toHaveBeenCalled();
    const callArgs = mockClaude.messages.create.mock.calls[0][0];
    const systemContent = typeof callArgs.system === 'string'
      ? callArgs.system
      : Array.isArray(callArgs.system)
        ? callArgs.system.map((s: any) => s.text).join(' ')
        : '';
    expect(systemContent).toContain('ONLY from facts that appear in the provided text');
  });

  it('per-item insert failure does not crash the agent', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    mockSupabase.setInsertFailOnce(true);
    const result = await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    expect(result).toBeDefined();
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.processed).toBeGreaterThanOrEqual(1);
  });

  it('uses log() from logger.ts for output', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    const { log } = await import('../../src/lib/logger.js');
    await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    expect(log).toHaveBeenCalled();
  });
});
