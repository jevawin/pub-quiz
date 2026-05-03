#!/usr/bin/env node
import { createSupabaseClient } from '../lib/supabase.js';
import {
  createClaudeClient,
  createTokenAccumulator,
  checkBudget,
  BudgetExceededError,
} from '../lib/claude.js';
import type { TokenAccumulator } from '../lib/claude.js';
import { calibrateQuestion } from '../agents/calibrator.js';
import { loadConfig } from '../lib/config.js';
import { log } from '../lib/logger.js';

const BATCH_SIZE = 50;

export async function backfillBatch(
  supabase: ReturnType<typeof createSupabaseClient>,
  tokenAcc: TokenAccumulator,
  batchLimit: number,
): Promise<{ processed: number; failed: number }> {
  const config = loadConfig();
  const claude = createClaudeClient(config.anthropicApiKey);

  // Fetch question IDs that already have question_categories rows
  const { data: existingIds } = await supabase
    .from('question_categories')
    .select('question_id');
  const doneSet = new Set((existingIds ?? []).map((r: { question_id: string }) => r.question_id));

  // Fetch published questions — over-fetch then filter client-side.
  // Phase 999.8 Plan 05 dropped questions.category_id, so we no longer pre-seed
  // calibrateQuestion with the legacy single-category slug; the calibrator picks
  // categories from scratch. The Plan 04 backfill is already complete on prod
  // (see 999.8-04-SUMMARY); this script remains as a fallback for any future
  // un-scored published rows.
  const fetchLimit = batchLimit + doneSet.size + 100;
  const { data: allPublished, error } = await supabase
    .from('questions')
    .select('id, question_text, correct_answer, distractors')
    .eq('status', 'published')
    .limit(fetchLimit);
  if (error) throw new Error(error.message);

  const todo = (allPublished ?? [])
    .filter((q: { id: string }) => !doneSet.has(q.id))
    .slice(0, batchLimit);

  let processed = 0,
    failed = 0;

  for (const q of todo as Array<{
    id: string;
    question_text: string;
    correct_answer: string;
    distractors: string[];
  }>) {
    const assigned_slugs: string[] = [];

    try {
      const result = await calibrateQuestion(
        supabase,
        tokenAcc,
        {
          id: q.id,
          question_text: q.question_text,
          correct_answer: q.correct_answer,
          distractors: q.distractors as string[],
          assigned_slugs,
        },
        claude,
        config,
      );
      if (result.success) {
        processed++;
      } else {
        log('warn', 'calibrate failed', { qid: q.id, err: result.error });
        failed++;
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      log('warn', 'calibrate threw', { qid: q.id, err: String(err) });
      failed++;
    }
  }

  return { processed, failed };
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const tokenAcc = createTokenAccumulator();
  let totalProcessed = 0,
    totalFailed = 0;

  while (true) {
    try {
      checkBudget(tokenAcc, config.budgetCapUsd);
    } catch (err) {
      log('error', 'Budget exceeded, halting', { cost_usd: tokenAcc.estimated_cost_usd });
      process.exit(2);
    }

    const res = await backfillBatch(supabase, tokenAcc, BATCH_SIZE);
    totalProcessed += res.processed;
    totalFailed += res.failed;

    if (res.processed + res.failed === 0) break;
    log('info', 'Batch complete', {
      totalProcessed,
      totalFailed,
      cost_usd: tokenAcc.estimated_cost_usd,
    });
  }

  log('info', 'Backfill complete', {
    totalProcessed,
    totalFailed,
    cost_usd: tokenAcc.estimated_cost_usd,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    log('error', 'Backfill failed', { err: String(err) });
    process.exit(1);
  });
}
