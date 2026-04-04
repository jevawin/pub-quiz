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

import { log } from '../src/lib/logger.js';
import { loadConfig } from '../src/lib/config.js';
import { createTokenAccumulator, BudgetExceededError } from '../src/lib/claude.js';
import { runCategoryAgent } from '../src/agents/category.js';
import { runKnowledgeAgent } from '../src/agents/knowledge.js';
import { runQuestionsAgent } from '../src/agents/questions.js';
import { runFactCheckAgent } from '../src/agents/fact-check.js';

import type { PipelineConfig } from '../src/lib/config.js';

function makeConfig(): PipelineConfig {
  return {
    anthropicApiKey: 'test-key',
    supabaseUrl: 'https://test.supabase.co',
    supabaseServiceRoleKey: 'test-service-key',
    budgetCapUsd: 10.0,
    categoryBatchSize: 5,
    knowledgeBatchSize: 10,
    questionsBatchSize: 20,
    claudeModelGeneration: 'claude-sonnet-4-5-20250514',
    claudeModelVerification: 'claude-haiku-4-5-20250514',
    wikipediaUserAgent: 'TestAgent/1.0',
    wikipediaMaxContentLength: 3000,
  };
}

// Helper to set up Supabase mock chains
function setupSupabaseMock(options: {
  runningPipelines?: unknown[];
  insertedRun?: { id: string };
  updateError?: boolean;
}) {
  const {
    runningPipelines = [],
    insertedRun = { id: 'run-123' },
    updateError = false,
  } = options;

  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === 'pipeline_runs') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: runningPipelines,
              error: null,
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: insertedRun,
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: null,
            error: updateError ? { message: 'Update failed' } : null,
          }),
        }),
      };
    }
    return {};
  });
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
  });

  it('Test 1: calls agents in order: category -> knowledge -> questions -> fact-check', async () => {
    setupSupabaseMock({});
    const callOrder: string[] = [];

    (runCategoryAgent as Mock).mockImplementation(async () => {
      callOrder.push('category');
      return { processed: 5, failed: 0 };
    });
    (runKnowledgeAgent as Mock).mockImplementation(async () => {
      callOrder.push('knowledge');
      return { processed: 10, failed: 0 };
    });
    (runQuestionsAgent as Mock).mockImplementation(async () => {
      callOrder.push('questions');
      return { processed: 20, failed: 0 };
    });
    (runFactCheckAgent as Mock).mockImplementation(async () => {
      callOrder.push('fact-check');
      return { processed: 15, failed: 2 };
    });

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(callOrder).toEqual(['category', 'knowledge', 'questions', 'fact-check']);
  });

  it('Test 2: creates a pipeline_runs record with status=running at start', async () => {
    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'run-123' },
          error: null,
        }),
      }),
    });

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'pipeline_runs') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          }),
          insert: mockInsert,
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        };
      }
      return {};
    });

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running' }),
    );
  });

  it('Test 3: on success, updates pipeline_runs with status=success, metrics, token totals', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'pipeline_runs') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'run-123' }, error: null }),
            }),
          }),
          update: mockUpdate,
        };
      }
      return {};
    });

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        categories_processed: 5,
        categories_failed: 0,
        sources_fetched: 10,
        sources_failed: 0,
        questions_generated: 20,
        questions_failed: 0,
        questions_verified: 15,
        questions_rejected: 2,
      }),
    );
  });

  it('Test 4: on agent failure, pipeline stops and updates with status=failed and error_message', async () => {
    (runKnowledgeAgent as Mock).mockRejectedValue(new Error('Wikipedia API is down'));

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'pipeline_runs') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'run-123' }, error: null }),
            }),
          }),
          update: mockUpdate,
        };
      }
      return {};
    });

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error_message: 'Wikipedia API is down',
      }),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('Test 5: BudgetExceededError is caught and recorded as failure', async () => {
    (runQuestionsAgent as Mock).mockRejectedValue(
      new BudgetExceededError(5.0, 1.0),
    );

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'pipeline_runs') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'run-123' }, error: null }),
            }),
          }),
          update: mockUpdate,
        };
      }
      return {};
    });

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error_message: expect.stringContaining('Budget exceeded'),
      }),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('Test 6: partial work from earlier agents is preserved (later agents not called on failure)', async () => {
    (runKnowledgeAgent as Mock).mockRejectedValue(new Error('Knowledge failed'));

    setupSupabaseMock({});

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    // Category ran, knowledge threw, questions and fact-check should NOT be called
    expect(runCategoryAgent).toHaveBeenCalled();
    expect(runKnowledgeAgent).toHaveBeenCalled();
    expect(runQuestionsAgent).not.toHaveBeenCalled();
    expect(runFactCheckAgent).not.toHaveBeenCalled();
  });

  it('Test 7: config snapshot is saved in pipeline_runs.config', async () => {
    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'run-123' }, error: null }),
      }),
    });

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'pipeline_runs') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
          insert: mockInsert,
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        };
      }
      return {};
    });

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          categoryBatchSize: 5,
          knowledgeBatchSize: 10,
          questionsBatchSize: 20,
          budgetCapUsd: 10.0,
        }),
      }),
    );
  });

  it('Test 8: process.exit(1) is called on failure', async () => {
    (runCategoryAgent as Mock).mockRejectedValue(new Error('Category failed'));
    setupSupabaseMock({});

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('Test 9: if a running pipeline exists, logs warning and exits with code 0', async () => {
    setupSupabaseMock({
      runningPipelines: [{ id: 'existing-run-456', started_at: '2026-04-04T10:00:00Z' }],
    });

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    expect(mockExit).toHaveBeenCalledWith(0);
    expect(runCategoryAgent).not.toHaveBeenCalled();
    expect(runKnowledgeAgent).not.toHaveBeenCalled();
    expect(runQuestionsAgent).not.toHaveBeenCalled();
    expect(runFactCheckAgent).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('already in progress'),
      expect.objectContaining({ existing_run_id: 'existing-run-456' }),
    );
  });

  it('Test 10: uses log() from logger.ts for all output', async () => {
    setupSupabaseMock({});

    const { runPipeline } = await import('../src/run-pipeline.js');
    await runPipeline();

    // Verify log was called for each agent start/complete
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('Category Agent'), expect.anything());
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('Knowledge Agent'), expect.anything());
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('Questions Agent'), expect.anything());
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('Fact-Check Agent'), expect.anything());
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('Pipeline complete'), expect.anything());
  });
});
