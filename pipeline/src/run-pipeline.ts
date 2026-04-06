import 'dotenv/config';
import { loadConfig } from './lib/config.js';
import { createSupabaseClient } from './lib/supabase.js';
import { createTokenAccumulator } from './lib/claude.js';
import { log } from './lib/logger.js';
import { runCategoryAgent } from './agents/category.js';
import { runKnowledgeAgent } from './agents/knowledge.js';
import { runQuestionsAgent } from './agents/questions.js';
import { runFactCheckAgent } from './agents/fact-check.js';
import { runQaAgent } from './agents/qa.js';
import { runEnrichmentAgent } from './agents/enrichment.js';
import { runCalibratorAgent } from './agents/calibrator.js';

export async function runPipeline(): Promise<void> {
  // 1. Load config
  const config = loadConfig();
  log('info', 'Pipeline starting', { budgetCapUsd: config.budgetCapUsd });

  // 2. Create Supabase client
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);

  // 3. Concurrent run guard
  const { data: running } = await supabase
    .from('pipeline_runs')
    .select('id, started_at')
    .eq('status', 'running')
    .limit(1);

  if (running && running.length > 0) {
    log('warn', 'Another pipeline run is already in progress, skipping this run', {
      existing_run_id: running[0].id,
      started_at: running[0].started_at,
    });
    process.exit(0);
    return; // unreachable, but helps TS understand control flow
  }

  // 4. Create shared token accumulator
  const tokenAccumulator = createTokenAccumulator();

  // 5. Create pipeline_runs record
  const { data: run, error: insertError } = await supabase
    .from('pipeline_runs')
    .insert({
      status: 'running',
      config: {
        categoryBatchSize: config.categoryBatchSize,
        knowledgeBatchSize: config.knowledgeBatchSize,
        questionsBatchSize: config.questionsBatchSize,
        claudeModelGeneration: config.claudeModelGeneration,
        claudeModelVerification: config.claudeModelVerification,
        budgetCapUsd: config.budgetCapUsd,
      },
    })
    .select('id')
    .single();

  if (insertError || !run) {
    log('error', 'Failed to create pipeline_runs record', {
      error: insertError?.message ?? 'No data returned',
    });
    process.exit(1);
    return;
  }

  log('info', 'Pipeline run created', { runId: run.id });

  // 6. Run agents sequentially
  try {
    log('info', 'Starting Category Agent');
    const categoryResult = await runCategoryAgent(config, tokenAccumulator);
    log('info', 'Category Agent complete', {
      processed: categoryResult.processed,
      failed: categoryResult.failed,
    });

    // Knowledge Agent skipped — questions now generated from Claude's knowledge, not Wikipedia sources.
    // Wikipedia is used for fact-checking and enrichment only.

    log('info', 'Starting Questions Agent');
    const questionsResult = await runQuestionsAgent(config, tokenAccumulator);
    log('info', 'Questions Agent complete', {
      processed: questionsResult.processed,
      failed: questionsResult.failed,
    });

    log('info', 'Starting Fact-Check Agent');
    const factCheckResult = await runFactCheckAgent(config, tokenAccumulator);
    log('info', 'Fact-Check Agent complete', {
      processed: factCheckResult.processed,
      failed: factCheckResult.failed,
    });

    log('info', 'Starting QA Agent');
    const qaResult = await runQaAgent(config, tokenAccumulator);
    log('info', 'QA Agent complete', {
      processed: qaResult.processed,
      failed: qaResult.failed,
      rewritten: qaResult.rewritten,
    });

    log('info', 'Starting Enrichment Agent');
    const enrichmentResult = await runEnrichmentAgent(config, tokenAccumulator);
    log('info', 'Enrichment Agent complete', {
      enriched: enrichmentResult.enriched,
      skipped: enrichmentResult.skipped,
      failed: enrichmentResult.failed,
    });

    log('info', 'Starting Calibrator Agent');
    const calibratorResult = await runCalibratorAgent(config, tokenAccumulator);
    log('info', 'Calibrator Agent complete', {
      processed: calibratorResult.processed,
      recalibrated: calibratorResult.recalibrated,
      failed: calibratorResult.failed,
    });

    // Mark success
    await supabase
      .from('pipeline_runs')
      .update({
        status: 'success',
        completed_at: new Date().toISOString(),
        categories_processed: categoryResult.processed,
        categories_failed: categoryResult.failed,
        sources_fetched: 0,
        sources_failed: 0,
        questions_generated: questionsResult.processed,
        questions_failed: questionsResult.failed,
        questions_verified: factCheckResult.processed,
        questions_rejected: factCheckResult.failed,
        questions_qa_passed: qaResult.processed,
        questions_qa_rewritten: qaResult.rewritten,
        questions_qa_rejected: qaResult.failed,
        questions_enriched: enrichmentResult.enriched,
        questions_calibrated: calibratorResult.processed,
        questions_recalibrated: calibratorResult.recalibrated,
        total_input_tokens: tokenAccumulator.input_tokens,
        total_output_tokens: tokenAccumulator.output_tokens,
        estimated_cost_usd: tokenAccumulator.estimated_cost_usd,
      })
      .eq('id', run.id);

    log('info', 'Pipeline complete', {
      cost_usd: tokenAccumulator.estimated_cost_usd.toFixed(4),
    });
  } catch (error) {
    // Per D-07: stop and report, partial work is kept
    await supabase
      .from('pipeline_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : String(error),
        total_input_tokens: tokenAccumulator.input_tokens,
        total_output_tokens: tokenAccumulator.output_tokens,
        estimated_cost_usd: tokenAccumulator.estimated_cost_usd,
      })
      .eq('id', run.id);

    log('error', 'Pipeline failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

// Run when executed directly (not when imported as a module in tests)
const isDirectExecution =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('run-pipeline.ts') || process.argv[1].endsWith('run-pipeline.js'));

if (isDirectExecution) {
  runPipeline();
}
