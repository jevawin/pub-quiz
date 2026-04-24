import { describe, it, expect, vi } from 'vitest';
import { refreshObservedScores } from '../jobs/observed-score-refresh';

// Wave 0 — RED scaffolds.
// observed-score-refresh.ts does not exist yet — Wave 3 creates it.
// Expected failure mode: "Cannot find module '../jobs/observed-score-refresh'"

// Stub SupabaseClient shape used by the job
function makeStubClient(plays: Array<{ question_id: string; category_id: string; is_correct: boolean }>) {
  const upsertMock = vi.fn().mockResolvedValue({ error: null });

  const fromMock = vi.fn((table: string) => {
    if (table === 'question_plays') {
      return {
        select: vi.fn().mockReturnThis(),
        data: plays,
        error: null,
        then: (cb: (v: { data: typeof plays; error: null }) => unknown) =>
          Promise.resolve(cb({ data: plays, error: null })),
      };
    }
    if (table === 'question_categories') {
      return { upsert: upsertMock };
    }
    return {};
  });

  return { from: fromMock, _upsertMock: upsertMock } as unknown as {
    from: typeof fromMock;
    _upsertMock: typeof upsertMock;
  };
}

describe('refreshObservedScores', () => {
  it('aggregates question_plays into observed_score', async () => {
    // 10 plays, 7 correct → observed_score = 70, observed_n = 10
    const plays = Array.from({ length: 10 }, (_, i) => ({
      question_id: 'q1',
      category_id: 'cat1',
      is_correct: i < 7,
    }));
    const stub = makeStubClient(plays);
    const result = await refreshObservedScores(stub as never);

    // Job must update at least 1 row
    expect(result.updated).toBeGreaterThanOrEqual(1);
    // The upsert call should include observed_score = 70 and observed_n = 10
    const upsertCalls = stub._upsertMock.mock.calls;
    expect(upsertCalls.length).toBeGreaterThanOrEqual(1);
    const payload = upsertCalls[0][0];
    const row = Array.isArray(payload) ? payload[0] : payload;
    expect(row.observed_score).toBe(70);
    expect(row.observed_n).toBe(10);
  });

  it('upserts observed_score when row exists (no duplicate key)', async () => {
    const plays = Array.from({ length: 5 }, (_, i) => ({
      question_id: 'q2',
      category_id: 'cat1',
      is_correct: i < 3,
    }));
    const stub = makeStubClient(plays);
    // Run twice — both should succeed without error
    await refreshObservedScores(stub as never);
    const result2 = await refreshObservedScores(stub as never);
    expect(result2.updated).toBeGreaterThanOrEqual(1);
  });

  it('skips questions with zero plays', async () => {
    // No plays at all — nothing to aggregate
    const stub = makeStubClient([]);
    const result = await refreshObservedScores(stub as never);
    expect(result.updated).toBe(0);
  });

  it('aggregates per (question_id, category_id) pair', async () => {
    // question q3 in two categories, 10 plays each → 2 rows updated
    const playsA = Array.from({ length: 10 }, () => ({
      question_id: 'q3',
      category_id: 'catA',
      is_correct: true,
    }));
    const playsB = Array.from({ length: 10 }, () => ({
      question_id: 'q3',
      category_id: 'catB',
      is_correct: false,
    }));
    const stub = makeStubClient([...playsA, ...playsB]);
    const result = await refreshObservedScores(stub as never);
    expect(result.updated).toBeGreaterThanOrEqual(2);
  });
});
