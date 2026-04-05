import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock wikipedia helpers
vi.mock('../../src/lib/wikipedia.js', () => ({
  searchArticles: vi.fn(),
  getArticleText: vi.fn(),
}));

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
import { searchArticles, getArticleText } from '../../src/lib/wikipedia.js';

const getSupabaseMock = async () => {
  const mod = await import('@supabase/supabase-js');
  return (mod as unknown as { __mockFrom: ReturnType<typeof vi.fn> }).__mockFrom;
};

function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    anthropicApiKey: 'test-key',
    supabaseUrl: 'https://test.supabase.co',
    supabaseServiceRoleKey: 'test-service-key',
    budgetCapUsd: 10.0,
    categoryBatchSize: 5,
    knowledgeBatchSize: 2,
    questionsBatchSize: 20,
    claudeModelGeneration: 'claude-sonnet-4-5-20250514',
    claudeModelVerification: 'claude-haiku-4-5-20250514',
    wikipediaUserAgent: 'TestAgent/1.0',
    wikipediaMaxContentLength: 500,
    relevanceThreshold: 0.6,
    ...overrides,
  };
}

const mockSearchArticles = searchArticles as ReturnType<typeof vi.fn>;
const mockGetArticleText = getArticleText as ReturnType<typeof vi.fn>;

describe('Knowledge Agent', () => {
  let mockFrom: ReturnType<typeof vi.fn>;
  let runKnowledgeAgent: typeof import('../../src/agents/knowledge.js').runKnowledgeAgent;

  const categoriesWithSources = [
    { id: 'cat-1', name: 'Science', slug: 'science', source_count: 1 },
    { id: 'cat-2', name: 'History', slug: 'history', source_count: 0 },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();

    mockFrom = await getSupabaseMock();

    // Default mocks
    mockSearchArticles.mockResolvedValue(['Science Wikipedia', 'Science Overview']);
    mockGetArticleText.mockResolvedValue('This is article content about science topics.');

    // Setup supabase mock chains
    setupDefaultSupabaseMocks();

    const mod = await import('../../src/agents/knowledge.js');
    runKnowledgeAgent = mod.runKnowledgeAgent;
  });

  function setupDefaultSupabaseMocks() {
    const selectMock = vi.fn();
    const insertMock = vi.fn();

    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockReturnValue({
            data: [
              { id: 'cat-1', name: 'Science', slug: 'science' },
              { id: 'cat-2', name: 'History', slug: 'history' },
            ],
            error: null,
            then: (fn: (v: unknown) => unknown) =>
              Promise.resolve(
                fn({
                  data: [
                    { id: 'cat-1', name: 'Science', slug: 'science' },
                    { id: 'cat-2', name: 'History', slug: 'history' },
                  ],
                  error: null,
                }),
              ),
          }),
        };
      }
      if (table === 'sources') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              data: [],
              error: null,
              then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null, count: 0 })),
            }),
            data: [],
            error: null,
            then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'src-1' }, error: null }),
            }),
          }),
        };
      }
      return { select: selectMock, insert: insertMock };
    });
  }

  it('returns AgentResult with sources_fetched count', async () => {
    const result = await runKnowledgeAgent(makeConfig());
    expect(result).toHaveProperty('processed');
    expect(result).toHaveProperty('failed');
    expect(typeof result.processed).toBe('number');
  });

  it('queries categories that need sources', async () => {
    await runKnowledgeAgent(makeConfig());
    expect(mockFrom).toHaveBeenCalledWith('categories');
  });

  it('searches Wikipedia for each category', async () => {
    await runKnowledgeAgent(makeConfig());
    expect(mockSearchArticles).toHaveBeenCalled();
  });

  it('fetches full article text using getArticleText', async () => {
    await runKnowledgeAgent(makeConfig());
    expect(mockGetArticleText).toHaveBeenCalled();
  });

  it('skips articles whose content_hash already exists', async () => {
    // First call returns existing hash
    const existingHash = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockReturnValue({
            data: [{ id: 'cat-1', name: 'Science', slug: 'science' }],
            error: null,
            then: (fn: (v: unknown) => unknown) =>
              Promise.resolve(fn({ data: [{ id: 'cat-1', name: 'Science', slug: 'science' }], error: null })),
          }),
        };
      }
      if (table === 'sources') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((_col: string, val: string) => {
              if (val === 'cat-1') {
                return {
                  data: [],
                  error: null,
                  then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })),
                };
              }
              // content_hash check
              return {
                data: [{ id: 'existing-source', content_hash: existingHash }],
                error: null,
                then: (fn: (v: unknown) => unknown) =>
                  Promise.resolve(fn({ data: [{ id: 'existing-source', content_hash: existingHash }], error: null })),
              };
            }),
            data: [{ id: 'existing-source', content_hash: existingHash }],
            error: null,
            then: (fn: (v: unknown) => unknown) =>
              Promise.resolve(fn({ data: [{ id: 'existing-source', content_hash: existingHash }], error: null })),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'new-src' }, error: null }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    mockSearchArticles.mockResolvedValue(['Duplicate Article']);
    mockGetArticleText.mockResolvedValue('hello');

    const result = await runKnowledgeAgent(makeConfig());
    // The article should be skipped due to duplicate hash
    expect(result.processed).toBe(0);
  });

  it('inserts new sources with correct fields', async () => {
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'new-src' }, error: null }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockReturnValue({
            data: [{ id: 'cat-1', name: 'Science', slug: 'science' }],
            error: null,
            then: (fn: (v: unknown) => unknown) =>
              Promise.resolve(fn({ data: [{ id: 'cat-1', name: 'Science', slug: 'science' }], error: null })),
          }),
        };
      }
      if (table === 'sources') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              data: [],
              error: null,
              then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })),
            }),
          }),
          insert: insertMock,
        };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    mockSearchArticles.mockResolvedValue(['Test Article']);
    mockGetArticleText.mockResolvedValue('Article content here');

    await runKnowledgeAgent(makeConfig());

    expect(insertMock).toHaveBeenCalled();
    const insertedData = insertMock.mock.calls[0][0];
    expect(insertedData).toHaveProperty('category_id', 'cat-1');
    expect(insertedData).toHaveProperty('title', 'Test Article');
    expect(insertedData).toHaveProperty('content', 'Article content here');
    expect(insertedData).toHaveProperty('content_hash');
    expect(insertedData).toHaveProperty('url');
    expect(insertedData.url).toContain('wikipedia.org');
    expect(insertedData.url).toContain(encodeURIComponent('Test_Article'));
  });

  it('per-item Wikipedia fetch failure does not crash the agent', async () => {
    mockSearchArticles.mockRejectedValueOnce(new Error('Network error'));
    mockSearchArticles.mockResolvedValueOnce(['Good Article']);
    mockGetArticleText.mockResolvedValue('Good content');

    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockReturnValue({
            data: [
              { id: 'cat-1', name: 'Science', slug: 'science' },
              { id: 'cat-2', name: 'History', slug: 'history' },
            ],
            error: null,
            then: (fn: (v: unknown) => unknown) =>
              Promise.resolve(
                fn({
                  data: [
                    { id: 'cat-1', name: 'Science', slug: 'science' },
                    { id: 'cat-2', name: 'History', slug: 'history' },
                  ],
                  error: null,
                }),
              ),
          }),
        };
      }
      if (table === 'sources') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              data: [],
              error: null,
              then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'new-src' }, error: null }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    // Should not throw
    const result = await runKnowledgeAgent(makeConfig());
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.processed).toBeGreaterThanOrEqual(0);
  });

  it('handles getArticleText returning null (missing pages)', async () => {
    mockSearchArticles.mockResolvedValue(['Missing Article']);
    mockGetArticleText.mockResolvedValue(null);

    const insertMock = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockReturnValue({
            data: [{ id: 'cat-1', name: 'Science', slug: 'science' }],
            error: null,
            then: (fn: (v: unknown) => unknown) =>
              Promise.resolve(fn({ data: [{ id: 'cat-1', name: 'Science', slug: 'science' }], error: null })),
          }),
        };
      }
      if (table === 'sources') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              data: [],
              error: null,
              then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })),
            }),
          }),
          insert: insertMock,
        };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    await runKnowledgeAgent(makeConfig());
    // No inserts since article text was null
    expect(insertMock).not.toHaveBeenCalled();
  });
});
