import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/logger.js', () => ({
  log: vi.fn(),
}));

interface MockCategory {
  id: string;
  name: string;
  slug: string;
  depth: number;
  hidden_reason?: 'merged' | 'trimmed' | 'veto' | null;
}

interface MockCategoryData {
  categories: MockCategory[];
  questionCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
}

function createMockSupabase(data: MockCategoryData) {
  const mockFrom = vi.fn((table: string) => {
    if (table === 'categories') {
      let onlyVisible = false;
      const chain: any = {
        select: vi.fn(() => chain),
        is: vi.fn((col: string, val: null) => {
          if (col === 'hidden_reason' && val === null) onlyVisible = true;
          return chain;
        }),
        gte: vi.fn((_col: string, minDepth: number) => {
          const filtered = data.categories.filter(
            c => c.depth >= minDepth && (!onlyVisible || (c.hidden_reason ?? null) === null),
          );
          const filteredChain: any = {};
          filteredChain.then = (resolve: (val: unknown) => void) => {
            return Promise.resolve({ data: filtered, error: null }).then(resolve);
          };
          return filteredChain;
        }),
      };
      chain.then = (resolve: (val: unknown) => void) => {
        return Promise.resolve({ data: data.categories, error: null }).then(resolve);
      };
      return chain;
    }
    if (table === 'questions' || table === 'question_categories') {
      // Phase 999.8 Plan 05: per-category question counts now come from
      // question_categories (questions.category_id was dropped).
      return {
        select: vi.fn((_cols: string, _opts?: any) => ({
          eq: vi.fn((col: string, val: string) => {
            const count = data.questionCounts[val] ?? 0;
            return { data: null, error: null, count };
          }),
        })),
      };
    }
    if (table === 'sources') {
      return {
        select: vi.fn((_cols: string, _opts?: any) => ({
          eq: vi.fn((col: string, val: string) => {
            const count = data.sourceCounts[val] ?? 0;
            return { data: null, error: null, count };
          }),
        })),
      };
    }
    return { select: vi.fn() };
  });

  return { from: mockFrom };
}

describe('Category Selection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it('returns categories sorted by verified question count ascending (least questions first)', async () => {
    const { getEligibleCategoriesOrdered } = await import('../../src/lib/category-selection.js');
    const mockSupabase = createMockSupabase({
      categories: [
        { id: 'cat-a', name: 'History', slug: 'history', depth: 1 },
        { id: 'cat-b', name: 'Science', slug: 'science', depth: 1 },
        { id: 'cat-c', name: 'Music', slug: 'music', depth: 1 },
      ],
      questionCounts: { 'cat-a': 5, 'cat-b': 2, 'cat-c': 8 },
      sourceCounts: { 'cat-a': 3, 'cat-b': 2, 'cat-c': 1 },
    });

    const result = await getEligibleCategoriesOrdered(mockSupabase as any, 10);

    expect(result.length).toBe(3);
    expect(result[0].name).toBe('Science');   // 2 questions
    expect(result[1].name).toBe('History');    // 5 questions
    expect(result[2].name).toBe('Music');      // 8 questions
  });

  it('includes categories regardless of source count (questions generated from Claude knowledge)', async () => {
    const { getEligibleCategoriesOrdered } = await import('../../src/lib/category-selection.js');
    const mockSupabase = createMockSupabase({
      categories: [
        { id: 'cat-a', name: 'History', slug: 'history', depth: 1 },
        { id: 'cat-b', name: 'Science', slug: 'science', depth: 1 },
      ],
      questionCounts: { 'cat-a': 3, 'cat-b': 2 },
      sourceCounts: { 'cat-a': 0, 'cat-b': 5 },
    });

    const result = await getEligibleCategoriesOrdered(mockSupabase as any, 10);

    expect(result.length).toBe(2);
    expect(result[0].name).toBe('Science');  // fewer questions
    expect(result[1].name).toBe('History');
  });

  it('a category with 500 questions is still returned, after emptier ones', async () => {
    const { getEligibleCategoriesOrdered } = await import('../../src/lib/category-selection.js');
    const mockSupabase = createMockSupabase({
      categories: [
        { id: 'cat-a', name: 'History', slug: 'history', depth: 1 },
        { id: 'cat-b', name: 'Science', slug: 'science', depth: 1 },
      ],
      questionCounts: { 'cat-a': 500, 'cat-b': 3 },
      sourceCounts: { 'cat-a': 2, 'cat-b': 2 },
    });

    const result = await getEligibleCategoriesOrdered(mockSupabase as any, 10);

    expect(result.map(c => c.name)).toEqual(['Science', 'History']);
    expect(result[1].questionCount).toBe(500);
  });

  it('categories are returned fewest-first', async () => {
    const { getEligibleCategoriesOrdered } = await import('../../src/lib/category-selection.js');
    const mockSupabase = createMockSupabase({
      categories: [
        { id: 'cat-a', name: 'A', slug: 'a', depth: 1 },
        { id: 'cat-b', name: 'B', slug: 'b', depth: 2 },
        { id: 'cat-c', name: 'C', slug: 'c', depth: 1 },
        { id: 'cat-d', name: 'D', slug: 'd', depth: 0 },
      ],
      questionCounts: { 'cat-a': 40, 'cat-b': 7, 'cat-c': 120, 'cat-d': 0 },
      sourceCounts: {},
    });

    const result = await getEligibleCategoriesOrdered(mockSupabase as any, 10);

    expect(result.map(c => c.name)).toEqual(['B', 'A', 'C']);
  });

  it('respects the batch size limit parameter', async () => {
    const { getEligibleCategoriesOrdered } = await import('../../src/lib/category-selection.js');
    const mockSupabase = createMockSupabase({
      categories: [
        { id: 'cat-a', name: 'History', slug: 'history', depth: 1 },
        { id: 'cat-b', name: 'Science', slug: 'science', depth: 1 },
        { id: 'cat-c', name: 'Music', slug: 'music', depth: 1 },
        { id: 'cat-d', name: 'Sports', slug: 'sports', depth: 1 },
      ],
      questionCounts: { 'cat-a': 1, 'cat-b': 2, 'cat-c': 3, 'cat-d': 4 },
      sourceCounts: { 'cat-a': 1, 'cat-b': 1, 'cat-c': 1, 'cat-d': 1 },
    });

    const result = await getEligibleCategoriesOrdered(mockSupabase as any, 2);

    expect(result.length).toBe(2);
    expect(result[0].name).toBe('History');   // 1 question (least)
    expect(result[1].name).toBe('Science');   // 2 questions
  });

  it('never selects merged/trimmed/veto categories; threshold-hidden (hidden_reason null) stay eligible', async () => {
    const { getEligibleCategoriesOrdered } = await import('../../src/lib/category-selection.js');
    const mockSupabase = createMockSupabase({
      categories: [
        { id: 'cat-m', name: 'Merged', slug: 'merged', depth: 1, hidden_reason: 'merged' },
        { id: 'cat-t', name: 'Trimmed', slug: 'trimmed', depth: 1, hidden_reason: 'trimmed' },
        { id: 'cat-v', name: 'Veto', slug: 'veto', depth: 1, hidden_reason: 'veto' },
        { id: 'cat-low', name: 'Low', slug: 'low', depth: 1, hidden_reason: null },
        { id: 'cat-big', name: 'Big', slug: 'big', depth: 1, hidden_reason: null },
      ],
      questionCounts: { 'cat-m': 0, 'cat-t': 0, 'cat-v': 0, 'cat-low': 1, 'cat-big': 50 },
      sourceCounts: {},
    });
    const result = await getEligibleCategoriesOrdered(mockSupabase as any, 10);
    expect(result.map(r => r.slug)).toEqual(['low', 'big']);
  });
});
