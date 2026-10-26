import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the claude -p adapter; the real callGoverned runs on top of it
vi.mock('../../src/lib/claude-cli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/claude-cli.js')>();
  return { ...actual, callClaude: vi.fn() };
});

// Mock supabase
vi.mock('@supabase/supabase-js', () => {
  const mockFrom = vi.fn();
  return {
    createClient: vi.fn().mockImplementation(() => ({
      from: mockFrom,
    })),
    __mockFrom: mockFrom,
  };
});

import type { PipelineConfig } from '../../src/lib/config.js';
import type { TokenAccumulator } from '../../src/lib/claude.js';

import { callClaude } from '../../src/lib/claude-cli.js';
import { UsageStopError } from '../../src/lib/usage.js';
import { bridgeClaude } from '../helpers/claude-bridge.js';

const mockGov = {
  beforeCall: vi.fn(async () => {}),
  observe: vi.fn(),
  noteCost: vi.fn(),
  consumedPoints: 0,
  budgetPoints: 10,
  stopReason: vi.fn(() => null),
} as never;

const getSupabaseMock = async () => {
  const mod = await import('@supabase/supabase-js');
  return (mod as unknown as { __mockFrom: ReturnType<typeof vi.fn> }).__mockFrom;
};

function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    supabaseUrl: 'https://test.supabase.co',
    supabaseServiceRoleKey: 'test-service-key',
    categoryBatchSize: 3,
    knowledgeBatchSize: 10,
    questionsBatchSize: 20,
    claudeModelGeneration: 'claude-sonnet-4-5-20250514',
    claudeModelVerification: 'claude-haiku-4-5-20250514',
    wikipediaUserAgent: 'TestAgent/1.0',
    wikipediaMaxContentLength: 3000,
    relevanceThreshold: 0.6,
    ...overrides,
  };
}

function makeTokenAccumulator(): TokenAccumulator {
  return { input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 };
}

const existingCategories = [
  { id: 'cat-1', name: 'Science', slug: 'science', parent_id: null, depth: 0 },
  { id: 'cat-2', name: 'History', slug: 'history', parent_id: null, depth: 0 },
];

const claudeResponse = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        categories: [
          { name: 'Physics', slug: 'physics', description: 'Study of matter and energy', parent_slug: 'science' },
          { name: 'Biology', slug: 'biology', description: 'Study of living organisms', parent_slug: 'science' },
          { name: 'Ancient History', slug: 'ancient-history', description: 'History of ancient civilizations', parent_slug: 'history' },
        ],
      }),
    },
  ],
  usage: { input_tokens: 500, output_tokens: 200 },
};

describe('Category Agent', () => {
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockFrom: ReturnType<typeof vi.fn>;
  let runCategoryAgent: typeof import('../../src/agents/category.js').runCategoryAgent;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockCreate = vi.fn();
    vi.mocked(callClaude).mockImplementation(bridgeClaude({ respond: (a) => mockCreate(a) }));
    mockFrom = await getSupabaseMock();

    // Default: return existing categories on select
    const mockSelect = vi.fn().mockResolvedValue({ data: existingCategories, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockReturnValue({ data: existingCategories, error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: existingCategories, error: null })) }),
          insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }) }) }),
        };
      }
      return { select: mockSelect };
    });

    // Default: Claude returns valid response
    mockCreate.mockResolvedValue(claudeResponse);

    const mod = await import('../../src/agents/category.js');
    runCategoryAgent = mod.runCategoryAgent;
  });

  it('returns an AgentResult with processed count', async () => {
    const result = await runCategoryAgent(makeConfig(), makeTokenAccumulator(), mockGov);
    expect(result).toHaveProperty('processed');
    expect(result).toHaveProperty('failed');
    expect(typeof result.processed).toBe('number');
  });

  it('queries existing categories from Supabase to build context', async () => {
    await runCategoryAgent(makeConfig(), makeTokenAccumulator(), mockGov);
    expect(mockFrom).toHaveBeenCalledWith('categories');
  });

  it('calls Claude with system prompt describing the task', async () => {
    await runCategoryAgent(makeConfig(), makeTokenAccumulator(), mockGov);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('claude-sonnet-4-5-20250514');
    expect(callArgs.system).toBeDefined();
    expect(typeof callArgs.system).toBe('string');
    expect(callArgs.system.toLowerCase()).toContain('category');
  });

  it('validates Claude response against CategoryBatchSchema', async () => {
    // Return invalid response
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ categories: [{ invalid: true }] }) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    // Should throw because schema validation fails (missing required fields)
    await expect(runCategoryAgent(makeConfig(), makeTokenAccumulator(), mockGov)).rejects.toThrow();
  });

  it('inserts valid categories into Supabase with correct parent_id and depth', async () => {
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockReturnValue({
            data: existingCategories,
            error: null,
            then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: existingCategories, error: null })),
          }),
          insert: insertMock,
        };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    await runCategoryAgent(makeConfig(), makeTokenAccumulator(), mockGov);

    // Should have inserted categories with parent_id and depth
    expect(insertMock).toHaveBeenCalled();
    const insertedData = insertMock.mock.calls[0][0];
    expect(insertedData).toHaveProperty('parent_id', 'cat-1');
    expect(insertedData).toHaveProperty('depth', 1);
    expect(insertedData).toHaveProperty('created_by', 'pipeline');
  });

  it('returns {processed:0, failed:0} without throwing when all proposals are duplicates', async () => {
    // Claude proposes categories with slugs that already exist
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            categories: [
              { name: 'Science', slug: 'science', description: 'Duplicate', parent_slug: 'history' },
              { name: 'History', slug: 'history', description: 'Duplicate', parent_slug: 'science' },
            ],
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const insertMock = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockReturnValue({
            data: existingCategories,
            error: null,
            then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: existingCategories, error: null })),
          }),
          insert: insertMock,
        };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    // All-duplicates is benign: no throw, returns zeros
    const result = await runCategoryAgent(makeConfig(), makeTokenAccumulator(), mockGov);
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('passes existing slugs to Claude prompt', async () => {
    const threeCats = [
      { id: 'cat-1', name: 'Science', slug: 'science', parent_id: null, depth: 0 },
      { id: 'cat-2', name: 'History', slug: 'history', parent_id: null, depth: 0 },
      { id: 'cat-3', name: 'Geography', slug: 'geography', parent_id: null, depth: 0 },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockReturnValue({
            data: threeCats,
            error: null,
            then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: threeCats, error: null })),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            categories: [
              { name: 'Physics', slug: 'physics', description: 'Study of matter', parent_slug: 'science' },
            ],
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await runCategoryAgent(makeConfig(), makeTokenAccumulator(), mockGov);

    const callArgs = mockCreate.mock.calls[0][0];
    const userMessage: string = callArgs.messages[0].content;
    expect(userMessage).toContain('Do NOT propose any of these existing slugs');
    expect(userMessage).toContain('science');
    expect(userMessage).toContain('history');
    expect(userMessage).toContain('geography');
  });

  it('enforces max depth of 3 (skips depth 4+ proposals)', async () => {
    const deepCategories = [
      { id: 'cat-1', name: 'Science', slug: 'science', parent_id: null, depth: 0 },
      { id: 'cat-2', name: 'Physics', slug: 'physics', parent_id: 'cat-1', depth: 1 },
      { id: 'cat-3', name: 'Quantum', slug: 'quantum', parent_id: 'cat-2', depth: 2 },
      { id: 'cat-4', name: 'Entanglement', slug: 'entanglement', parent_id: 'cat-3', depth: 3 },
    ];

    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            categories: [
              { name: 'Bell Theorem', slug: 'bell-theorem', description: 'Too deep', parent_slug: 'entanglement' },
            ],
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const insertMock = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockReturnValue({
            data: deepCategories,
            error: null,
            then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: deepCategories, error: null })),
          }),
          insert: insertMock,
        };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    // All items fail -> agent throws
    await expect(runCategoryAgent(makeConfig(), makeTokenAccumulator(), mockGov)).rejects.toThrow('all 1 categories failed');
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('accumulates tokens and cost from the call result', async () => {
    const acc = makeTokenAccumulator();
    await runCategoryAgent(makeConfig(), acc, mockGov);
    expect(acc.input_tokens).toBeGreaterThan(0);
    expect(acc.output_tokens).toBeGreaterThan(0);
    expect(acc.estimated_cost_usd).toBeGreaterThan(0);
  });

  it('UsageStopError from the governor propagates out of the agent', async () => {
    vi.mocked(mockGov.beforeCall).mockRejectedValueOnce(new UsageStopError('budget'));
    await expect(runCategoryAgent(makeConfig(), makeTokenAccumulator(), mockGov)).rejects.toBeInstanceOf(UsageStopError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns count of processed and failed categories', async () => {
    const result = await runCategoryAgent(makeConfig(), makeTokenAccumulator(), mockGov);
    expect(result.processed).toBe(3);
    expect(result.failed).toBe(0);
  });

  it('caps category tree context to 50 leaf categories when tree is large', async () => {
    // Generate > 50 categories
    const manyCategories = Array.from({ length: 60 }, (_, i) => ({
      id: `cat-${i}`,
      name: `Category ${i}`,
      slug: `category-${i}`,
      parent_id: i === 0 ? null : 'cat-0',
      depth: i === 0 ? 0 : 1,
    }));

    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockReturnValue({
            data: manyCategories,
            error: null,
            then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: manyCategories, error: null })),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    // Make Claude propose categories that don't conflict
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            categories: [
              { name: 'NewSub', slug: 'new-sub', description: 'New', parent_slug: 'category-0' },
            ],
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await runCategoryAgent(makeConfig(), makeTokenAccumulator(), mockGov);

    // Verify the prompt sent to Claude doesn't include all 60 categories verbatim
    const callArgs = mockCreate.mock.calls[0][0];
    const userMessage = callArgs.messages[0].content;
    // Count how many category names appear - should be limited, not all 60
    const catMatches = userMessage.match(/Category \d+/g) || [];
    expect(catMatches.length).toBeLessThan(60);
  });

  it('per-item insert failure does not crash the agent', async () => {
    const insertMock = vi.fn()
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'unique constraint violation' } }),
        }),
      })
      .mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }),
        }),
      });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockReturnValue({
            data: existingCategories,
            error: null,
            then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: existingCategories, error: null })),
          }),
          insert: insertMock,
        };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    const result = await runCategoryAgent(makeConfig(), makeTokenAccumulator(), mockGov);
    // Should not throw, should have 1 failed and 2 processed
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(2);
  });
});
