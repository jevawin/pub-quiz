import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/logger.js', () => ({
  log: vi.fn(),
}));

describe('Seed Threshold Check', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    originalEnv = { ...process.env };
    originalExit = process.exit;
    // Mock process.exit to throw instead of exiting
    process.exit = vi.fn((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never;
  });

  afterEach(() => {
    process.env = originalEnv;
    process.exit = originalExit;
  });

  function createMockSupabase(verifiedCount: number, categoryIds: string[], error: boolean = false) {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'questions') {
        const chain: any = {};
        chain.select = vi.fn((_cols: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) {
            // Count query for total verified
            if (error) {
              return { gte: vi.fn(() => ({ data: null, error: { message: 'DB error' }, count: null })) };
            }
            return { gte: vi.fn(() => ({ data: null, error: null, count: verifiedCount })) };
          }
          // Category ID query
          const gteChain: any = {};
          gteChain.data = categoryIds.map(id => ({ category_id: id }));
          gteChain.error = error ? { message: 'DB error' } : null;
          return {
            gte: vi.fn(() => gteChain),
          };
        });
        return chain;
      }
      return { select: vi.fn() };
    });

    return { from: mockFrom };
  }

  it('returns seedComplete: true when verified count >= 1000', async () => {
    const { checkThreshold } = await import('../src/seed-threshold-check.js');
    const mockSupabase = createMockSupabase(1200, ['cat-1', 'cat-2', 'cat-3']);

    const result = await checkThreshold(mockSupabase as any);

    expect(result.seedComplete).toBe(true);
    expect(result.verifiedCount).toBe(1200);
  });

  it('returns seedComplete: false when verified count < 1000', async () => {
    const { checkThreshold } = await import('../src/seed-threshold-check.js');
    const mockSupabase = createMockSupabase(500, ['cat-1', 'cat-2']);

    const result = await checkThreshold(mockSupabase as any);

    expect(result.seedComplete).toBe(false);
    expect(result.verifiedCount).toBe(500);
  });

  it('writes seed_complete=true to GITHUB_OUTPUT file when threshold met', async () => {
    const fs = await import('node:fs');
    const appendSpy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
    const outputFile = '/tmp/test-github-output';
    process.env.GITHUB_OUTPUT = outputFile;

    const { checkThreshold } = await import('../src/seed-threshold-check.js');
    const mockSupabase = createMockSupabase(1500, ['cat-1', 'cat-2', 'cat-3']);

    await checkThreshold(mockSupabase as any);

    expect(appendSpy).toHaveBeenCalledWith(outputFile, expect.stringContaining('seed_complete=true'));
    appendSpy.mockRestore();
  });

  it('writes GitHub Actions notice annotation to stdout when threshold met', async () => {
    const fs = await import('node:fs');
    vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
    process.env.GITHUB_OUTPUT = '/tmp/test-output';

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { checkThreshold } = await import('../src/seed-threshold-check.js');
    const mockSupabase = createMockSupabase(1050, ['cat-1', 'cat-2']);

    await checkThreshold(mockSupabase as any);

    const noticeCalls = consoleSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('::notice::SEED COMPLETE:')
    );
    expect(noticeCalls.length).toBeGreaterThanOrEqual(1);
    consoleSpy.mockRestore();
  });

  it('handles Supabase query error by calling process.exit(1)', async () => {
    const { checkThreshold } = await import('../src/seed-threshold-check.js');
    const mockSupabase = createMockSupabase(0, [], true);

    await expect(checkThreshold(mockSupabase as any)).rejects.toThrow('process.exit(1)');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
