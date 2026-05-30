import type { TypedSupabaseClient } from './supabase.js';

/**
 * First instant of the current UTC calendar month, as an ISO string.
 * Used as the lower bound for month-to-date spend queries.
 */
export function monthStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Sum of estimated_cost_usd across every pipeline_runs row started in the
 * current UTC calendar month. In-progress rows contribute their accumulated
 * cost so far (0 until they finish), so calling this before inserting the
 * current run's row avoids double-counting it.
 */
export async function getMonthToDateSpendUsd(
  supabase: TypedSupabaseClient,
  now: Date = new Date(),
): Promise<number> {
  const since = monthStartIso(now);
  const { data, error } = await supabase
    .from('pipeline_runs')
    .select('estimated_cost_usd')
    .gte('started_at', since);

  if (error) {
    throw new Error(`Failed to query month-to-date spend: ${error.message}`);
  }

  return (data ?? []).reduce(
    (sum, row) => sum + (Number((row as { estimated_cost_usd: number | null }).estimated_cost_usd) || 0),
    0,
  );
}
