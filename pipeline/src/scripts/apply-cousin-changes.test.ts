import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted() per project convention
const { mockAppendFileSync } = vi.hoisted(() => ({
  mockAppendFileSync: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    appendFileSync: mockAppendFileSync,
    default: { ...actual, appendFileSync: mockAppendFileSync },
  };
});

vi.mock('../lib/supabase.js', () => ({
  createSupabaseClient: vi.fn(() => mockSupabase),
}));

interface CallRecord {
  table: string;
  op: 'select' | 'delete' | 'upsert' | 'update';
  args?: unknown;
}

let mockSupabase: ReturnType<typeof makeMockSupabase>;
let calls: CallRecord[];

function makeMockSupabase(opts: {
  slugToId: Map<string, string>;
  qcRowsByQid: Map<string, Array<{ category_id: string; estimate_score: number }>>;
  failOn?: 'delete' | 'upsert' | 'update';
}) {
  function categoriesTable() {
    return {
      select: () => ({
        in: (_col: string, slugs: string[]) => {
          calls.push({ table: 'categories', op: 'select', args: slugs });
          const data = slugs
            .filter((s) => opts.slugToId.has(s))
            .map((s) => ({ id: opts.slugToId.get(s)!, slug: s }));
          return Promise.resolve({ data, error: null });
        },
      }),
    };
  }

  function questionCategoriesTable() {
    return {
      select: (_cols: string) => ({
        eq: (_c1: string, qid: string) => ({
          in: (_c2: string, catIds: string[]) => {
            calls.push({ table: 'question_categories', op: 'select', args: { qid, catIds } });
            const rows = (opts.qcRowsByQid.get(qid) ?? []).filter((r) => catIds.includes(r.category_id));
            return Promise.resolve({ data: rows, error: null });
          },
        }),
      }),
      delete: () => {
        const eq1 = (_c1: string, qid: string) => ({
          eq: (_c2: string, catId: string) => {
            calls.push({ table: 'question_categories', op: 'delete', args: { qid, catId } });
            if (opts.failOn === 'delete') return Promise.resolve({ data: null, error: { message: 'delete failed' } });
            return Promise.resolve({ data: null, error: null });
          },
        });
        return { eq: eq1 };
      },
      upsert: (rows: unknown, options: unknown) => {
        calls.push({ table: 'question_categories', op: 'upsert', args: { rows, options } });
        if (opts.failOn === 'upsert') return Promise.resolve({ data: null, error: { message: 'upsert failed' } });
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  function questionsTable() {
    return {
      update: (patch: unknown) => ({
        eq: (_c: string, qid: string) => {
          calls.push({ table: 'questions', op: 'update', args: { qid, patch } });
          if (opts.failOn === 'update') return Promise.resolve({ data: null, error: { message: 'update failed' } });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    };
  }

  return {
    from: (table: string) => {
      if (table === 'categories') return categoriesTable();
      if (table === 'question_categories') return questionCategoriesTable();
      if (table === 'questions') return questionsTable();
      throw new Error(`unexpected table ${table}`);
    },
  };
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runScript(input: string, argv: string[] = []): Promise<RunResult> {
  // Reset module cache so the script re-runs main()
  vi.resetModules();

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    stdoutChunks.push(args.map(String).join(' '));
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    stderrChunks.push(args.map(String).join(' '));
  });

  let exitCode = 0;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`__exit_${exitCode}`);
  }) as never);

  const origArgv = process.argv;
  process.argv = ['node', 'apply-cousin-changes.ts', ...argv];

  // Stub stdin via async iterator
  const origStdin = process.stdin;
  const fakeStdin = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(input, 'utf8');
    },
  };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  // Set required env so createSupabaseClient is callable (the mock ignores values)
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

  try {
    const mod = await import('./apply-cousin-changes.js');
    if (typeof (mod as { run?: () => Promise<void> }).run === 'function') {
      try {
        await (mod as { run: () => Promise<void> }).run();
      } catch (e) {
        if (!(e instanceof Error) || !e.message.startsWith('__exit_')) throw e;
      }
    }
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith('__exit_')) throw e;
  } finally {
    Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
    process.argv = origArgv;
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return {
    exitCode,
    stdout: stdoutChunks.join('\n'),
    stderr: stderrChunks.join('\n'),
  };
}

beforeEach(() => {
  calls = [];
  mockAppendFileSync.mockReset();
  mockSupabase = makeMockSupabase({
    slugToId: new Map([
      ['british-history', 'cat-bh'],
      ['history', 'cat-hist'],
      ['pop-culture', 'cat-pop'],
      ['general-knowledge', 'cat-gk'],
    ]),
    qcRowsByQid: new Map([
      ['00000000-0000-0000-0000-000000000001', [
        { category_id: 'cat-bh', estimate_score: 60 },
      ]],
    ]),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apply-cousin-changes', () => {
  it('rejects insert without cousin_reason when chain_ancestor !== true', async () => {
    const payload = JSON.stringify({
      batch_id: 'b-1',
      ops: [
        {
          op: 'insert',
          question_id: '00000000-0000-0000-0000-000000000001',
          slug: 'pop-culture',
          estimate_score: 60,
        },
      ],
    });
    const r = await runScript(payload);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/cousin_reason/);
  });

  it('--dry-run does not invoke supabase write methods', async () => {
    const payload = JSON.stringify({
      batch_id: 'b-1',
      ops: [
        {
          op: 'delete',
          question_id: '00000000-0000-0000-0000-000000000001',
          slug: 'british-history',
          reason: 'prune low-score cousin',
        },
        {
          op: 'insert',
          question_id: '00000000-0000-0000-0000-000000000001',
          slug: 'history',
          estimate_score: 80,
          chain_ancestor: true,
        },
        {
          op: 'set_primary',
          question_id: '00000000-0000-0000-0000-000000000001',
          new_category_slug: 'history',
          reason: 'move primary',
        },
      ],
    });
    const r = await runScript(payload, ['--dry-run']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/"dry_run":\s*true/);
    const writeCalls = calls.filter((c) => c.op === 'delete' || c.op === 'upsert' || c.op === 'update');
    expect(writeCalls).toHaveLength(0);
    expect(mockAppendFileSync).not.toHaveBeenCalled();
  });

  it('groups ops by question_id with deletes-before-inserts ordering', async () => {
    const payload = JSON.stringify({
      batch_id: 'b-1',
      ops: [
        {
          op: 'insert',
          question_id: '00000000-0000-0000-0000-000000000001',
          slug: 'history',
          estimate_score: 80,
          chain_ancestor: true,
        },
        {
          op: 'delete',
          question_id: '00000000-0000-0000-0000-000000000001',
          slug: 'british-history',
          reason: 'prune',
        },
      ],
    });
    const r = await runScript(payload);
    expect(r.exitCode).toBe(0);
    const writeOps = calls.filter((c) => c.op === 'delete' || c.op === 'upsert' || c.op === 'update');
    // delete must come before upsert
    const deleteIdx = writeOps.findIndex((c) => c.op === 'delete');
    const upsertIdx = writeOps.findIndex((c) => c.op === 'upsert');
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(upsertIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeLessThan(upsertIdx);
  });

  it('audit log JSONL line written per successful op', async () => {
    const payload = JSON.stringify({
      batch_id: 'b-1',
      ops: [
        {
          op: 'delete',
          question_id: '00000000-0000-0000-0000-000000000001',
          slug: 'british-history',
          reason: 'prune',
        },
        {
          op: 'insert',
          question_id: '00000000-0000-0000-0000-000000000001',
          slug: 'history',
          estimate_score: 80,
          chain_ancestor: true,
        },
        {
          op: 'set_primary',
          question_id: '00000000-0000-0000-0000-000000000001',
          new_category_slug: 'history',
          reason: 'move primary',
        },
      ],
    });
    const r = await runScript(payload);
    expect(r.exitCode).toBe(0);
    expect(mockAppendFileSync).toHaveBeenCalledTimes(3);
    const allLines = mockAppendFileSync.mock.calls.map((c) => String(c[1]));
    for (const line of allLines) {
      expect(line.endsWith('\n')).toBe(true);
      const parsed = JSON.parse(line.trim());
      expect(parsed.batch_id).toBe('b-1');
      expect(parsed.question_id).toBe('00000000-0000-0000-0000-000000000001');
      expect(['delete', 'insert', 'set_primary']).toContain(parsed.op);
      expect(typeof parsed.ts).toBe('string');
    }
    // delete entry should record prev_score
    const deleteLine = allLines.map((l) => JSON.parse(l)).find((p) => p.op === 'delete');
    expect(deleteLine.prev_score).toBe(60);
  });

  it('exits 1 with missing slugs listed when categories table lacks a slug', async () => {
    const payload = JSON.stringify({
      batch_id: 'b-1',
      ops: [
        {
          op: 'insert',
          question_id: '00000000-0000-0000-0000-000000000001',
          slug: 'nonexistent-slug',
          estimate_score: 50,
          chain_ancestor: true,
        },
      ],
    });
    const r = await runScript(payload);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/nonexistent-slug/);
  });
});
