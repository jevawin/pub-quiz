import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineConfig } from '../../src/lib/config.js';
import type { TokenAccumulator } from '../../src/lib/claude.js';

// Mock wikipedia helpers
vi.mock('../../src/lib/wikipedia.js', () => ({
  searchArticles: vi.fn(),
  getArticleText: vi.fn(),
}));

// Mock claude helpers
vi.mock('../../src/lib/claude.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/claude.js')>();
  return {
    ...actual,
    createClaudeClient: vi.fn(),
    trackUsage: vi.fn(),
    checkBudget: vi.fn(),
  };
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

vi.mock('../../src/lib/logger.js', () => ({
  log: vi.fn(),
}));

import { searchArticles, getArticleText } from '../../src/lib/wikipedia.js';
import { createClaudeClient, trackUsage, checkBudget } from '../../src/lib/claude.js';

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

function makeTokenAccumulator(): TokenAccumulator {
  return { input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 };
}

const mockSearchArticles = searchArticles as ReturnType<typeof vi.fn>;
const mockGetArticleText = getArticleText as ReturnType<typeof vi.fn>;
const mockCreateClaudeClient = createClaudeClient as ReturnType<typeof vi.fn>;
const mockTrackUsage = trackUsage as ReturnType<typeof vi.fn>;

function makeMockClaudeClient(relevanceScore: number = 0.8) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ relevance: relevanceScore, reasoning: 'Test reasoning' }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  };
}

describe('Knowledge Agent', () => {
  let mockFrom: ReturnType<typeof vi.fn>;
  let runKnowledgeAgent: typeof import('../../src/agents/knowledge.js').runKnowledgeAgent;
  let mockClaude: ReturnType<typeof makeMockClaudeClient>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockFrom = await getSupabaseMock();
    mockClaude = makeMockClaudeClient(0.8);
    mockCreateClaudeClient.mockReturnValue(mockClaude);

    // Default mocks
    mockSearchArticles.mockResolvedValue(['Science Wikipedia', 'Science Overview']);
    mockGetArticleText.mockResolvedValue('This is article content about science topics.');

    // Setup supabase mock chains
    setupDefaultSupabaseMocks();

    const mod = await import('../../src/agents/knowledge.js');
    runKnowledgeAgent = mod.runKnowledgeAgent;
  });

  /**
   * Helper to build a chainable supabase mock.
   * Supports: .select().eq().single(), .select().eq().limit(), .select().eq()
   */
  function makeChainableQuery(data: unknown, options?: { single?: boolean }) {
    const singleMock = vi.fn().mockResolvedValue({ data, error: null });
    const limitMock = vi.fn().mockReturnValue({
      data,
      error: null,
      then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data, error: null })),
    });
    const eqMock = vi.fn().mockReturnValue({
      data,
      error: null,
      single: singleMock,
      limit: limitMock,
      then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data, error: null })),
    });
    const selectMock = vi.fn().mockReturnValue({
      data,
      error: null,
      eq: eqMock,
      single: singleMock,
      limit: limitMock,
      then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data, error: null })),
    });
    return { select: selectMock, eq: eqMock, single: singleMock, limit: limitMock };
  }

  function setupDefaultSupabaseMocks() {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        const selectMock = vi.fn().mockImplementation((_cols?: string) => {
          // The default returns the category list for the initial fetch
          const data = [
            { id: 'cat-1', name: 'Science', slug: 'science', parent_id: null },
            { id: 'cat-2', name: 'History', slug: 'history', parent_id: null },
          ];
          const eqMock = vi.fn().mockImplementation((_col: string, val: string) => {
            if (_col === 'id') {
              const cat = data.find(c => c.id === val);
              return {
                single: vi.fn().mockResolvedValue({ data: cat || null, error: null }),
                data: cat ? [cat] : [],
                error: null,
                then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: cat ? [cat] : [], error: null })),
              };
            }
            if (_col === 'parent_id') {
              const children = data.filter(c => c.parent_id === val);
              return {
                limit: vi.fn().mockReturnValue({
                  data: children,
                  error: null,
                  then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: children, error: null })),
                }),
                data: children,
                error: null,
                then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: children, error: null })),
              };
            }
            return {
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
              data: [],
              error: null,
              then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })),
            };
          });
          return {
            data,
            error: null,
            eq: eqMock,
            then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data, error: null })),
          };
        });
        return { select: selectMock };
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
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });
  }

  it('returns AgentResult with sources_fetched count', async () => {
    const result = await runKnowledgeAgent(makeConfig(), makeTokenAccumulator());
    expect(result).toHaveProperty('processed');
    expect(result).toHaveProperty('failed');
    expect(typeof result.processed).toBe('number');
  });

  it('queries categories that need sources', async () => {
    await runKnowledgeAgent(makeConfig(), makeTokenAccumulator());
    expect(mockFrom).toHaveBeenCalledWith('categories');
  });

  it('searches Wikipedia for each category', async () => {
    await runKnowledgeAgent(makeConfig(), makeTokenAccumulator());
    expect(mockSearchArticles).toHaveBeenCalled();
  });

  it('fetches full article text using getArticleText', async () => {
    await runKnowledgeAgent(makeConfig(), makeTokenAccumulator());
    expect(mockGetArticleText).toHaveBeenCalled();
  });

  it('skips articles whose content_hash already exists', async () => {
    const existingHash = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        const selectMock = vi.fn().mockImplementation(() => {
          const data = [{ id: 'cat-1', name: 'Science', slug: 'science', parent_id: null }];
          return {
            data,
            error: null,
            eq: vi.fn().mockImplementation((_col: string, val: string) => {
              if (_col === 'id') {
                return {
                  single: vi.fn().mockResolvedValue({ data: data[0], error: null }),
                  data,
                  error: null,
                  then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data, error: null })),
                };
              }
              if (_col === 'parent_id') {
                return {
                  limit: vi.fn().mockReturnValue({ data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) }),
                  data: [],
                  error: null,
                  then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })),
                };
              }
              return { single: vi.fn().mockResolvedValue({ data: null, error: null }), data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) };
            }),
            then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data, error: null })),
          };
        });
        return { select: selectMock };
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

    const result = await runKnowledgeAgent(makeConfig(), makeTokenAccumulator());
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
        const selectMock = vi.fn().mockImplementation(() => {
          const data = [{ id: 'cat-1', name: 'Science', slug: 'science', parent_id: null }];
          return {
            data,
            error: null,
            eq: vi.fn().mockImplementation((_col: string, val: string) => {
              if (_col === 'id') {
                return {
                  single: vi.fn().mockResolvedValue({ data: data[0], error: null }),
                  data,
                  error: null,
                  then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data, error: null })),
                };
              }
              if (_col === 'parent_id') {
                return {
                  limit: vi.fn().mockReturnValue({ data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) }),
                  data: [],
                  error: null,
                  then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })),
                };
              }
              return { single: vi.fn().mockResolvedValue({ data: null, error: null }), data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) };
            }),
            then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data, error: null })),
          };
        });
        return { select: selectMock };
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

    await runKnowledgeAgent(makeConfig(), makeTokenAccumulator());

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
        const selectMock = vi.fn().mockImplementation(() => {
          const data = [
            { id: 'cat-1', name: 'Science', slug: 'science', parent_id: null },
            { id: 'cat-2', name: 'History', slug: 'history', parent_id: null },
          ];
          return {
            data,
            error: null,
            eq: vi.fn().mockImplementation((_col: string, val: string) => {
              if (_col === 'id') {
                const cat = data.find(c => c.id === val);
                return {
                  single: vi.fn().mockResolvedValue({ data: cat || null, error: null }),
                  data: cat ? [cat] : [],
                  error: null,
                  then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: cat ? [cat] : [], error: null })),
                };
              }
              if (_col === 'parent_id') {
                return {
                  limit: vi.fn().mockReturnValue({ data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) }),
                  data: [],
                  error: null,
                  then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })),
                };
              }
              return { single: vi.fn().mockResolvedValue({ data: null, error: null }), data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) };
            }),
            then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data, error: null })),
          };
        });
        return { select: selectMock };
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
    const result = await runKnowledgeAgent(makeConfig(), makeTokenAccumulator());
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.processed).toBeGreaterThanOrEqual(0);
  });

  it('handles getArticleText returning null (missing pages)', async () => {
    mockSearchArticles.mockResolvedValue(['Missing Article']);
    mockGetArticleText.mockResolvedValue(null);

    const insertMock = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        const selectMock = vi.fn().mockImplementation(() => {
          const data = [{ id: 'cat-1', name: 'Science', slug: 'science', parent_id: null }];
          return {
            data,
            error: null,
            eq: vi.fn().mockImplementation((_col: string, val: string) => {
              if (_col === 'id') {
                return {
                  single: vi.fn().mockResolvedValue({ data: data[0], error: null }),
                  data,
                  error: null,
                  then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data, error: null })),
                };
              }
              if (_col === 'parent_id') {
                return {
                  limit: vi.fn().mockReturnValue({ data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) }),
                  data: [],
                  error: null,
                  then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })),
                };
              }
              return { single: vi.fn().mockResolvedValue({ data: null, error: null }), data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) };
            }),
            then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data, error: null })),
          };
        });
        return { select: selectMock };
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

    await runKnowledgeAgent(makeConfig(), makeTokenAccumulator());
    // No inserts since article text was null
    expect(insertMock).not.toHaveBeenCalled();
  });

  // ---- NEW TESTS for D-06, D-07, D-08 ----

  it('builds richer search queries using parent category context (D-07)', async () => {
    // Category "Quidditch" with parent "Harry Potter"
    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockImplementation(() => {
            const cats = [{ id: 'cat-quidditch', name: 'Quidditch', slug: 'quidditch', parent_id: 'cat-hp' }];
            return {
              data: cats,
              error: null,
              eq: vi.fn().mockImplementation((_col: string, val: string) => {
                if (_col === 'id' && val === 'cat-quidditch') {
                  return {
                    single: vi.fn().mockResolvedValue({
                      data: { id: 'cat-quidditch', name: 'Quidditch', slug: 'quidditch', parent_id: 'cat-hp' },
                      error: null,
                    }),
                    data: cats,
                    error: null,
                    then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: cats, error: null })),
                  };
                }
                if (_col === 'id' && val === 'cat-hp') {
                  return {
                    single: vi.fn().mockResolvedValue({
                      data: { id: 'cat-hp', name: 'Harry Potter', slug: 'harry-potter', parent_id: null },
                      error: null,
                    }),
                    data: [{ name: 'Harry Potter' }],
                    error: null,
                    then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [{ name: 'Harry Potter' }], error: null })),
                  };
                }
                if (_col === 'parent_id') {
                  return {
                    limit: vi.fn().mockReturnValue({ data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) }),
                    data: [],
                    error: null,
                    then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })),
                  };
                }
                return { single: vi.fn().mockResolvedValue({ data: null, error: null }), data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) };
              }),
              then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: cats, error: null })),
            };
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
              single: vi.fn().mockResolvedValue({ data: { id: 'src-1' }, error: null }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    mockSearchArticles.mockResolvedValue(['Quidditch in Harry Potter']);
    mockGetArticleText.mockResolvedValue('Quidditch is a fictional sport in the Harry Potter universe.');

    await runKnowledgeAgent(makeConfig(), makeTokenAccumulator());

    // searchArticles should be called with a query containing both "Quidditch" and "Harry Potter"
    expect(mockSearchArticles).toHaveBeenCalled();
    const searchQuery = mockSearchArticles.mock.calls[0][0];
    expect(searchQuery).toContain('Quidditch');
    expect(searchQuery).toContain('Harry Potter');
  });

  it('includes child category names in search query for top-level categories (D-07)', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockImplementation(() => {
            const cats = [{ id: 'cat-science', name: 'Science', slug: 'science', parent_id: null }];
            return {
              data: cats,
              error: null,
              eq: vi.fn().mockImplementation((_col: string, val: string) => {
                if (_col === 'id' && val === 'cat-science') {
                  return {
                    single: vi.fn().mockResolvedValue({
                      data: { id: 'cat-science', name: 'Science', slug: 'science', parent_id: null },
                      error: null,
                    }),
                    data: cats,
                    error: null,
                    then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: cats, error: null })),
                  };
                }
                if (_col === 'parent_id' && val === 'cat-science') {
                  const children = [
                    { name: 'Physics' },
                    { name: 'Chemistry' },
                    { name: 'Biology' },
                  ];
                  return {
                    limit: vi.fn().mockReturnValue({
                      data: children,
                      error: null,
                      then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: children, error: null })),
                    }),
                    data: children,
                    error: null,
                    then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: children, error: null })),
                  };
                }
                return { single: vi.fn().mockResolvedValue({ data: null, error: null }), limit: vi.fn().mockReturnValue({ data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) }), data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) };
              }),
              then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: cats, error: null })),
            };
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
              single: vi.fn().mockResolvedValue({ data: { id: 'src-1' }, error: null }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    mockSearchArticles.mockResolvedValue(['Science Article 1', 'Science Article 2']);
    mockGetArticleText.mockResolvedValue('Content about science.');

    await runKnowledgeAgent(makeConfig(), makeTokenAccumulator());

    expect(mockSearchArticles).toHaveBeenCalled();
    const searchQuery = mockSearchArticles.mock.calls[0][0];
    expect(searchQuery).toContain('Science');
    // Should include at least one child name
    expect(searchQuery).toMatch(/Physics|Chemistry|Biology/);
  });

  it('filters articles through Haiku relevance scoring (D-06)', async () => {
    // Set up claude mock to return low relevance for first article, high for second
    const claudeCreateMock = vi.fn()
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ relevance: 0.2, reasoning: 'Not relevant' }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ relevance: 0.8, reasoning: 'Directly relevant' }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
    mockClaude.messages.create = claudeCreateMock;

    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'src-1' }, error: null }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockImplementation(() => {
            const cats = [{ id: 'cat-1', name: 'Science', slug: 'science', parent_id: null }];
            return {
              data: cats,
              error: null,
              eq: vi.fn().mockImplementation((_col: string, val: string) => {
                if (_col === 'id') {
                  return {
                    single: vi.fn().mockResolvedValue({ data: cats[0], error: null }),
                    data: cats,
                    error: null,
                    then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: cats, error: null })),
                  };
                }
                if (_col === 'parent_id') {
                  return {
                    limit: vi.fn().mockReturnValue({ data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) }),
                    data: [],
                    error: null,
                    then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })),
                  };
                }
                return { single: vi.fn().mockResolvedValue({ data: null, error: null }), data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) };
              }),
              then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: cats, error: null })),
            };
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

    mockSearchArticles.mockResolvedValue(['Irrelevant Article', 'Relevant Article']);
    mockGetArticleText.mockResolvedValue('Some article content here.');

    await runKnowledgeAgent(makeConfig(), makeTokenAccumulator());

    // Only the relevant article (0.8) should be inserted, not the irrelevant one (0.2)
    expect(claudeCreateMock).toHaveBeenCalledTimes(2);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const insertedData = insertMock.mock.calls[0][0];
    expect(insertedData.title).toBe('Relevant Article');
  });

  it('retries with fallback search when initial query returns < 2 results (D-08)', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockImplementation(() => {
            const cats = [{ id: 'cat-1', name: 'Quantum Physics', slug: 'quantum-physics', parent_id: 'cat-science' }];
            return {
              data: cats,
              error: null,
              eq: vi.fn().mockImplementation((_col: string, val: string) => {
                if (_col === 'id' && val === 'cat-1') {
                  return {
                    single: vi.fn().mockResolvedValue({
                      data: { id: 'cat-1', name: 'Quantum Physics', slug: 'quantum-physics', parent_id: 'cat-science' },
                      error: null,
                    }),
                    data: cats,
                    error: null,
                    then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: cats, error: null })),
                  };
                }
                if (_col === 'id' && val === 'cat-science') {
                  return {
                    single: vi.fn().mockResolvedValue({
                      data: { id: 'cat-science', name: 'Science', slug: 'science', parent_id: null },
                      error: null,
                    }),
                    data: [{ name: 'Science' }],
                    error: null,
                    then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [{ name: 'Science' }], error: null })),
                  };
                }
                if (_col === 'parent_id') {
                  return {
                    limit: vi.fn().mockReturnValue({ data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) }),
                    data: [],
                    error: null,
                    then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })),
                  };
                }
                return { single: vi.fn().mockResolvedValue({ data: null, error: null }), data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) };
              }),
              then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: cats, error: null })),
            };
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
              single: vi.fn().mockResolvedValue({ data: { id: 'src-1' }, error: null }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    // First search returns only 1 result, fallback returns more
    mockSearchArticles
      .mockResolvedValueOnce(['Only One Result'])
      .mockResolvedValueOnce(['Fallback Result 1', 'Fallback Result 2']);
    mockGetArticleText.mockResolvedValue('Content about quantum physics.');

    await runKnowledgeAgent(makeConfig(), makeTokenAccumulator());

    // searchArticles should be called twice (initial + fallback)
    expect(mockSearchArticles).toHaveBeenCalledTimes(2);
    // Fallback should use parent name ("Science") since category has a parent
    const fallbackQuery = mockSearchArticles.mock.calls[1][0];
    expect(fallbackQuery).toBe('Science');
  });

  it('accepts TokenAccumulator parameter and tracks Haiku usage', async () => {
    const accumulator = makeTokenAccumulator();

    await runKnowledgeAgent(makeConfig(), accumulator);

    // trackUsage should be called for each relevance check
    expect(mockTrackUsage).toHaveBeenCalled();
    // Should be called with HAIKU_INPUT and HAIKU_OUTPUT rates
    const trackCall = mockTrackUsage.mock.calls[0];
    expect(trackCall[2]).toBe(1); // HAIKU_INPUT
    expect(trackCall[3]).toBe(5); // HAIKU_OUTPUT
  });

  it('handles null parent gracefully for top-level categories (D-07)', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockImplementation(() => {
            const cats = [{ id: 'cat-1', name: 'Science', slug: 'science', parent_id: null }];
            return {
              data: cats,
              error: null,
              eq: vi.fn().mockImplementation((_col: string, val: string) => {
                if (_col === 'id') {
                  return {
                    single: vi.fn().mockResolvedValue({ data: cats[0], error: null }),
                    data: cats,
                    error: null,
                    then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: cats, error: null })),
                  };
                }
                if (_col === 'parent_id') {
                  return {
                    limit: vi.fn().mockReturnValue({
                      data: [],
                      error: null,
                      then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })),
                    }),
                    data: [],
                    error: null,
                    then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })),
                  };
                }
                return { single: vi.fn().mockResolvedValue({ data: null, error: null }), data: [], error: null, then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: [], error: null })) };
              }),
              then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: cats, error: null })),
            };
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
              single: vi.fn().mockResolvedValue({ data: { id: 'src-1' }, error: null }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    mockSearchArticles.mockResolvedValue(['Science Article 1', 'Science Article 2']);
    mockGetArticleText.mockResolvedValue('Content about science.');

    // Should not throw
    const result = await runKnowledgeAgent(makeConfig(), makeTokenAccumulator());
    expect(result).toHaveProperty('processed');
    expect(result).toHaveProperty('failed');

    // Search should still have been called with at least the category name
    const searchQuery = mockSearchArticles.mock.calls[0][0];
    expect(searchQuery).toContain('Science');
  });
});
