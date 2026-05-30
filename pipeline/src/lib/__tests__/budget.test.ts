import { describe, it, expect } from 'vitest';
import { monthStartIso, getMonthToDateSpendUsd } from '../budget.js';
import type { TypedSupabaseClient } from '../supabase.js';

/**
 * Minimal mock of the supabase surface budget.ts uses:
 *   supabase.from('pipeline_runs').select('estimated_cost_usd').gte('started_at', since)
 * which resolves to { data, error }.
 */
function mockSupabase(
  result: { data: Array<{ estimated_cost_usd: number | null }> | null; error: { message: string } | null },
  capture?: (table: string, column: string, since: string) => void,
): TypedSupabaseClient {
  return {
    from(table: string) {
      return {
        select(column: string) {
          return {
            gte(_col: string, since: string) {
              capture?.(table, column, since);
              return Promise.resolve(result);
            },
          };
        },
      };
    },
  } as unknown as TypedSupabaseClient;
}

describe('monthStartIso', () => {
  it('returns the first instant of the UTC month', () => {
    expect(monthStartIso(new Date('2026-05-29T23:13:00Z'))).toBe('2026-05-01T00:00:00.000Z');
  });

  it('handles January and end-of-month correctly', () => {
    expect(monthStartIso(new Date('2026-01-31T12:00:00Z'))).toBe('2026-01-01T00:00:00.000Z');
    expect(monthStartIso(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('getMonthToDateSpendUsd', () => {
  it('sums estimated_cost_usd across rows', async () => {
    const supabase = mockSupabase({
      data: [{ estimated_cost_usd: 1.5 }, { estimated_cost_usd: 2.25 }, { estimated_cost_usd: 0.1 }],
      error: null,
    });
    expect(await getMonthToDateSpendUsd(supabase, new Date('2026-05-29T00:00:00Z'))).toBeCloseTo(3.85, 6);
  });

  it('treats null/empty cost as zero', async () => {
    const supabase = mockSupabase({
      data: [{ estimated_cost_usd: null }, { estimated_cost_usd: 4 }],
      error: null,
    });
    expect(await getMonthToDateSpendUsd(supabase)).toBe(4);
  });

  it('returns 0 when no rows', async () => {
    const supabase = mockSupabase({ data: [], error: null });
    expect(await getMonthToDateSpendUsd(supabase)).toBe(0);
  });

  it('queries from the start of the current UTC month', async () => {
    let capturedSince = '';
    const supabase = mockSupabase({ data: [], error: null }, (_t, _c, since) => {
      capturedSince = since;
    });
    await getMonthToDateSpendUsd(supabase, new Date('2026-05-29T23:13:00Z'));
    expect(capturedSince).toBe('2026-05-01T00:00:00.000Z');
  });

  it('throws on query error', async () => {
    const supabase = mockSupabase({ data: null, error: { message: 'boom' } });
    await expect(getMonthToDateSpendUsd(supabase)).rejects.toThrow(/month-to-date spend.*boom/);
  });
});
