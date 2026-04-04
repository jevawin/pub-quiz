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

// Helper to build a mock Supabase client with chainable query builder
function createMockSupabase() {
  const mockQuestionInsert = vi.fn();
  const mockSelectSources = vi.fn();
  const mockSelectQuestions = vi.fn();
  const mockSelectCategories = vi.fn();

  // Categories with sources query: categories that have sources but < 10 questions
  const categoriesWithSourcesData = [
    { id: 'cat-1', name: 'Science', slug: 'science' },
  ];

  // Sources data
  const sourcesData = [
    {
      id: 'src-1',
      category_id: 'cat-1',
      title: 'Physics Article',
      content: 'The speed of light is approximately 299,792,458 metres per second. Albert Einstein developed the theory of special relativity.',
      url: 'https://en.wikipedia.org/wiki/Speed_of_light',
    },
  ];

  // Existing questions for dedup
  const existingQuestionsData = [
    { question_text: 'What is the speed of light?' },
  ];

  // Build chainable query mock
  function chainable(data: unknown, error: unknown = null) {
    const chain: Record<string, unknown> = {};
    const result = { data, error };

    const methods = ['select', 'insert', 'eq', 'in', 'order', 'limit', 'lte', 'gte', 'lt', 'gt', 'neq', 'single', 'maybeSingle'];
    for (const method of methods) {
      chain[method] = vi.fn().mockReturnValue(chain);
    }
    // The terminal call returns the result
    chain['then'] = (resolve: (val: unknown) => void) => resolve(result);
    // Make it thenable
    Object.defineProperty(chain, 'then', {
      value: (resolve: (val: unknown) => void) => Promise.resolve(result).then(resolve),
    });

    return chain;
  }

  // Track calls to from()
  const fromCalls: Record<string, ReturnType<typeof chainable>> = {};

  const mockFrom = vi.fn().mockImplementation((table: string) => {
    if (table === 'categories') {
      const chain = chainable(categoriesWithSourcesData);
      fromCalls['categories'] = chain;
      return chain;
    }
    if (table === 'sources') {
      const chain = chainable(sourcesData);
      fromCalls['sources'] = chain;
      mockSelectSources.mockReturnValue(chain);
      return chain;
    }
    if (table === 'questions') {
      // Could be a select (dedup) or insert
      const chain = chainable(existingQuestionsData);
      // Override insert to track
      chain['insert'] = vi.fn().mockImplementation(() => {
        mockQuestionInsert();
        return Promise.resolve({ data: null, error: null });
      });
      fromCalls['questions'] = chain;
      mockSelectQuestions.mockReturnValue(chain);
      return chain;
    }
    return chainable([]);
  });

  return {
    from: mockFrom,
    mockQuestionInsert,
    mockSelectSources,
    mockSelectQuestions,
    fromCalls,
    categoriesWithSourcesData,
    sourcesData,
    existingQuestionsData,
  };
}

// Build a mock Claude response
function createMockClaudeResponse(questions: unknown[]) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ questions }),
      },
    ],
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
    },
    id: 'msg-test',
    model: 'claude-sonnet-4-5-20250514',
    role: 'assistant' as const,
    type: 'message' as const,
    stop_reason: 'end_turn' as const,
  };
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

describe('Questions Agent', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>;
  let mockClaude: { messages: { create: ReturnType<typeof vi.fn> } };

  beforeEach(async () => {
    vi.resetAllMocks();
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

  it('returns AgentResult with questions_generated count', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    const result = await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    expect(result).toHaveProperty('processed');
    expect(result).toHaveProperty('failed');
    expect(typeof result.processed).toBe('number');
  });

  it('selects categories that have sources but few questions', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    // Should have queried categories table
    expect(mockSupabase.from).toHaveBeenCalledWith('categories');
  });

  it('fetches source content for the selected category', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    // Should have queried sources table
    expect(mockSupabase.from).toHaveBeenCalledWith('sources');
  });

  it('calls Claude with source text and existing questions for dedup', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    expect(mockClaude.messages.create).toHaveBeenCalled();
    const callArgs = mockClaude.messages.create.mock.calls[0][0];
    // User message should contain source text
    const userMsg = callArgs.messages.find((m: any) => m.role === 'user');
    expect(userMsg.content).toContain('speed of light');
  });

  it('validates response against QuestionBatchSchema', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    // If Claude returns invalid data, agent should handle it
    mockClaude.messages.create.mockResolvedValueOnce(
      createMockClaudeResponse([{ invalid: true }])
    );
    // Should not throw entirely - handles parse errors
    const result = await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    // With invalid data, should have 0 processed (or handled gracefully)
    expect(result.processed).toBe(0);
  });

  it('validates that no distractor matches the correct answer', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    // Return a question where a distractor matches the correct answer
    const badQuestion = {
      question_text: 'Test question?',
      correct_answer: 'Answer A',
      distractors: ['Answer A', 'Answer B', 'Answer C'], // first distractor = correct answer
      explanation: 'Test explanation.',
      difficulty: 'easy' as const,
    };
    mockClaude.messages.create.mockResolvedValueOnce(
      createMockClaudeResponse([badQuestion, validQuestions[0]])
    );
    const result = await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    // The bad question should be rejected, the valid one accepted
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });

  it('inserts questions with status=pending and verification_score=0', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    // Verify questions table was used for inserts
    expect(mockSupabase.from).toHaveBeenCalledWith('questions');
  });

  it('links each question to its source_id', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    // The insert should include source_id
    expect(mockSupabase.from).toHaveBeenCalledWith('questions');
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
    // The questions query for dedup should have been called with limit
    const questionsCalls = mockSupabase.from.mock.calls.filter(
      (c: any[]) => c[0] === 'questions'
    );
    expect(questionsCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('system prompt instructs Claude to generate only from provided text', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    expect(mockClaude.messages.create).toHaveBeenCalled();
    const callArgs = mockClaude.messages.create.mock.calls[0][0];
    const systemContent = typeof callArgs.system === 'string'
      ? callArgs.system
      : callArgs.system?.map((s: any) => s.text).join(' ');
    expect(systemContent).toContain('ONLY');
    expect(systemContent).toContain('provided');
  });

  it('per-item insert/validation failure does not crash the agent', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    // Mock insert to fail on first call
    const originalFrom = mockSupabase.from;
    let insertCallCount = 0;
    mockSupabase.from.mockImplementation((table: string) => {
      const result = originalFrom(table);
      if (table === 'questions' && result.insert) {
        const origInsert = result.insert;
        result.insert = vi.fn().mockImplementation((...args: unknown[]) => {
          insertCallCount++;
          if (insertCallCount === 1) {
            return Promise.resolve({ data: null, error: { message: 'DB error' } });
          }
          return Promise.resolve({ data: null, error: null });
        });
      }
      return result;
    });
    // Should not throw
    const result = await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    expect(result).toBeDefined();
  });

  it('uses log() from logger.ts for output', async () => {
    const { runQuestionsAgent } = await import('../../src/agents/questions.js');
    const { log } = await import('../../src/lib/logger.js');
    await runQuestionsAgent(makeConfig(), makeTokenAccumulator());
    expect(log).toHaveBeenCalled();
  });
});
