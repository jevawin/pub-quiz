// Drift repair 260419-oxa:
// - Added runCalibratorAgent mock (calibrator agent was added to run-pipeline.ts after this test was written).
// - Added createClaudeClient export to the claude.js mock so calibrator's transitive dependency
//   resolves cleanly (previously Test 3/Test 10 failed because the pipeline threw on missing mock export,
//   short-circuiting the success path and the "Pipeline complete" log).
// Update 260529-slk:
// - Concurrent-run guard no longer uses .limit(1); the mock's select().eq() now resolves directly.
// - Pipeline now runs a month-to-date spend query: select('estimated_cost_usd').gte('started_at', since).
//   The mock's select().gte() resolves to monthSpendRows.
// - A mid-run BudgetExceededError is now a CLEAN stop (status=success, exit 0), not a failure.
// - Stale 'running' rows (older than the staleness threshold) are reclaimed and the run proceeds.
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock process.exit before any imports
const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

// Mock logger
vi.mock('../src/lib/logger.js', () => ({
  log: vi.fn(),
}));

// Mock config
vi.mock('../src/lib/config.js', () => ({
  loadConfig: vi.fn(),
}));

// Mock claude
vi.mock('../src/lib/claude.js', () => ({
  createClaudeClient: vi.fn(() => ({ messages: { create: vi.fn() } })),
  createTokenAccumulator: vi.fn(() => ({
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: 0,
  })),
  BudgetExceededError: class BudgetExceededError extends Error {
    constructor(public readonly accumulated: number, public readonly budget: number) {
      super(`Budget exceeded: $${accumulated.toFixed(4)} spent, budget is $${budget.toFixed(2)}`);
      this.name = 'BudgetExceededError';
    }
  },
}));

// Mock supabase
const mockSupabaseFrom = vi.fn();
vi.mock('../src/lib/supabase.js', () => ({
  createSupabaseClient: vi.fn(() => ({
    from: mockSupabaseFrom,
  })),
}));

// Mock agents
vi.mock('../src/agents/category.js', () => ({
  runCategoryAgent: vi.fn(),
}));

vi.mock('../src/agents/knowledge.js', () => ({
  runKnowledgeAgent: vi.fn(),
}));

vi.mock('../src/agents/questions.js', () => ({
  runQuestionsAgent: vi.fn(),
}));

vi.mock('../src/agents/fact-check.js', () => ({
  runFactCheckAgent: vi.fn(),
}));

vi.mock('../src/agents/qa.js', () => ({
  runQaAgent: vi.fn(),
}));

vi.mock('../src/agents/enrichment.js', () => ({
  runEnrichmentAgent: vi.fn(),
}));

vi.mock('../src/agents/calibrator.js', () => ({
  runCalibratorAgent: vi.fn(),
}));

import { log } from '../src/lib/logger.js';
import { loadConfig } from '../src/lib/config.js';
import { createTokenAccumulator, BudgetExceededError } from '../src/lib/claude.js';
import { runCategoryAgent } from '../src/agents/category.js';
import { runKnowledgeAgent } from '../src/agents/knowledge.js';
import { runQuestionsAgent } from '../src/agents/questions.js';
import { runFactCheckAgent } from '../src/agents/fact-check.js';
import { runQaAgent } from '../src/agents/qa.js';
import { runEnrichmentAgent } from '../src/agents/enrichment.js';
import { runCalibratorAgent } from '../src/agents/calibrator.js';

import type { PipelineConfig } from '../src/lib/config.js';

function makeConfig(): PipelineConfig {
  return {
    anthropicApiKey: 'test-key',
    supabaseUrl: 'https://test.supabase.co',
    supabaseServiceRoleKey: 'test-service-key',
    budgetCapUsd: 10.0,
    monthlyBudgetUsd: 20.0,
    categoryBatchSize: 5,
    knowledgeBatchSize: 10,
    questionsBatchSize: 20,
    claudeModelGeneration: 'claude-sonnet-4-5-20250514',
    claudeModelVerification: 'claude-haiku-4-5-20250514',
    claudeModelAudit: 'claude-opus-4-6',
    wikipediaUserAgent: 'TestAgent/1.0',
    wikipediaMaxContentLength: 3000,
    relevanceThreshold: 0.6,
  };
}

interface PipelineRunsMockOptions {
  // Rows returned by the concurrent-run guard query (status=running).
  runningRows?: Array<{ id: string; started_at: string }>;
  // Rows returned by the month-to-date spend query (estimated_cost_usd).
  monthSpendRows?: Array<{ estimated_cost_usd: number | null }>;
  insertedRun?: { id: string };
  updateError?: boolean;
}

interface PipelineRunsMock {
  table: {
    select: Mock;
    insert: Mock;
    update: Mock;
  };
  insert: Mock;
  update: Mock;
}

// Builds a mock of the pipeline_runs table that supports BOTH reads the
// pipeline performs:
//   - guard:  select('id, started_at').eq('status','running')   -> awaited directly
//   - budget: select('estimated_cost_usd').gte('started_at', s)  -> awaited directly
function makePipelineRunsMock(options: PipelineRunsMockOptions = {}): PipelineRunsMock {
  const {
    runningRows = [],
    monthSpendRows = [],
    insertedRun = { id: 'run-123' },
    updateError = false,
  } = options;

  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: insertedRun, error: null }),
    }),
  });

  // update() is chained two ways:
  //   .update({...}).eq('id', id)        — normal status writes
  //   .update({...}).in('id', staleIds)  — stale-lock reclaim
  const update = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({
      data: null,
      error: updateError ? { message: 'Update failed' } : null,
    }),
    in: vi.fn().mockResolvedValue({
      data: null,
      error: updateError ? { message: 'Update failed' } : null,
    }),
  });

  const select = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ data: runningRows, error: null }),
    gte: vi.fn().mockResolvedValue({ data: monthSpendRows, error: null }),
  }));

  const table = { select, insert, update };
  return { table, insert, update };
}

function installPipelineRunsMock(options: PipelineRunsMockOptions = {}): PipelineRunsMock {
  const mock = makePipelineRunsMock(options);
  mockSupabaseFrom.mockImplementation((table: string) =>
    table === 'pipeline_runs' ? mock.table : {},
  );
  return mock;
}

// A 'running' row recent enough to count as live (well within the staleness window).
function recentIso(): string {
  return new Date(Date.now() - 60_000).toISOString(); // 1 min ago
}

describe('runPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExit.mockClear();
    (loadConfig as Mock).mockReturnValue(makeConfig());
    (runCategoryAgent as Mock).mockResolvedValue({ processed: 5, failed: 0 });
    (runKnowledgeAgent as Mock).mockResolvedValue({ processed: 10, failed: 0 });
    (runQuestionsAgent as Mock).mockResolvedValue({ processed: 20, failed: 0 });
    (runFactCheckAgent as Mock).mockResolvedValue({ processed: 15, failed: 2 });
    (runQaAgent as Mock).mockResolvedValue({ processed: 12, failed: 1, rewritten: 3 });
    (runEnrichmentAgent as Mock).mockResolvedValue({ enriched: 10, skipped: 1, failed: 1 });
    (runCalibratorAgent as Mock).mockResolvedValue({ processed: 0, recalibrated: 0, failed: 0 });
  });

  it('Test 1: calls agents in order: category -> questions -> fact-check -> qa -> enrichment', async () => {
    installPipelineRunsMock({});
    const callOrder: string[] = [];

    (runCategoryAgent as Mock).mockImplementation(async () => {
      callOrder.push('category');
      return { processed: 5, failed: 0 };
    });
    (runQuestionsAgent as Mock).mockImplementation(async () => {
      callOrder.push('questions');
      return { processed: 20, failed: 0 };
    });
    (runFactCheckAgent as Mock).mockImplementation(async () => {
      callOrder.push('fact-check');
      return { processed: 15, failed: 2 };
    });
    (runQaAgent as Mock).mockImplementation(async () => {
      callOrder.push('qa');
      return { processed: 12, failed: 1, rewritten: 3 };
    });
    (runEnrichmentAgent as Mock).mockImplementation(async () => {
      callOrder.push('enrichment');
      return { enriched: 10, skipped: 1, failed: 1 };
    });

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(callOrder).toEqual(['category', 'questions', 'fact-check', 'qa', 'enrichment']);
  });

  it('Test 2: creates a pipeline_runs record with status=running at start', async () => {
    const { insert } = installPipelineRunsMock({});

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running' }),
    );
  });

  it('Test 3: on success, updates pipeline_runs with status=success, metrics, token totals', async () => {
    const { update } = installPipelineRunsMock({});

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        categories_processed: 5,
        categories_failed: 0,
        sources_fetched: 0,
        sources_failed: 0,
        questions_generated: 20,
        questions_failed: 0,
        questions_verified: 15,
        questions_rejected: 2,
        questions_qa_passed: 12,
        questions_qa_rewritten: 3,
        questions_qa_rejected: 1,
        questions_enriched: 10,
      }),
    );
  });

  it('Test 4: on agent failure, pipeline stops and updates with status=failed and error_message', async () => {
    (runQuestionsAgent as Mock).mockRejectedValue(new Error('Questions generation failed'));
    const { update } = installPipelineRunsMock({});

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error_message: 'Questions generation failed',
      }),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('Test 5: BudgetExceededError is a clean stop (status=success, exit 0)', async () => {
    (runQuestionsAgent as Mock).mockRejectedValue(new BudgetExceededError(5.0, 1.0));
    const { update } = installPipelineRunsMock({});

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    // Recorded as success with a note, not a failure.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        error_message: expect.stringContaining('budget cap'),
      }),
    );
    expect(mockExit).toHaveBeenCalledWith(0);
    // Later agents should not run after the budget stop.
    expect(runFactCheckAgent).not.toHaveBeenCalled();
  });

  it('Test 6: partial work from earlier agents is preserved (later agents not called on failure)', async () => {
    (runQuestionsAgent as Mock).mockRejectedValue(new Error('Questions failed'));
    installPipelineRunsMock({});

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(runCategoryAgent).toHaveBeenCalled();
    expect(runQuestionsAgent).toHaveBeenCalled();
    expect(runFactCheckAgent).not.toHaveBeenCalled();
    expect(runQaAgent).not.toHaveBeenCalled();
    expect(runEnrichmentAgent).not.toHaveBeenCalled();
  });

  it('Test 7: config snapshot is saved in pipeline_runs.config', async () => {
    const { insert } = installPipelineRunsMock({});

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          categoryBatchSize: 5,
          knowledgeBatchSize: 10,
          questionsBatchSize: 20,
          // Effective per-run cap = min(per-run ceiling 10, monthly remaining 20).
          budgetCapUsd: 10.0,
          monthlyBudgetUsd: 20.0,
        }),
      }),
    );
  });

  it('Test 8: process.exit(1) is called on failure', async () => {
    (runCategoryAgent as Mock).mockRejectedValue(new Error('Category failed'));
    installPipelineRunsMock({});

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('Test 9: if a LIVE running pipeline exists, logs warning and exits with code 0', async () => {
    installPipelineRunsMock({
      runningRows: [{ id: 'existing-run-456', started_at: recentIso() }],
    });

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(mockExit).toHaveBeenCalledWith(0);
    expect(runCategoryAgent).not.toHaveBeenCalled();
    expect(runKnowledgeAgent).not.toHaveBeenCalled();
    expect(runQuestionsAgent).not.toHaveBeenCalled();
    expect(runFactCheckAgent).not.toHaveBeenCalled();
    expect(runQaAgent).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('already in progress'),
      expect.objectContaining({ existing_run_id: 'existing-run-456' }),
    );
  });

  it('Test 10: uses log() from logger.ts for all output', async () => {
    installPipelineRunsMock({});

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('Category Agent'), expect.anything());
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('Questions Agent'), expect.anything());
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('Fact-Check Agent'), expect.anything());
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('QA Agent'), expect.anything());
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('Pipeline complete'), expect.anything());
  });

  it('Test 11: QA Agent failure is handled like other agent failures', async () => {
    (runQaAgent as Mock).mockRejectedValue(new Error('QA processing failed'));
    const { update } = installPipelineRunsMock({});

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error_message: 'QA processing failed',
      }),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('Test 12: stops cleanly (exit 0) when the monthly budget is exhausted', async () => {
    installPipelineRunsMock({
      runningRows: [],
      // $20 spent this month against a $20 cap -> nothing left.
      monthSpendRows: [{ estimated_cost_usd: 20.0 }],
    });

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(mockExit).toHaveBeenCalledWith(0);
    expect(runCategoryAgent).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('Monthly budget reached'),
      expect.anything(),
    );
  });

  it('Test 13: a stale running row is reclaimed and the run proceeds', async () => {
    const staleStart = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago > 40min
    const { update } = installPipelineRunsMock({
      runningRows: [{ id: 'stale-run-999', started_at: staleStart }],
    });

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    // The stale row is marked failed via an update...
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error_message: expect.stringContaining('stale'),
      }),
    );
    // ...and the pipeline proceeds rather than exiting.
    expect(runCategoryAgent).toHaveBeenCalled();
  });
});
