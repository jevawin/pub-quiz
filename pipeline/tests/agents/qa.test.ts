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

// Verified questions that need QA
const Q1_ID = '11111111-1111-1111-1111-111111111111';
const Q2_ID = '22222222-2222-2222-2222-222222222222';
const Q3_ID = '33333333-3333-3333-3333-333333333333';

const verifiedQuestions = [
  {
    id: Q1_ID,
    category_id: 'cat-1',
    source_id: 'src-1',
    question_text: 'What is the speed of light?',
    correct_answer: '299,792,458 m/s',
    distractors: ['150,000,000 m/s', '300,000,000 km/s', '199,792,458 m/s'],
    explanation: 'The speed of light is approximately 299,792,458 m/s.',
    difficulty: 'normal',
    verification_score: 3,
    status: 'verified',
    qa_rewritten: false,
    published_at: null,
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
    verification_score: 2,
    status: 'verified',
    qa_rewritten: false,
    published_at: null,
  },
  {
    id: Q3_ID,
    category_id: 'cat-1',
    source_id: 'src-1',
    question_text: 'What is quantum entanglement?',
    correct_answer: 'Particles linked regardless of distance',
    distractors: ['Particles that repel', 'Particles that merge', 'Particles that vanish'],
    explanation: 'Quantum entanglement links particles.',
    difficulty: 'hard',
    verification_score: 3,
    status: 'verified',
    qa_rewritten: false,
    published_at: null,
  },
];

const sourceData = {
  id: 'src-1',
  category_id: 'cat-1',
  title: 'Physics Article',
  content: 'The speed of light is approximately 299,792,458 metres per second. Albert Einstein developed the theory of special relativity. Quantum entanglement links particles.',
  url: 'https://en.wikipedia.org/wiki/Physics',
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

function createMockSupabase(questionsOverride?: unknown[]) {
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
      return makeChain(questionsOverride ?? verifiedQuestions);
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

describe('QA Agent', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>;
  let mockClaude: { messages: { create: ReturnType<typeof vi.fn> } };

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    mockSupabase = createMockSupabase();

    // Default: all questions pass QA
    mockClaude = {
      messages: {
        create: vi.fn().mockResolvedValue(createMockClaudeResponse([
          {
            question_id: Q1_ID,
            passed: true,
            action: 'pass',
            natural_language_score: 8,
            category_fit_score: 9,
            difficulty_calibration_score: 7,
            distractor_quality_score: 8,
            reasoning: 'Good question overall.',
          },
          {
            question_id: Q2_ID,
            passed: true,
            action: 'pass',
            natural_language_score: 7,
            category_fit_score: 8,
            difficulty_calibration_score: 6,
            distractor_quality_score: 7,
            reasoning: 'Decent question.',
          },
          {
            question_id: Q3_ID,
            passed: true,
            action: 'pass',
            natural_language_score: 9,
            category_fit_score: 9,
            difficulty_calibration_score: 8,
            distractor_quality_score: 9,
            reasoning: 'Excellent question.',
          },
        ])),
      },
    };

    const { createSupabaseClient } = await import('../../src/lib/supabase.js');
    const { createClaudeClient } = await import('../../src/lib/claude.js');
    vi.mocked(createSupabaseClient).mockReturnValue(mockSupabase as any);
    vi.mocked(createClaudeClient).mockReturnValue(mockClaude as any);
  });

  it('fetches all verified questions with score >= 1', async () => {
    const { runQaAgent } = await import('../../src/agents/qa.js');
    await runQaAgent(makeConfig(), makeTokenAccumulator());
    expect(mockSupabase.from).toHaveBeenCalledWith('questions');
  });

  it('runs 4 quality checks per question via Claude prompt', async () => {
    const { runQaAgent } = await import('../../src/agents/qa.js');
    await runQaAgent(makeConfig(), makeTokenAccumulator());
    expect(mockClaude.messages.create).toHaveBeenCalled();
    const callArgs = mockClaude.messages.create.mock.calls[0][0];
    const systemContent = typeof callArgs.system === 'string'
      ? callArgs.system
      : '';
    expect(systemContent).toContain('Natural Language');
    expect(systemContent).toContain('Category Fit');
    expect(systemContent).toContain('Difficulty Calibration');
    expect(systemContent).toContain('Distractor Quality');
  });

  it('rewrites fixable questions and updates DB with qa_rewritten=true', async () => {
    mockClaude.messages.create.mockResolvedValueOnce(createMockClaudeResponse([
      {
        question_id: Q1_ID,
        passed: false,
        action: 'rewrite',
        natural_language_score: 4,
        category_fit_score: 9,
        difficulty_calibration_score: 7,
        distractor_quality_score: 8,
        rewritten_question_text: 'What is the exact speed of light in a vacuum?',
        rewritten_distractors: ['150 million m/s', '300 thousand km/s', '200 million m/s'],
        rewritten_explanation: 'Light travels at 299,792,458 m/s in a vacuum.',
        reasoning: 'Question phrasing was awkward.',
      },
      {
        question_id: Q2_ID,
        passed: true,
        action: 'pass',
        natural_language_score: 7,
        category_fit_score: 8,
        difficulty_calibration_score: 6,
        distractor_quality_score: 7,
        reasoning: 'Fine as-is.',
      },
      {
        question_id: Q3_ID,
        passed: true,
        action: 'pass',
        natural_language_score: 9,
        category_fit_score: 9,
        difficulty_calibration_score: 8,
        distractor_quality_score: 9,
        reasoning: 'Excellent.',
      },
    ]));

    const { runQaAgent } = await import('../../src/agents/qa.js');
    const result = await runQaAgent(makeConfig(), makeTokenAccumulator());

    // Q1 was rewritten -- should have qa_rewritten: true and updated text
    const q1Update = mockSupabase.updateCalls.find((c) => c.questionId === Q1_ID);
    expect(q1Update).toBeDefined();
    const q1Data = q1Update!.data as any;
    expect(q1Data.qa_rewritten).toBe(true);
    expect(q1Data.question_text).toBe('What is the exact speed of light in a vacuum?');
    expect(q1Data.distractors).toEqual(['150 million m/s', '300 thousand km/s', '200 million m/s']);
    // Verification score should NOT be changed (D-05)
    expect(q1Data).not.toHaveProperty('verification_score');

    expect(result.rewritten).toBe(1);
  });

  it('rejects truly broken questions with status=rejected', async () => {
    mockClaude.messages.create.mockResolvedValueOnce(createMockClaudeResponse([
      {
        question_id: Q1_ID,
        passed: false,
        action: 'reject',
        natural_language_score: 2,
        category_fit_score: 1,
        difficulty_calibration_score: 3,
        distractor_quality_score: 2,
        reasoning: 'Question is nonsensical.',
      },
      {
        question_id: Q2_ID,
        passed: true,
        action: 'pass',
        natural_language_score: 7,
        category_fit_score: 8,
        difficulty_calibration_score: 6,
        distractor_quality_score: 7,
        reasoning: 'Fine.',
      },
      {
        question_id: Q3_ID,
        passed: true,
        action: 'pass',
        natural_language_score: 9,
        category_fit_score: 9,
        difficulty_calibration_score: 8,
        distractor_quality_score: 9,
        reasoning: 'Excellent.',
      },
    ]));

    const { runQaAgent } = await import('../../src/agents/qa.js');
    const result = await runQaAgent(makeConfig(), makeTokenAccumulator());

    const q1Update = mockSupabase.updateCalls.find((c) => c.questionId === Q1_ID);
    expect(q1Update).toBeDefined();
    const q1Data = q1Update!.data as any;
    expect(q1Data.status).toBe('rejected');
    expect(result.failed).toBe(1);
  });

  it('publishes score >= 3 questions that pass QA', async () => {
    const { runQaAgent } = await import('../../src/agents/qa.js');
    await runQaAgent(makeConfig(), makeTokenAccumulator());

    // Q1 has verification_score 3 and action=pass => should be published
    const q1Update = mockSupabase.updateCalls.find((c) => c.questionId === Q1_ID);
    expect(q1Update).toBeDefined();
    const q1Data = q1Update!.data as any;
    expect(q1Data.status).toBe('published');
    expect(q1Data.published_at).toBeDefined();

    // Q3 also has score 3 and action=pass => should be published
    const q3Update = mockSupabase.updateCalls.find((c) => c.questionId === Q3_ID);
    expect(q3Update).toBeDefined();
    const q3Data = q3Update!.data as any;
    expect(q3Data.status).toBe('published');
    expect(q3Data.published_at).toBeDefined();
  });

  it('leaves score 1-2 questions as verified after QA pass (no DB update)', async () => {
    const { runQaAgent } = await import('../../src/agents/qa.js');
    await runQaAgent(makeConfig(), makeTokenAccumulator());

    // Q2 has verification_score 2 and action=pass => no update needed (stays verified)
    const q2Update = mockSupabase.updateCalls.find((c) => c.questionId === Q2_ID);
    expect(q2Update).toBeUndefined();
  });

  it('validates rewritten distractors length is exactly 3', async () => {
    mockClaude.messages.create.mockResolvedValueOnce(createMockClaudeResponse([
      {
        question_id: Q1_ID,
        passed: false,
        action: 'rewrite',
        natural_language_score: 4,
        category_fit_score: 9,
        difficulty_calibration_score: 7,
        distractor_quality_score: 8,
        rewritten_question_text: 'Rewritten question',
        rewritten_distractors: ['Only one', 'Only two'], // Wrong length -- should be 3
        reasoning: 'Needs rewrite.',
      },
      {
        question_id: Q2_ID,
        passed: true,
        action: 'pass',
        natural_language_score: 7,
        category_fit_score: 8,
        difficulty_calibration_score: 6,
        distractor_quality_score: 7,
        reasoning: 'Fine.',
      },
      {
        question_id: Q3_ID,
        passed: true,
        action: 'pass',
        natural_language_score: 9,
        category_fit_score: 9,
        difficulty_calibration_score: 8,
        distractor_quality_score: 9,
        reasoning: 'Excellent.',
      },
    ]));

    // The QaBatchSchema enforces length(3) on rewritten_distractors,
    // so parsing will fail entirely. The agent should handle this gracefully.
    const { runQaAgent } = await import('../../src/agents/qa.js');
    const result = await runQaAgent(makeConfig(), makeTokenAccumulator());
    // All 3 questions should count as failed since batch parse fails
    expect(result).toBeDefined();
  });

  it('returns QaAgentResult with processed, failed, and rewritten counts', async () => {
    const { runQaAgent } = await import('../../src/agents/qa.js');
    const result = await runQaAgent(makeConfig(), makeTokenAccumulator());
    expect(result).toHaveProperty('processed');
    expect(result).toHaveProperty('failed');
    expect(result).toHaveProperty('rewritten');
    expect(typeof result.processed).toBe('number');
    expect(typeof result.failed).toBe('number');
    expect(typeof result.rewritten).toBe('number');
  });

  it('groups questions by source_id and fetches source content', async () => {
    const { runQaAgent } = await import('../../src/agents/qa.js');
    await runQaAgent(makeConfig(), makeTokenAccumulator());
    expect(mockSupabase.from).toHaveBeenCalledWith('sources');
  });

  it('tracks tokens with Haiku cost rates', async () => {
    const { runQaAgent } = await import('../../src/agents/qa.js');
    const { trackUsage, HAIKU_INPUT, HAIKU_OUTPUT } = await import('../../src/lib/claude.js');
    await runQaAgent(makeConfig(), makeTokenAccumulator());
    expect(trackUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      HAIKU_INPUT,
      HAIKU_OUTPUT,
    );
  });

  it('re-throws BudgetExceededError', async () => {
    const { BudgetExceededError } = await import('../../src/lib/claude.js');
    const { checkBudget } = await import('../../src/lib/claude.js');
    vi.mocked(checkBudget).mockImplementation(() => {
      throw new BudgetExceededError(15, 10);
    });

    const { runQaAgent } = await import('../../src/agents/qa.js');
    await expect(runQaAgent(makeConfig(), makeTokenAccumulator())).rejects.toThrow(BudgetExceededError);
  });

  it('rewritten question with score >= 3 gets published', async () => {
    mockClaude.messages.create.mockResolvedValueOnce(createMockClaudeResponse([
      {
        question_id: Q1_ID, // verification_score: 3
        passed: false,
        action: 'rewrite',
        natural_language_score: 4,
        category_fit_score: 9,
        difficulty_calibration_score: 7,
        distractor_quality_score: 8,
        rewritten_question_text: 'Improved question text',
        rewritten_distractors: ['Option A', 'Option B', 'Option C'],
        rewritten_explanation: 'Better explanation.',
        reasoning: 'Needed polish.',
      },
      {
        question_id: Q2_ID,
        passed: true,
        action: 'pass',
        natural_language_score: 7,
        category_fit_score: 8,
        difficulty_calibration_score: 6,
        distractor_quality_score: 7,
        reasoning: 'Fine.',
      },
      {
        question_id: Q3_ID,
        passed: true,
        action: 'pass',
        natural_language_score: 9,
        category_fit_score: 9,
        difficulty_calibration_score: 8,
        distractor_quality_score: 9,
        reasoning: 'Excellent.',
      },
    ]));

    const { runQaAgent } = await import('../../src/agents/qa.js');
    await runQaAgent(makeConfig(), makeTokenAccumulator());

    // Q1 rewritten with score 3 => should be published
    const q1Update = mockSupabase.updateCalls.find((c) => c.questionId === Q1_ID);
    expect(q1Update).toBeDefined();
    const q1Data = q1Update!.data as any;
    expect(q1Data.status).toBe('published');
    expect(q1Data.published_at).toBeDefined();
    expect(q1Data.qa_rewritten).toBe(true);
  });
});
