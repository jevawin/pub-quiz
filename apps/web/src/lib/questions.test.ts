import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc, getSeenIdsMock } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSeenIdsMock: vi.fn<() => string[]>(() => []),
}));

vi.mock('./supabase', () => ({
  supabase: { rpc },
}));

vi.mock('./seen-store', () => ({
  getViewCounts: (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 0])),
  getSeenIds: () => getSeenIdsMock(),
}));

import {
  fetchRandomQuestions,
  fetchCountsByRootCategory,
  countAvailableQuestions,
  interleaveByCategory,
  type RpcRow,
} from './questions';

beforeEach(() => {
  rpc.mockReset();
  getSeenIdsMock.mockReset();
  getSeenIdsMock.mockReturnValue([]);
});

const makeRow = (id: string, category_slug = 'general') => ({
  id,
  question_text: `Question ${id}`,
  correct_answer: 'Correct',
  distractors: ['Wrong A', 'Wrong B', 'Wrong C'],
  explanation: `Explanation for ${id}`,
  fun_fact: null,
  category_id: 'cat-1',
  category_slug,
});

describe('fetchRandomQuestions', () => {
  it('calls random_published_questions_excluding with full score range and "general" when all categories selected', async () => {
    rpc.mockResolvedValue({ data: [makeRow('q1')], error: null });

    await fetchRandomQuestions('Mixed', ['general'], 5);

    expect(rpc).toHaveBeenCalledWith('random_published_questions_excluding', expect.objectContaining({
      p_score_min: 0,
      p_score_max: 100,
      p_category_slug: 'general',
    }));
  });

  it('passes Easy as 67..100 score range', async () => {
    rpc.mockResolvedValue({ data: [makeRow('q1')], error: null });

    await fetchRandomQuestions('Easy', ['general'], 5);

    expect(rpc).toHaveBeenCalledWith('random_published_questions_excluding', expect.objectContaining({
      p_score_min: 67,
      p_score_max: 100,
    }));
  });

  it('calls supabase.rpc per category for multiple specific categories with the same score range', async () => {
    rpc
      .mockResolvedValueOnce({ data: [makeRow('q1'), makeRow('q2')], error: null })
      .mockResolvedValueOnce({ data: [makeRow('q3')], error: null });

    const result = await fetchRandomQuestions('Medium', ['science', 'history'], 3);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('random_published_questions_excluding', expect.objectContaining({
      p_score_min: 34,
      p_score_max: 66,
      p_category_slug: 'science',
    }));
    expect(rpc).toHaveBeenCalledWith('random_published_questions_excluding', expect.objectContaining({
      p_score_min: 34,
      p_score_max: 66,
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

describe('fetchRandomQuestions — within-session dedupe', () => {
  it('returns each ID at most once when sub-batches share IDs', async () => {
    rpc
      .mockResolvedValueOnce({ data: [makeRow('q1', 'science'), makeRow('q2', 'science')], error: null })
      .mockResolvedValueOnce({ data: [makeRow('q2', 'history'), makeRow('q3', 'history')], error: null });

    const result = await fetchRandomQuestions('Easy', ['science', 'history'], 5);

    const ids = result.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('q1');
    expect(ids).toContain('q3');
  });

  it('final returned array has no duplicate IDs even with overlapping sub-batches', async () => {
    rpc
      .mockResolvedValueOnce({ data: [makeRow('q1'), makeRow('q2'), makeRow('dup')], error: null })
      .mockResolvedValueOnce({ data: [makeRow('dup'), makeRow('q3')], error: null });

    const result = await fetchRandomQuestions('Medium', ['a', 'b'], 4);
    const ids = result.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns short array when unseen pool is too small — no fallback fetch with empty exclude list', async () => {
    getSeenIdsMock.mockReturnValue(['seen-a', 'seen-b']);
    rpc.mockResolvedValueOnce({ data: [makeRow('q1'), makeRow('q2')], error: null });

    const result = await fetchRandomQuestions('Easy', ['general'], 5);

    expect(result).toHaveLength(2);
    expect(rpc).toHaveBeenCalledTimes(1);
    const callsWithEmptyExclude = rpc.mock.calls.filter(
      ([fn, args]) =>
        fn === 'random_published_questions_excluding' &&
        Array.isArray(args?.p_exclude_ids) &&
        args.p_exclude_ids.length === 0,
    );
    expect(callsWithEmptyExclude).toHaveLength(0);
  });
});

describe('countAvailableQuestions', () => {
  it('calls count_available_questions once with the slug array and score range', async () => {
    rpc.mockResolvedValue({ data: 14, error: null });

    const total = await countAvailableQuestions('Hard', ['science', 'history'], false);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('count_available_questions', expect.objectContaining({
      p_score_min: 0,
      p_score_max: 33,
      p_category_slugs: ['science', 'history'],
      p_exclude_ids: [],
    }));
    expect(total).toBe(14);
  });

  it('passes seen IDs as p_exclude_ids when excludeSeen=true', async () => {
    getSeenIdsMock.mockReturnValue(['s1', 's2']);
    rpc.mockResolvedValue({ data: 0, error: null });

    await countAvailableQuestions('Mixed', ['general'], true);

    expect(rpc).toHaveBeenCalledWith('count_available_questions', expect.objectContaining({
      p_score_min: 0,
      p_score_max: 100,
      p_category_slugs: ['general'],
      p_exclude_ids: ['s1', 's2'],
    }));
  });
});

describe('interleaveByCategory', () => {
  const rowOf = (id: string, slug: string): RpcRow => ({
    id,
    question_text: id,
    correct_answer: 'c',
    distractors: ['a', 'b', 'd'],
    explanation: null,
    fun_fact: null,
    category_id: 'cat',
    category_slug: slug,
  });

  it('breaks adjacency when alternatives exist', () => {
    const input = [
      rowOf('A1', 'A'),
      rowOf('A2', 'A'),
      rowOf('B1', 'B'),
      rowOf('C1', 'C'),
      rowOf('A3', 'A'),
    ];
    const out = interleaveByCategory(input);

    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.category_slug).not.toBe(out[i - 1]!.category_slug);
    }
  });

  it('is a no-op when all items share the same category', () => {
    const input = [
      rowOf('A1', 'A'),
      rowOf('A2', 'A'),
      rowOf('A3', 'A'),
    ];
    const out = interleaveByCategory(input);
    expect(out.map((r) => r.id)).toEqual(['A1', 'A2', 'A3']);
  });

  it('preserves length and IDs (no drops, no dupes)', () => {
    const input = [
      rowOf('A1', 'A'),
      rowOf('A2', 'A'),
      rowOf('B1', 'B'),
      rowOf('C1', 'C'),
      rowOf('A3', 'A'),
    ];
    const out = interleaveByCategory(input);
    expect(out).toHaveLength(input.length);
    expect(new Set(out.map((r) => r.id)).size).toBe(input.length);
    expect(new Set(out.map((r) => r.id))).toEqual(new Set(input.map((r) => r.id)));
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
