import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabase: { rpc },
}));

import { fetchRandomQuestions } from './questions';

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
  it('calls supabase.rpc with correct params (translated difficulty)', async () => {
    rpc.mockResolvedValue({ data: [makeRow('q1')], error: null });

    await fetchRandomQuestions('Medium', 'science-and-nature', 10);

    expect(rpc).toHaveBeenCalledWith('random_published_questions', {
      p_difficulty: 'normal',
      p_category_slug: 'science-and-nature',
      p_limit: 10,
    });
  });

  it('passes general as p_category_slug for the general category', async () => {
    rpc.mockResolvedValue({ data: [makeRow('q1')], error: null });

    await fetchRandomQuestions('Easy', 'general', 5);

    expect(rpc).toHaveBeenCalledWith('random_published_questions', {
      p_difficulty: 'easy',
      p_category_slug: 'general',
      p_limit: 5,
    });
  });

  it('maps RPC rows to LoadedQuestion with shuffled options and correct correctIndex', async () => {
    rpc.mockResolvedValue({ data: [makeRow('q1')], error: null });

    const result = await fetchRandomQuestions('Hard', 'history', 1);

    expect(result).toHaveLength(1);
    const q = result[0]!;
    expect(q.id).toBe('q1');
    expect(q.question_text).toBe('Question q1');
    expect(q.options).toHaveLength(4);
    expect(q.options).toContain('Correct');
    expect(q.options).toContain('Wrong A');
    expect(q.options).toContain('Wrong B');
    expect(q.options).toContain('Wrong C');
    // correctIndex must point to the correct answer regardless of shuffle order
    expect(q.options[q.correctIndex]).toBe('Correct');
    expect(q.explanation).toBe('Explanation for q1');
  });

  it('throws on RPC error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    await expect(fetchRandomQuestions('Easy', 'general', 5)).rejects.toEqual({
      message: 'DB error',
    });
  });

  it('throws on empty result', async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await expect(fetchRandomQuestions('Easy', 'general', 5)).rejects.toThrow(
      'No questions returned'
    );
  });
});
