import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabase: { rpc },
}));

vi.mock('./seen-store', () => ({
  getViewCounts: (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 0])),
  getSeenIds: () => [],
}));

import { fetchRandomQuestions, fetchCountsByRootCategory } from './questions';

beforeEach(() => {
  rpc.mockReset();
});

const makeRow = (id: string) => ({
  id,
  question_text: `Question ${id}`,
  correct_answer: 'Correct',
  distractors: ['Wrong A', 'Wrong B', 'Wrong C'],
  explanation: `Explanation for ${id}`,
  category_id: 'cat-1',
});

describe('fetchRandomQuestions', () => {
  it('calls supabase.rpc with general when all categories selected', async () => {
    rpc.mockResolvedValue({ data: [makeRow('q1')], error: null });

    await fetchRandomQuestions('Easy', ['general'], 5);

    expect(rpc).toHaveBeenCalledWith('random_published_questions_excluding', expect.objectContaining({
      p_difficulty: 'easy',
      p_category_slug: 'general',
    }));
  });

  it('calls supabase.rpc per category for multiple specific categories', async () => {
    rpc
      .mockResolvedValueOnce({ data: [makeRow('q1'), makeRow('q2')], error: null })
      .mockResolvedValueOnce({ data: [makeRow('q3')], error: null });

    const result = await fetchRandomQuestions('Medium', ['science', 'history'], 3);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('random_published_questions_excluding', expect.objectContaining({
      p_difficulty: 'normal',
      p_category_slug: 'science',
    }));
    expect(rpc).toHaveBeenCalledWith('random_published_questions_excluding', expect.objectContaining({
      p_difficulty: 'normal',
      p_category_slug: 'history',
    }));
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('maps RPC rows to LoadedQuestion with shuffled options and correct correctIndex', async () => {
    rpc.mockResolvedValue({ data: [makeRow('q1')], error: null });

    const result = await fetchRandomQuestions('Hard', ['history'], 1);

    expect(result).toHaveLength(1);
    const q = result[0]!;
    expect(q.id).toBe('q1');
    expect(q.question_text).toBe('Question q1');
    expect(q.options).toHaveLength(4);
    expect(q.options).toContain('Correct');
    expect(q.options[q.correctIndex]).toBe('Correct');
    expect(q.explanation).toBe('Explanation for q1');
  });

  it('throws on RPC error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    await expect(fetchRandomQuestions('Easy', ['general'], 5)).rejects.toEqual({
      message: 'DB error',
    });
  });

  it('throws on empty result', async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await expect(fetchRandomQuestions('Easy', ['general'], 5)).rejects.toThrow(
      'No questions found'
    );
  });

  it('throws when a question has fewer than 3 distractors', async () => {
    const bad = { ...makeRow('bad'), distractors: ['Wrong A'] };
    rpc.mockResolvedValue({ data: [bad], error: null });

    await expect(fetchRandomQuestions('Easy', ['general'], 1)).rejects.toThrow(
      'expected 4'
    );
  });

  it('throws when distractors is not an array', async () => {
    const bad = { ...makeRow('bad'), distractors: 'not-an-array' };
    rpc.mockResolvedValue({ data: [bad], error: null });

    await expect(fetchRandomQuestions('Easy', ['general'], 1)).rejects.toThrow(
      'expected 4'
    );
  });
});

describe('fetchCountsByRootCategory', () => {
  it('calls the counts_by_root_category RPC', async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await fetchCountsByRootCategory();

    expect(rpc).toHaveBeenCalledWith('counts_by_root_category');
  });

  it('groups rows by root_slug into easy/normal/hard buckets and sums total', async () => {
    rpc.mockResolvedValue({
      data: [
        { root_slug: 'science', difficulty: 'easy', question_count: 5 },
        { root_slug: 'science', difficulty: 'normal', question_count: 7 },
        { root_slug: 'science', difficulty: 'hard', question_count: 3 },
        { root_slug: 'history', difficulty: 'easy', question_count: 4 },
      ],
      error: null,
    });

    const result = await fetchCountsByRootCategory();

    expect(result).toEqual({
      science: { easy: 5, normal: 7, hard: 3, total: 15 },
      history: { easy: 4, normal: 0, hard: 0, total: 4 },
    });
  });

  it('defaults missing difficulties to 0 and still computes total', async () => {
    rpc.mockResolvedValue({
      data: [{ root_slug: 'music', difficulty: 'hard', question_count: 2 }],
      error: null,
    });

    const result = await fetchCountsByRootCategory();

    expect(result.music).toEqual({ easy: 0, normal: 0, hard: 2, total: 2 });
  });

  it('returns an empty object when data is null', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    const result = await fetchCountsByRootCategory();

    expect(result).toEqual({});
  });

  it('throws when the RPC returns an error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    await expect(fetchCountsByRootCategory()).rejects.toEqual({ message: 'DB error' });
  });
});
