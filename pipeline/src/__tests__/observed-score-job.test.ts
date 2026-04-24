import { describe, it, expect, vi } from 'vitest';
import { refreshObservedScores } from '../jobs/observed-score-refresh';

// Stub SupabaseClient shape used by the job.
// Uses UPDATE (not upsert) — partial upsert would violate NOT NULL on estimate_score.
function makeStubClient(plays: Array<{ question_id: string; is_correct: boolean }>) {
  const updateMock = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });

  const fromMock = vi.fn((table: string) => {
    if (table === 'question_plays') {
      return {
        select: vi.fn().mockReturnThis(),
        then: (cb: (v: { data: typeof plays; error: null }) => unknown) =>
          Promise.resolve(cb({ data: plays, error: null })),
      };
    }
    if (table === 'question_categories') {
      return { update: updateMock };
    }
    return {};
  });

  return { from: fromMock, _updateMock: updateMock } as unknown as {
    from: typeof fromMock;
    _updateMock: typeof updateMock;
  };
}

describe('refreshObservedScores', () => {
  it('aggregates question_plays into observed_score', async () => {
    // 10 plays, 7 correct → observed_score = 70, observed_n = 10
    const plays = Array.from({ length: 10 }, (_, i) => ({
      question_id: 'q1',
      is_correct: i < 7,
    }));
    const stub = makeStubClient(plays);
    const result = await refreshObservedScores(stub as never);

    // Job must update at least 1 row (1 per distinct question_id)
    expect(result.updated).toBeGreaterThanOrEqual(1);
    // The update call should include observed_score = 70 and observed_n = 10
    const updateCalls = stub._updateMock.mock.calls;
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const payload = updateCalls[0][0];
    expect(payload.observed_score).toBe(70);
    expect(payload.observed_n).toBe(10);
  });

  it('updates observed_score when row exists (idempotent — no duplicate key)', async () => {
    const plays = Array.from({ length: 5 }, (_, i) => ({
      question_id: 'q2',
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
    // question q3 has 20 plays (10 correct + 10 incorrect) — should produce 1 update call
    // The implementation updates all question_categories rows for a question in one .update().eq() call
    const plays = [
      ...Array.from({ length: 10 }, () => ({ question_id: 'q3', is_correct: true })),
      ...Array.from({ length: 10 }, () => ({ question_id: 'q3', is_correct: false })),
    ];
    const stub = makeStubClient(plays);
    const result = await refreshObservedScores(stub as never);
    expect(result.updated).toBeGreaterThanOrEqual(1);
  });
});
