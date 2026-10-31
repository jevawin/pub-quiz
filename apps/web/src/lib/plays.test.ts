import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsert = vi.fn();
const mockRpc = vi.fn();
vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(() => ({ insert: mockInsert })),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

const mockSize = vi.fn(() => 0);
vi.mock('./outbox', () => ({
  enqueue: vi.fn(),
  flushOutbox: vi.fn(),
  size: (...args: unknown[]) => mockSize(...(args as [])),
}));

import { recordQuestionPlay, recordQuizSession, QuestionPlayRow, QuizSessionRow } from './plays';
import { supabase } from './supabase';
import { enqueue, flushOutbox } from './outbox';

const mockFrom = supabase.from as ReturnType<typeof vi.fn>;
const mockEnqueue = enqueue as ReturnType<typeof vi.fn>;
const mockFlush = flushOutbox as ReturnType<typeof vi.fn>;

const playRow: QuestionPlayRow = {
  session_id: 'sess-1',
  question_id: 'q-1',
  chosen_option: 'Paris',
  is_correct: true,
  time_to_answer_ms: 3200,
  played_at: '2026-04-11T00:00:00Z',
};

const sessionRow: QuizSessionRow = {
  session_id: 'sess-1',
  category_slug: 'science',
  difficulty: 'normal',
  num_questions: 10,
  score: 7,
  overall_rating: null,
  feedback_text: null,
  started_at: '2026-04-11T00:00:00Z',
};

beforeEach(() => {
  mockInsert.mockReset();
  mockFrom.mockReset().mockReturnValue({ insert: mockInsert });
  mockEnqueue.mockReset();
  mockFlush.mockReset().mockResolvedValue(undefined);
});

describe('recordQuestionPlay', () => {
  it('calls supabase.from("question_plays").insert(row) with NO .select() chained', async () => {
    mockInsert.mockResolvedValue({ error: null });
    await recordQuestionPlay(playRow);
    expect(mockFrom).toHaveBeenCalledWith('question_plays');
    expect(mockInsert).toHaveBeenCalledWith(playRow);
    // The mock insert returns a plain object, not a chain with .select
    // If .select were called, it would throw — proving the trap is avoided
  });

  it('on success, triggers flushOutbox for "question_plays"', async () => {
    mockInsert.mockResolvedValue({ error: null });
    await recordQuestionPlay(playRow);
    expect(mockFlush).toHaveBeenCalledWith('question_plays', expect.any(Function));
  });

  it('on insert error, enqueues the row and does NOT throw', async () => {
    mockInsert.mockResolvedValue({ error: new Error('network') });
    await expect(recordQuestionPlay(playRow)).resolves.toBeUndefined();
    expect(mockEnqueue).toHaveBeenCalledWith('question_plays', playRow);
    expect(mockFlush).not.toHaveBeenCalled();
  });
});

describe('recordQuizSession', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockSize.mockReset().mockReturnValue(0);
    mockEnqueue.mockReset();
    mockFlush.mockReset().mockResolvedValue(undefined);
  });

  it('saves via the save_quiz_session RPC and flushes on success', async () => {
    mockRpc.mockResolvedValue({ error: null });
    await recordQuizSession({ ...sessionRow, id: 'row-1', overall_rating: 'good' });
    expect(mockRpc).toHaveBeenCalledWith('save_quiz_session', {
      p_id: 'row-1',
      p_category_slug: 'science',
      p_difficulty: 'normal',
      p_num_questions: 10,
      p_score: 7,
      p_overall_rating: 'good',
      p_feedback_text: null,
      p_started_at: '2026-04-11T00:00:00Z',
    });
    expect(mockFlush).toHaveBeenCalledWith('quiz_sessions', expect.any(Function));
  });

  it('passes p_id null for legacy rows without an id', async () => {
    mockRpc.mockResolvedValue({ error: null });
    await recordQuizSession(sessionRow);
    expect(mockRpc.mock.calls[0][1].p_id).toBeNull();
  });

  it('enqueues on error and does NOT throw', async () => {
    mockRpc.mockResolvedValue({ error: new Error('fail') });
    await expect(recordQuizSession(sessionRow)).resolves.toBeUndefined();
    expect(mockEnqueue).toHaveBeenCalledWith('quiz_sessions', sessionRow);
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it('queues behind older pending saves so a retry cannot overwrite a newer one', async () => {
    mockSize.mockReturnValue(1);
    await recordQuizSession(sessionRow);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith('quiz_sessions', sessionRow);
    expect(mockFlush).toHaveBeenCalledWith('quiz_sessions', expect.any(Function));
  });
});
