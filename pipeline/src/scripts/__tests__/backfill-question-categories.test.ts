import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() per project convention (STATE.md)
const { mockCalibrateQuestion } = vi.hoisted(() => {
  return {
    mockCalibrateQuestion: vi.fn(),
  };
});

vi.mock('../../agents/calibrator.js', () => ({
  calibrateQuestion: mockCalibrateQuestion,
}));

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseClient: vi.fn(() => mockSupabase),
}));

vi.mock('../../lib/config.js', () => ({
  loadConfig: vi.fn(() => ({
    supabaseUrl: 'http://localhost',
    supabaseServiceRoleKey: 'test-svc-key',
    claudeModelVerification: 'sonnet',
  })),
}));

// Shared mock supabase client (reassigned per test)
let mockSupabase: ReturnType<typeof makeMockSupabase>;

function makeMockSupabase(opts: {
  existingIds: string[];
  questions: Array<{ id: string; question_text: string; correct_answer: string; distractors: string[]; category_id: string }>;
  categorySlug?: string;
}) {
  const categoriesSelectSingle = vi.fn().mockResolvedValue({ data: { slug: opts.categorySlug ?? 'science' }, error: null });
  const categoriesEq = vi.fn(() => ({ single: categoriesSelectSingle }));
  const categoriesSelect = vi.fn(() => ({ eq: categoriesEq }));

  const questionsResult = vi.fn().mockResolvedValue({ data: opts.questions, error: null });
  const questionsEq = vi.fn(() => ({ limit: questionsResult }));
  const questionsSelect = vi.fn(() => ({ eq: questionsEq }));

  const qcResult = vi.fn().mockResolvedValue({
    data: opts.existingIds.map(id => ({ question_id: id })),
    error: null,
  });
  const qcSelect = vi.fn(() => qcResult());

  return {
    from: vi.fn((table: string) => {
      if (table === 'question_categories') return { select: qcSelect };
      if (table === 'questions') return { select: questionsSelect };
      if (table === 'categories') return { select: categoriesSelect };
      return {};
    }),
  };
}

import { backfillBatch, parseMaxCalls } from '../backfill-question-categories.js';
import { UsageStopError } from '../../lib/usage.js';

const fakeCall = vi.fn() as never;

describe('backfillBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCalibrateQuestion.mockResolvedValue({ success: true, scores: { 'general-knowledge': 50 } });
  });

  it('processes questions that have no question_categories rows', async () => {
    mockSupabase = makeMockSupabase({
      existingIds: [],
      questions: [
        { id: 'q1', question_text: 'Q1?', correct_answer: 'A1', distractors: ['B', 'C', 'D'], category_id: 'cat-1' },
        { id: 'q2', question_text: 'Q2?', correct_answer: 'A2', distractors: ['B', 'C', 'D'], category_id: 'cat-2' },
      ],
    });

    const result = await backfillBatch(mockSupabase as never, fakeCall, 10);

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(mockCalibrateQuestion).toHaveBeenCalledTimes(2);
  });

  it('counts failed questions when calibrate returns success: false', async () => {
    mockCalibrateQuestion
      .mockResolvedValueOnce({ success: true, scores: { 'general-knowledge': 50 } })
      .mockResolvedValueOnce({ success: false, error: 'calibration error' });

    mockSupabase = makeMockSupabase({
      existingIds: [],
      questions: [
        { id: 'q1', question_text: 'Q1?', correct_answer: 'A1', distractors: ['B', 'C', 'D'], category_id: 'cat-1' },
        { id: 'q2', question_text: 'Q2?', correct_answer: 'A2', distractors: ['B', 'C', 'D'], category_id: 'cat-2' },
      ],
    });

    const result = await backfillBatch(mockSupabase as never, fakeCall, 10);

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('skips questions that already have question_categories rows (resumable)', async () => {
    // q1 already has a row — should be skipped
    mockSupabase = makeMockSupabase({
      existingIds: ['q1'],
      questions: [
        { id: 'q1', question_text: 'Q1?', correct_answer: 'A1', distractors: ['B', 'C', 'D'], category_id: 'cat-1' },
        { id: 'q2', question_text: 'Q2?', correct_answer: 'A2', distractors: ['B', 'C', 'D'], category_id: 'cat-2' },
      ],
    });

    const result = await backfillBatch(mockSupabase as never, fakeCall, 10);

    // Only q2 should be processed — q1 is already done
    expect(mockCalibrateQuestion).toHaveBeenCalledTimes(1);
    expect(mockCalibrateQuestion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'q2' }),
      fakeCall,
      expect.anything(),
    );
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('propagates UsageStopError (max calls reached) instead of counting it as a failure', async () => {
    mockCalibrateQuestion.mockRejectedValueOnce(new UsageStopError('max calls (1) reached'));
    mockSupabase = makeMockSupabase({
      existingIds: [],
      questions: [
        { id: 'q1', question_text: 'Q1?', correct_answer: 'A1', distractors: ['B', 'C', 'D'], category_id: 'cat-1' },
      ],
    });
    await expect(backfillBatch(mockSupabase as never, fakeCall, 10)).rejects.toBeInstanceOf(UsageStopError);
  });
});

describe('parseMaxCalls', () => {
  it('defaults to 200, reads --max-calls, rejects junk', () => {
    expect(parseMaxCalls([])).toBe(200);
    expect(parseMaxCalls(['--max-calls', '7'])).toBe(7);
    expect(() => parseMaxCalls(['--max-calls', 'x'])).toThrow();
    expect(() => parseMaxCalls(['--max-calls', '0'])).toThrow();
  });
});
