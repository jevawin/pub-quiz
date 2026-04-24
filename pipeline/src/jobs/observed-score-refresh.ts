import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { loadConfig } from '../lib/config.js';
import { log } from '../lib/logger.js';

/**
 * Aggregates question_plays into question_categories.observed_score / observed_n.
 *
 * Approximation note (Pitfall 6): this counts every play against every category
 * the question is filed under, not only the category the player chose. Phase 2.2+
 * tightens this by joining through quiz_sessions.category_slug.
 */
export async function refreshObservedScores(
  supabase: SupabaseClient<Database>,
): Promise<{ updated: number }> {
  // 1. Aggregate plays per question
  const { data: plays, error } = await supabase
    .from('question_plays')
    .select('question_id, is_correct');
  if (error) throw error;

  const agg = new Map<string, { correct: number; total: number }>();
  for (const p of plays ?? []) {
    const cur = agg.get(p.question_id) ?? { correct: 0, total: 0 };
    cur.total += 1;
    if (p.is_correct) cur.correct += 1;
    agg.set(p.question_id, cur);
  }

  // 2. For each question_id with plays, update its question_categories rows
  // Using UPDATE (not UPSERT) because backfill always creates the rows first,
  // and a partial upsert would violate the NOT NULL constraint on estimate_score.
  let updated = 0;
  for (const [qid, counts] of agg) {
    const observed_score = Math.round((counts.correct / counts.total) * 100 * 100) / 100; // NUMERIC(5,2)
    const observed_n = counts.total;

    const { error: upErr } = await supabase
      .from('question_categories')
      .update({ observed_score, observed_n, updated_at: new Date().toISOString() })
      .eq('question_id', qid);

    if (upErr) {
      log('warn', 'update failed', { qid, err: upErr });
      continue;
    }

    updated += 1;
  }

  log('info', 'Observed-score refresh complete', { updated, distinct_questions: agg.size });
  return { updated };
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  refreshObservedScores(supabase)
    .then(r => {
      log('info', 'Done', r as unknown as Record<string, unknown>);
      process.exit(0);
    })
    .catch(err => {
      log('error', 'Refresh failed', { err: String(err) });
      process.exit(1);
    });
}
