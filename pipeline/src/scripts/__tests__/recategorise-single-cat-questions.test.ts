import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCalibrateQuestion, mockClaudeCreate } = vi.hoisted(() => ({
  mockCalibrateQuestion: vi.fn(),
  mockClaudeCreate: vi.fn(),
}));

vi.mock('../../agents/calibrator.js', () => ({
  calibrateQuestion: mockCalibrateQuestion,
}));

vi.mock('../../lib/claude.js', async () => {
  const actual = await vi.importActual<typeof import('../../lib/claude.js')>('../../lib/claude.js');
  return {
    ...actual,
    createClaudeClient: vi.fn(() => ({ messages: { create: mockClaudeCreate } })),
  };
});

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseClient: vi.fn(() => mockSupabase),
}));

let mockSupabase: ReturnType<typeof makeMockSupabase>;

interface FakeQc {
  question_id: string;
  category_slug: string;
}

function makeMockSupabase(opts: {
  publishedIds: string[];
  qcRows: FakeQc[];
  questions: Array<{ id: string; question_text: string; correct_answer: string; distractors: string[] }>;
  availableSlugs: string[];
}) {
  // Track inserts so tests can assert them
  const inserts: Array<{ table: string; rows: unknown }> = [];

  function questionsTable() {
    return {
      select: vi.fn((cols: string) => {
        if (cols === 'id') {
          return {
            eq: vi.fn(() => ({
              range: vi.fn(async (_from: number, _to: number) => ({
                data: opts.publishedIds.map((id) => ({ id })),
                error: null,
              })),
            })),
          };
        }
        // 'id, question_text, correct_answer, distractors'
        return {
          in: vi.fn(async (_col: string, ids: string[]) => ({
            data: opts.questions.filter((q) => ids.includes(q.id)),
            error: null,
          })),
        };
      }),
    };
  }

  function qcTable() {
    return {
      select: vi.fn(() => ({
        range: vi.fn(async (_from: number, _to: number) => ({
          data: opts.qcRows.map((r) => ({
            question_id: r.question_id,
            categories: { slug: r.category_slug },
          })),
          error: null,
        })),
      })),
      insert: vi.fn((rows: unknown) => {
        inserts.push({ table: 'question_categories', rows });
        return Promise.resolve({ error: null });
      }),
      upsert: vi.fn((rows: unknown) => {
        inserts.push({ table: 'question_categories', rows });
        return Promise.resolve({ error: null });
      }),
    };
  }

  function categoriesTable() {
    return {
      select: vi.fn(async () => ({
        data: opts.availableSlugs.concat(['general-knowledge']).map((slug) => ({ slug })),
        error: null,
      })),
    };
  }

  return {
    inserts,
    from: vi.fn((table: string) => {
      if (table === 'questions') return questionsTable();
      if (table === 'question_categories') return qcTable();
      if (table === 'categories') return categoriesTable();
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

const baseConfig = {
  anthropicApiKey: 'test',
  supabaseUrl: 'http://localhost',
  supabaseServiceRoleKey: 'svc',
  budgetCapUsd: 5,
  categoryBatchSize: 5,
  knowledgeBatchSize: 10,
  questionsBatchSize: 20,
  claudeModelGeneration: 'sonnet',
  claudeModelVerification: 'sonnet',
  claudeModelAudit: 'opus',
  wikipediaUserAgent: 'test',
  wikipediaMaxContentLength: 1000,
  relevanceThreshold: 0.6,
};

import {
  fetchSingleCatQuestions,
  fetchAvailableSlugs,
  proposeExtraCategories,
  recategoriseOne,
  runRecategorise,
} from '../recategorise-single-cat-questions.js';
import { BudgetExceededError, createTokenAccumulator } from '../../lib/claude.js';

function claudeResponse(text: string, inputTokens = 100, outputTokens = 50) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

describe('fetchSingleCatQuestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only published questions with exactly 1 qc row', async () => {
    mockSupabase = makeMockSupabase({
      publishedIds: ['q1', 'q2', 'q3', 'q4'],
      qcRows: [
        { question_id: 'q1', category_slug: 'general-knowledge' }, // 1 row → target
        { question_id: 'q2', category_slug: 'general-knowledge' }, // 2 rows → skip
        { question_id: 'q2', category_slug: 'science' },
        { question_id: 'q3', category_slug: 'general-knowledge' }, // 1 row → target
        // q4 has 0 rows → skip (not single, just empty)
      ],
      questions: [
        { id: 'q1', question_text: 'Q1?', correct_answer: 'A1', distractors: ['B', 'C', 'D'] },
        { id: 'q3', question_text: 'Q3?', correct_answer: 'A3', distractors: ['B', 'C', 'D'] },
      ],
      availableSlugs: ['science', 'history'],
    });
    const result = await fetchSingleCatQuestions(mockSupabase as never);
    expect(result.map((r) => r.id).sort()).toEqual(['q1', 'q3']);
    expect(result.find((r) => r.id === 'q1')?.existing_slugs).toEqual(['general-knowledge']);
  });

  it('respects --limit', async () => {
    mockSupabase = makeMockSupabase({
      publishedIds: ['q1', 'q2', 'q3'],
      qcRows: [
        { question_id: 'q1', category_slug: 'general-knowledge' },
        { question_id: 'q2', category_slug: 'general-knowledge' },
        { question_id: 'q3', category_slug: 'general-knowledge' },
      ],
      questions: [
        { id: 'q1', question_text: 'Q1?', correct_answer: 'A1', distractors: [] },
        { id: 'q2', question_text: 'Q2?', correct_answer: 'A2', distractors: [] },
      ],
      availableSlugs: ['science'],
    });
    const result = await fetchSingleCatQuestions(mockSupabase as never, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });
});

describe('fetchAvailableSlugs', () => {
  it('excludes general-knowledge', async () => {
    mockSupabase = makeMockSupabase({
      publishedIds: [],
      qcRows: [],
      questions: [],
      availableSlugs: ['science', 'history'],
    });
    const slugs = await fetchAvailableSlugs(mockSupabase as never);
    expect(slugs).not.toContain('general-knowledge');
    expect(slugs).toEqual(expect.arrayContaining(['science', 'history']));
  });
});

describe('proposeExtraCategories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns valid slugs from the available set', async () => {
    mockClaudeCreate.mockResolvedValueOnce(
      claudeResponse(JSON.stringify({ category_slugs: ['science', 'technology'], reasoning: 'tech topic' })),
    );
    const tokenAcc = createTokenAccumulator();
    const result = await proposeExtraCategories(
      { messages: { create: mockClaudeCreate } } as never,
      tokenAcc,
      {
        id: 'q1',
        question_text: 'What is HTTP?',
        correct_answer: 'protocol',
        distractors: ['a', 'b', 'c'],
        existing_slugs: ['general-knowledge'],
      },
      ['science', 'history', 'technology'],
      5,
    );
    expect(result.slugs).toEqual(['science', 'technology']);
  });

  it('drops slugs not in the available set', async () => {
    mockClaudeCreate.mockResolvedValueOnce(
      claudeResponse(JSON.stringify({ category_slugs: ['science', 'made-up-slug'], reasoning: '' })),
    );
    const tokenAcc = createTokenAccumulator();
    const result = await proposeExtraCategories(
      { messages: { create: mockClaudeCreate } } as never,
      tokenAcc,
      {
        id: 'q1',
        question_text: 'Q?',
        correct_answer: 'A',
        distractors: [],
        existing_slugs: ['general-knowledge'],
      },
      ['science', 'history'],
      5,
    );
    expect(result.slugs).toEqual(['science']);
  });

  it('drops general-knowledge if Claude proposes it as extra', async () => {
    mockClaudeCreate.mockResolvedValueOnce(
      claudeResponse(JSON.stringify({ category_slugs: ['general-knowledge', 'science'] })),
    );
    const tokenAcc = createTokenAccumulator();
    const result = await proposeExtraCategories(
      { messages: { create: mockClaudeCreate } } as never,
      tokenAcc,
      {
        id: 'q1',
        question_text: 'Q?',
        correct_answer: 'A',
        distractors: [],
        existing_slugs: ['general-knowledge'],
      },
      ['science'],
      5,
    );
    expect(result.slugs).toEqual(['science']);
  });

  it('drops slugs already assigned to the question', async () => {
    mockClaudeCreate.mockResolvedValueOnce(
      claudeResponse(JSON.stringify({ category_slugs: ['science', 'history'] })),
    );
    const tokenAcc = createTokenAccumulator();
    const result = await proposeExtraCategories(
      { messages: { create: mockClaudeCreate } } as never,
      tokenAcc,
      {
        id: 'q1',
        question_text: 'Q?',
        correct_answer: 'A',
        distractors: [],
        existing_slugs: ['general-knowledge', 'science'],
      },
      ['science', 'history'],
      5,
    );
    expect(result.slugs).toEqual(['history']);
  });

  it('caps proposals so total stays ≤ 4 (D-15)', async () => {
    mockClaudeCreate.mockResolvedValueOnce(
      claudeResponse(JSON.stringify({ category_slugs: ['a', 'b', 'c'] })),
    );
    const tokenAcc = createTokenAccumulator();
    // Question already has 2 non-GK extras + GK = 3. Cap at 4 → only 1 slot left.
    const result = await proposeExtraCategories(
      { messages: { create: mockClaudeCreate } } as never,
      tokenAcc,
      {
        id: 'q1',
        question_text: 'Q?',
        correct_answer: 'A',
        distractors: [],
        existing_slugs: ['general-knowledge', 'x', 'y'],
      },
      ['a', 'b', 'c'],
      5,
    );
    expect(result.slugs.length).toBeLessThanOrEqual(1);
  });

  it('returns error when Claude returns malformed JSON', async () => {
    mockClaudeCreate.mockResolvedValueOnce(claudeResponse('not json at all'));
    const tokenAcc = createTokenAccumulator();
    const result = await proposeExtraCategories(
      { messages: { create: mockClaudeCreate } } as never,
      tokenAcc,
      { id: 'q1', question_text: 'Q?', correct_answer: 'A', distractors: [], existing_slugs: ['general-knowledge'] },
      ['science'],
      5,
    );
    expect(result.error).toBeTruthy();
    expect(result.slugs).toEqual([]);
  });

  it('throws BudgetExceededError when budget cap reached', async () => {
    mockClaudeCreate.mockResolvedValueOnce(
      // Massive token usage → blows the cap
      claudeResponse(JSON.stringify({ category_slugs: ['science'] }), 10_000_000, 1_000_000),
    );
    const tokenAcc = createTokenAccumulator();
    await expect(
      proposeExtraCategories(
        { messages: { create: mockClaudeCreate } } as never,
        tokenAcc,
        { id: 'q1', question_text: 'Q?', correct_answer: 'A', distractors: [], existing_slugs: ['general-knowledge'] },
        ['science'],
        0.01, // tiny cap
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });
});

describe('recategoriseOne', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dry-run does not call calibrator', async () => {
    mockClaudeCreate.mockResolvedValueOnce(
      claudeResponse(JSON.stringify({ category_slugs: ['science'] })),
    );
    mockSupabase = makeMockSupabase({ publishedIds: [], qcRows: [], questions: [], availableSlugs: ['science'] });
    const tokenAcc = createTokenAccumulator();
    const r = await recategoriseOne(
      mockSupabase as never,
      { messages: { create: mockClaudeCreate } } as never,
      tokenAcc,
      { id: 'q1', question_text: 'Q?', correct_answer: 'A', distractors: [], existing_slugs: ['general-knowledge'] },
      ['science'],
      baseConfig,
      { dryRun: true, budgetCapUsd: 5 },
    );
    expect(r.status).toBe('processed');
    expect(mockCalibrateQuestion).not.toHaveBeenCalled();
    expect(mockSupabase.inserts).toEqual([]);
  });

  it('real run calls calibrator with proposed slugs', async () => {
    mockClaudeCreate.mockResolvedValueOnce(
      claudeResponse(JSON.stringify({ category_slugs: ['science', 'history'] })),
    );
    mockCalibrateQuestion.mockResolvedValueOnce({
      success: true,
      scores: { 'general-knowledge': 50, science: 70, history: 40 },
    });
    mockSupabase = makeMockSupabase({ publishedIds: [], qcRows: [], questions: [], availableSlugs: ['science', 'history'] });
    const tokenAcc = createTokenAccumulator();
    const r = await recategoriseOne(
      mockSupabase as never,
      { messages: { create: mockClaudeCreate } } as never,
      tokenAcc,
      { id: 'q1', question_text: 'Q?', correct_answer: 'A', distractors: [], existing_slugs: ['general-knowledge'] },
      ['science', 'history'],
      baseConfig,
      { dryRun: false, budgetCapUsd: 5 },
    );
    expect(r.status).toBe('processed');
    expect(mockCalibrateQuestion).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ id: 'q1', assigned_slugs: ['science', 'history'] }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('returns skipped_no_extras when Claude proposes nothing', async () => {
    mockClaudeCreate.mockResolvedValueOnce(
      claudeResponse(JSON.stringify({ category_slugs: [] })),
    );
    mockSupabase = makeMockSupabase({ publishedIds: [], qcRows: [], questions: [], availableSlugs: ['science'] });
    const tokenAcc = createTokenAccumulator();
    const r = await recategoriseOne(
      mockSupabase as never,
      { messages: { create: mockClaudeCreate } } as never,
      tokenAcc,
      { id: 'q1', question_text: 'Q?', correct_answer: 'A', distractors: [], existing_slugs: ['general-knowledge'] },
      ['science'],
      baseConfig,
      { dryRun: false, budgetCapUsd: 5 },
    );
    expect(r.status).toBe('skipped_no_extras');
    expect(mockCalibrateQuestion).not.toHaveBeenCalled();
  });

  it('returns failed when calibrator fails', async () => {
    mockClaudeCreate.mockResolvedValueOnce(
      claudeResponse(JSON.stringify({ category_slugs: ['science'] })),
    );
    mockCalibrateQuestion.mockResolvedValueOnce({ success: false, error: 'parse error' });
    mockSupabase = makeMockSupabase({ publishedIds: [], qcRows: [], questions: [], availableSlugs: ['science'] });
    const tokenAcc = createTokenAccumulator();
    const r = await recategoriseOne(
      mockSupabase as never,
      { messages: { create: mockClaudeCreate } } as never,
      tokenAcc,
      { id: 'q1', question_text: 'Q?', correct_answer: 'A', distractors: [], existing_slugs: ['general-knowledge'] },
      ['science'],
      baseConfig,
      { dryRun: false, budgetCapUsd: 5 },
    );
    expect(r.status).toBe('failed');
    expect(r.error).toContain('calibrator');
  });
});

describe('runRecategorise', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('end-to-end happy path: 1 question processed', async () => {
    mockSupabase = makeMockSupabase({
      publishedIds: ['q1', 'q2'],
      qcRows: [
        { question_id: 'q1', category_slug: 'general-knowledge' },
        { question_id: 'q2', category_slug: 'general-knowledge' },
        { question_id: 'q2', category_slug: 'science' }, // q2 has 2 rows → not target
      ],
      questions: [
        { id: 'q1', question_text: 'Q1?', correct_answer: 'A1', distractors: [] },
      ],
      availableSlugs: ['science'],
    });
    mockClaudeCreate.mockResolvedValue(
      claudeResponse(JSON.stringify({ category_slugs: ['science'] })),
    );
    mockCalibrateQuestion.mockResolvedValue({
      success: true,
      scores: { 'general-knowledge': 50, science: 70 },
    });

    const result = await runRecategorise(baseConfig);
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockCalibrateQuestion).toHaveBeenCalledTimes(1);
  });

  it('propagates BudgetExceededError', async () => {
    mockSupabase = makeMockSupabase({
      publishedIds: ['q1'],
      qcRows: [{ question_id: 'q1', category_slug: 'general-knowledge' }],
      questions: [{ id: 'q1', question_text: 'Q1?', correct_answer: 'A1', distractors: [] }],
      availableSlugs: ['science'],
    });
    mockClaudeCreate.mockResolvedValue(
      claudeResponse(JSON.stringify({ category_slugs: ['science'] }), 10_000_000, 1_000_000),
    );
    await expect(runRecategorise({ ...baseConfig, budgetCapUsd: 0.01 })).rejects.toBeInstanceOf(BudgetExceededError);
  });
});
