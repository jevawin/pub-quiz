import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeCallOptions } from '../../claude-cli.js';
import type { RateLimitInfo } from '../../usage.js';

const h = vi.hoisted(() => ({
  handler: (_o: { system?: string; prompt: string }): string => '{}',
  calls: 0,
}));
vi.mock('../../claude-cli.js', async (orig) => {
  const real = await orig<typeof import('../../claude-cli.js')>();
  return {
    ...real,
    callClaude: vi.fn(async (o: ClaudeCallOptions) => {
      h.calls++;
      return { text: h.handler(o), rateLimit: null, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }),
  };
});

import { checkGates, exportBackup, governorEnv, inGeneratorWindow, insideRepo, weeklyBudgetPoints, parseArgs, planFileHash, readPlanFile, runCli, weeklyRunId } from '../cli.js';
import { governorConfigFromEnv } from '../../usage.js';
import { makeFakeDb } from './fake-db.js';

type Row = Record<string, unknown>;
const lastJson = (lines: string[]): { runId: string | null; mode: string; status: string; report: string } =>
  JSON.parse(lines[lines.length - 1]);

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tax-cli-'));
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => {
  h.calls = 0;
});

const NOON = new Date('2026-10-28T12:00:00Z'); // Wednesday, GMT, outside the generator window

describe('parseArgs', () => {
  it('parses modes and flags', () => {
    expect(parseArgs(['plan', '--out', 'p.json', '--roots', 'a,b'])).toEqual({ mode: 'plan', flags: { out: 'p.json', roots: 'a,b' } });
    expect(parseArgs(['protect', '--slug', 's', '--off'])).toEqual({ mode: 'protect', flags: { slug: 's', off: true } });
  });
  it('rejects unknown modes, flags, missing values and bad reasons', () => {
    expect(parseArgs([])).toHaveProperty('error');
    expect(parseArgs(['nope'])).toHaveProperty('error');
    expect(parseArgs(['plan'])).toHaveProperty('error'); // --out required
    expect(parseArgs(['plan', '--out'])).toHaveProperty('error');
    expect(parseArgs(['plan', '--out', 'x', '--bogus', 'y'])).toHaveProperty('error');
    expect(parseArgs(['hide', '--slug', 'a', '--reason', 'whim'])).toHaveProperty('error');
    expect(parseArgs(['apply', '--plan', 'p'])).toHaveProperty('error'); // --backup-dir required
  });
  it('--help style args do not crash', () => {
    expect(parseArgs(['--help'])).toHaveProperty('error');
  });
});

describe('generator window (Europe/London)', () => {
  it('is 00:40 inclusive to 06:40 exclusive, in summer and winter time', () => {
    expect(inGeneratorWindow(new Date('2026-07-15T23:39:00Z'))).toBe(false); // 00:39 BST
    expect(inGeneratorWindow(new Date('2026-07-15T23:40:00Z'))).toBe(true); // 00:40 BST
    expect(inGeneratorWindow(new Date('2026-07-16T05:39:00Z'))).toBe(true); // 06:39 BST
    expect(inGeneratorWindow(new Date('2026-07-16T05:40:00Z'))).toBe(false); // 06:40 BST
    expect(inGeneratorWindow(new Date('2026-12-01T00:40:00Z'))).toBe(true);
    expect(inGeneratorWindow(new Date('2026-12-01T06:40:00Z'))).toBe(false);
    expect(inGeneratorWindow(new Date('2026-12-01T23:00:00Z'))).toBe(false);
  });
});

describe('checkGates', () => {
  const on = { ENABLE_TAXONOMY: '1', TAXONOMY_STATE_FILE: '/x/state.json' };
  it('every DB-writing mode needs ENABLE_TAXONOMY=1 (exit 2, names the flag)', () => {
    for (const m of ['apply', 'weekly', 'undo', 'hide', 'unhide', 'protect'] as const) {
      const r = checkGates(m, {}, NOON);
      expect(r?.code).toBe(2);
      expect(r?.message).toContain('ENABLE_TAXONOMY=1');
      expect(checkGates(m, { ENABLE_TAXONOMY: '0' }, NOON)?.code).toBe(2);
    }
  });
  it('plan never needs the flag, even in the window', () => {
    expect(checkGates('plan', {}, NOON)).toBeNull();
    expect(checkGates('plan', {}, new Date('2026-12-01T03:00:00Z'))).toBeNull();
  });
  it('apply and weekly refuse inside 00:40-06:40 with exit 3 unless overridden', () => {
    const night = new Date('2026-12-01T03:00:00Z');
    expect(checkGates('apply', on, night)?.code).toBe(3);
    expect(checkGates('weekly', on, night)?.code).toBe(3);
    expect(checkGates('undo', on, night)?.code).toBe(3);
    expect(checkGates('apply', { ...on, TAXONOMY_ALLOW_WINDOW: '1' }, night)).toBeNull();
    expect(checkGates('apply', on, NOON)).toBeNull();
    // hide / unhide / protect are not window-gated
    for (const m of ['hide', 'unhide', 'protect'] as const) expect(checkGates(m, on, night)).toBeNull();
  });
  it('weekly needs TAXONOMY_STATE_FILE (exit 2); plan and apply do not', () => {
    const r = checkGates('weekly', { ENABLE_TAXONOMY: '1' }, NOON);
    expect(r?.code).toBe(2);
    expect(r?.message).toContain('TAXONOMY_STATE_FILE');
    expect(checkGates('apply', { ENABLE_TAXONOMY: '1' }, NOON)).toBeNull();
    expect(checkGates('plan', {}, NOON)).toBeNull();
  });
  it('weekly refuses on a Monday, allows Thursday 23:00', () => {
    expect(checkGates('weekly', on, new Date('2026-10-26T12:00:00Z'))?.code).toBe(3);
    expect(checkGates('weekly', on, new Date('2026-10-29T23:00:00Z'))).toBeNull();
  });
});

describe('governor environment (window safety)', () => {
  const at = new Date('2026-10-28T12:00:00');
  it('apply and weekly default the deadline to 00:35 so a run cannot reach the generator window', () => {
    for (const m of ['apply', 'weekly'] as const) {
      const env = governorEnv(m, { RUN_DEADLINE_LOCAL: '06:30' });
      expect(env.RUN_DEADLINE_LOCAL).toBe('00:35');
      const d = governorConfigFromEnv(at, env).deadline;
      expect([d.getHours(), d.getMinutes()]).toEqual([0, 35]);
    }
  });
  it('plan keeps the normal deadline; the override restores it; manual runs get a 24 h window', () => {
    expect(governorEnv('plan', {}).RUN_DEADLINE_LOCAL).toBeUndefined();
    expect(governorEnv('apply', { TAXONOMY_ALLOW_WINDOW: '1' }).RUN_DEADLINE_LOCAL).toBeUndefined();
    expect(governorEnv('apply', {}).RUN_MAX_HOURS).toBe('24');
    expect(governorEnv('apply', { RUN_MAX_HOURS: '5' }).RUN_MAX_HOURS).toBe('5');
  });
});

describe('weeklyBudgetPoints (floor of 3, ceiling of one night)', () => {
  it('arithmetic at night budgets of 2, 3, 12 and 40 (share 0.10)', () => {
    expect(weeklyBudgetPoints(2, 0.1)).toBe(2); // never above one night (the job skips: night < 3)
    expect(weeklyBudgetPoints(3, 0.1)).toBe(3);
    expect(weeklyBudgetPoints(12, 0.1)).toBe(3); // 1.2 raised to the floor
    expect(weeklyBudgetPoints(40, 0.1)).toBe(4);
    expect(weeklyBudgetPoints(40, 5)).toBe(40);
  });
});

describe('run ids and paths', () => {
  it('weeklyRunId is the ISO year-week', () => {
    expect(weeklyRunId(new Date('2026-10-29T23:00:00Z'))).toBe('weekly-2026-W44');
    expect(weeklyRunId(new Date('2027-01-03T12:00:00Z'))).toBe('weekly-2026-W53');
    expect(weeklyRunId(new Date('2026-01-01T12:00:00Z'))).toBe('weekly-2026-W01');
  });
  it('planFileHash depends only on the file bytes', () => {
    const a = join(tmp, 'h1.json'), b = join(tmp, 'h2.json'), c = join(tmp, 'h3.json');
    writeFileSync(a, '{"merges":[]}'); writeFileSync(b, '{"merges":[]}'); writeFileSync(c, '{"hides":[]}');
    expect(planFileHash(a)).toBe(planFileHash(b));
    expect(planFileHash(a)).not.toBe(planFileHash(c));
    expect(planFileHash(a)).toMatch(/^[0-9a-f]{10}$/);
  });
  it('insideRepo', () => {
    expect(insideRepo('/r/repo/out', '/r/repo')).toBe(true);
    expect(insideRepo('/r/repo', '/r/repo')).toBe(true);
    expect(insideRepo('/r/repo-other/out', '/r/repo')).toBe(false);
    expect(insideRepo('/tmp/x', '/r/repo')).toBe(false);
  });
  it('insideRepo follows symlinks through the nearest existing parent', () => {
    const root = join(tmp, 'fake-repo');
    mkdirSync(root, { recursive: true });
    symlinkSync(root, join(tmp, 'lnk'));
    expect(insideRepo(join(tmp, 'lnk', 'not', 'yet', 'made'), root)).toBe(true);
    expect(insideRepo(join(tmp, 'elsewhere', 'x'), root)).toBe(false);
  });
  it('refuses a backup dir inside the repo checkout (exit 2) before touching anything', async () => {
    const lines: string[] = [];
    const created = vi.fn();
    const code = await runCli(['apply', '--plan', 'p.json', '--backup-dir', join(process.cwd(), 'bk')], { ENABLE_TAXONOMY: '1' }, {
      now: () => NOON, out: (l) => lines.push(l), err: () => {}, createSupabase: created as never,
    });
    expect(code).toBe(2);
    expect(created).not.toHaveBeenCalled();
    expect(lastJson(lines).report).toContain('inside the repository');
  });
});

describe('runCli gating', () => {
  it('refuses apply without the kill switch: exit 2, JSON last line, no DB client created', async () => {
    const lines: string[] = [];
    const createSupabase = vi.fn();
    const code = await runCli(['apply', '--plan', 'p.json', '--backup-dir', tmp], {}, {
      now: () => NOON, out: (l) => lines.push(l), err: () => {}, createSupabase: createSupabase as never,
    });
    expect(code).toBe(2);
    expect(createSupabase).not.toHaveBeenCalled();
    const j = lastJson(lines);
    expect(j.status).toBe('refused');
    expect(j.mode).toBe('apply');
    expect(j.report).toContain('ENABLE_TAXONOMY=1');
  });
  it.each([['weekly', []], ['hide', ['--slug', 'x']], ['undo', ['--run', 'r1']], ['unhide', ['--slug', 'x']], ['protect', ['--slug', 'x']]])(
    '%s without the kill switch exits 2',
    async (mode, extra) => {
      const lines: string[] = [];
      const code = await runCli([mode as string, ...(extra as string[])], {}, { now: () => NOON, out: (l) => lines.push(l), err: () => {} });
      expect(code).toBe(2);
      expect(lastJson(lines).report).toContain('ENABLE_TAXONOMY=1');
    },
  );
  it('apply inside the window exits 3 with a clear message', async () => {
    const lines: string[] = [];
    const code = await runCli(['apply', '--plan', 'p.json', '--backup-dir', tmp], { ENABLE_TAXONOMY: '1' }, {
      now: () => new Date('2026-12-01T03:00:00Z'), out: (l) => lines.push(l), err: () => {},
    });
    expect(code).toBe(3);
    expect(lastJson(lines).report).toContain('00:40-06:40');
  });
  it('bad arguments exit 2 with a JSON line', async () => {
    const lines: string[] = [];
    expect(await runCli(['plan'], {}, { out: (l) => lines.push(l), err: () => {} })).toBe(2);
    expect(lastJson(lines).status).toBe('error');
  });
});

describe('readPlanFile', () => {
  const w = (name: string, body: string): string => {
    const p = join(tmp, name);
    writeFileSync(p, body);
    return p;
  };
  it('accepts a valid plan', () => {
    const p = readPlanFile(w('ok.json', JSON.stringify({ merges: [{ survivor: 'a', absorbed: ['b'], why: 'x' }], hides: [] })));
    expect(p.merges[0].survivor).toBe('a');
    expect(p.creates).toEqual([]);
  });
  it('rejects anything else', () => {
    expect(() => readPlanFile(w('arr.json', '[]'))).toThrow();
    expect(() => readPlanFile(w('empty.json', '{}'))).toThrow();
    expect(() => readPlanFile(w('junk.json', 'not json'))).toThrow('not valid JSON');
    expect(() => readPlanFile(w('extra.json', JSON.stringify({ merges: [], sql: 'drop table x' })))).toThrow('only the plan keys');
    expect(() => readPlanFile(w('shape.json', JSON.stringify({ merges: [{ survivor: 1 }] })))).toThrow('validation');
    expect(() => readPlanFile(join(tmp, 'missing.json'))).toThrow();
  });
});

describe('exportBackup', () => {
  const seed = (n: number): Record<string, Row[]> => ({
    categories: [{ id: 'c1', slug: 'a' }, { id: 'c2', slug: 'b' }],
    question_categories: Array.from({ length: n }, (_, i) => ({ question_id: `q${String(i).padStart(5, '0')}`, category_id: 'c1' })),
    category_aliases: [{ old_slug: 'x', category_id: 'c1' }],
  });
  it('pages every table (>1000 rows), verifies, writes 0600', async () => {
    const db = makeFakeDb(seed(2300));
    const dir = join(tmp, 'bk1', 'nested');
    const r = await exportBackup(db.client, dir, 'run-a', NOON);
    expect(r.counts).toEqual({ categories: 2, question_categories: 2300, category_aliases: 1 });
    const body = JSON.parse(readFileSync(r.file, 'utf8'));
    expect(body.tables.question_categories).toHaveLength(2300);
    expect(r.file).toMatch(/taxonomy-backup-run-a-\d{8}T\d{6}\.json$/);
  });
  it('refuses on a DB error, on zero categories, and never overwrites', async () => {
    const bad = { from: () => ({ select: () => ({ order: function () { return this; }, range: async () => ({ data: null, error: { message: 'boom' } }) }) }) };
    await expect(exportBackup(bad as never, join(tmp, 'bk2'), 'r', NOON)).rejects.toThrow('boom');
    const lying = makeFakeDb(seed(3));
    const realFrom = (lying.client as never as { from: (t: string) => unknown }).from;
    const wrapped = { from: (t: string) => {
      const q = realFrom(t) as { select: (c: string, o?: { head?: boolean }) => unknown };
      const sel = q.select.bind(q);
      q.select = (c: string, o?: { head?: boolean }) => (o?.head ? Promise.resolve({ data: null, error: null, count: 999 }) : sel(c, o));
      return q;
    } };
    await expect(exportBackup(wrapped as never, join(tmp, 'bk5'), 'r', NOON)).rejects.toThrow('database reports 999');
    expect(readdirSync(tmp).includes('bk5')).toBe(false);
    const empty = makeFakeDb({ categories: [] });
    await expect(exportBackup(empty.client, join(tmp, 'bk3'), 'r', NOON)).rejects.toThrow('zero categories');
    const db = makeFakeDb(seed(3));
    await exportBackup(db.client, join(tmp, 'bk4'), 'same', NOON);
    await expect(exportBackup(db.client, join(tmp, 'bk4'), 'same', NOON)).rejects.toThrow();
  });
});

// ---- end to end against the in-memory fake (never the live DB) ----
const cat = (slug: string, parent: string | null, depth: number, extra: Row = {}): Row => ({
  id: `id-${slug}`, slug, name: slug.toUpperCase(), parent_id: parent ? `id-${parent}` : null, depth,
  hidden_at: null, hidden_reason: null, protected: false, created_by: 'seed', ...extra,
});
const vis = (slug: string, n: number): Row => ({ category_id: `id-${slug}`, distinct_published: n });
const info = (): RateLimitInfo => ({
  status: 'allowed', fiveHour: { utilization: 0.1, resetsAt: Math.floor(NOON.getTime() / 1000) + 3600 },
  weekly: { seven_day: { utilization: 0.1, resetsAt: Math.floor(NOON.getTime() / 1000) + 3 * 86400 } },
  overageStatus: null, isUsingOverage: false,
});

describe('runCli plan (fake db, stubbed model)', () => {
  it('writes a validated plan, makes NO database writes, ends with the JSON line', async () => {
    const db = makeFakeDb({
      categories: [cat('sci', null, 0), cat('phys', 'sci', 1), cat('physics', 'sci', 1), cat('art', null, 0)],
      category_visibility: [vis('sci', 30), vis('phys', 2), vis('physics', 20), vis('art', 5)],
    });
    h.handler = () => JSON.stringify({
      merges: [{ survivor: 'physics', absorbed: ['phys'], why: 'dup' }, { survivor: 'ghost', absorbed: ['phys'], why: 'hallucinated' }],
      hides: [], creates: [{ slug: 'quantum', name: 'Quantum', parent: 'sci', why: 'niche' }],
    });
    const files: Record<string, string> = {};
    const lines: string[] = [];
    const code = await runCli(['plan', '--out', 'plan.json', '--md', 'plan.md', '--roots', 'sci'], {}, {
      now: () => NOON, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client,
      probe: async () => info(), writeFile: (p, t) => { files[p] = t; },
    });
    expect(code).toBe(0);
    expect(db.writes()).toBe(0);
    const plan = JSON.parse(files['plan.json']);
    expect(plan.merges).toHaveLength(1);
    expect(plan.creates[0].slug).toBe('quantum');
    expect(files['plan.md']).toContain('Rejected');
    const j = lastJson(lines);
    expect(j.status).toBe('ok');
    expect(j.report.length).toBeLessThanOrEqual(3500);
    expect(h.calls).toBe(1);
  });

  it('stops cleanly (status stopped, exit 0) when usage is unreadable', async () => {
    const db = makeFakeDb({ categories: [cat('sci', null, 0)] });
    const lines: string[] = [];
    const code = await runCli(['plan', '--out', 'p.json'], {}, {
      now: () => NOON, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client, probe: async () => null,
      writeFile: () => { throw new Error('should not write'); },
    });
    expect(code).toBe(0);
    expect(lastJson(lines).status).toBe('stopped');
    expect(h.calls).toBe(0);
  });
});

describe('runCli apply (fake db, stubbed model)', () => {
  const seedApply = (): Record<string, Row[]> => ({
    categories: [cat('general-knowledge', null, 0), cat('sci', null, 0), cat('phys', 'sci', 1), cat('physics', 'sci', 1), cat('chem', 'sci', 1), cat('quantum', 'physics', 2)],
    questions: ['q1', 'q2', 'q3'].map((id) => ({ id, question_text: `t ${id}`, correct_answer: 'a', distractors: ['b', 'c', 'd'], status: 'published' })),
    question_categories: [
      { question_id: 'q1', category_id: 'id-phys', estimate_score: 50, observed_score: null, observed_n: 0 },
      { question_id: 'q1', category_id: 'id-sci', estimate_score: 50, observed_score: null, observed_n: 0 },
      { question_id: 'q2', category_id: 'id-physics', estimate_score: 50, observed_score: null, observed_n: 0 },
      { question_id: 'q2', category_id: 'id-sci', estimate_score: 50, observed_score: null, observed_n: 0 },
      { question_id: 'q3', category_id: 'id-chem', estimate_score: 50, observed_score: null, observed_n: 0 },
      { question_id: 'q3', category_id: 'id-sci', estimate_score: 50, observed_score: null, observed_n: 0 },
    ],
    category_visibility: [vis('sci', 3), vis('phys', 1), vis('physics', 5), vis('chem', 1), vis('quantum', 0)],
  });
  const env = { ENABLE_TAXONOMY: '1' };

  it('backs up first, re-validates, merges, classifies the survivor, reports', async () => {
    const db = makeFakeDb(seedApply());
    const dir = join(tmp, 'apply1');
    const planPath = join(tmp, 'apply1.plan.json');
    writeFileSync(planPath, JSON.stringify({
      merges: [{ survivor: 'physics', absorbed: ['phys'], why: 'dup' }, { survivor: 'nope', absorbed: ['chem'], why: 'stale' }],
    }));
    h.handler = (o) => {
      if (o.system?.includes('re-home')) {
        const prompt = o.prompt;
        // move q2 from physics to its child quantum; chem (a sibling, not a candidate) and a hallucinated id that must be dropped
        expect(prompt).toContain('q1');
        return JSON.stringify({ rehomes: [{ questionId: 'q2', from: 'physics', to: 'quantum' }, { questionId: 'q2', from: 'physics', to: 'chem' }, { questionId: 'zzz', from: 'physics', to: 'quantum' }], duplicates: [] });
      }
      return JSON.stringify({ scores: {}, reasoning: 'x' });
    };
    const lines: string[] = [];
    const files: Record<string, string> = {};
    const errs: string[] = [];
    const code = await runCli(['apply', '--plan', planPath, '--backup-dir', dir, '--report', 'r.txt'], env, {
      now: () => NOON, out: (l) => lines.push(l), err: (l) => errs.push(l), createSupabase: () => db.client, probe: async () => info(),
      writeFile: (p, t) => { files[p] = t; },
    });
    expect(errs.join('\n')).toContain('unknown slug: nope');
    expect(code).toBe(0);
    expect(readdirSync(dir).some((f) => f.startsWith('taxonomy-backup-apply-'))).toBe(true);
    const j = lastJson(lines);
    expect(j.status).toBe('ok');
    expect(j.report).toContain('Merged: 1');
    expect(j.report).toContain('Re-homed: 1');
    expect(files['r.txt']).toContain('Merged: 1');
    // phys absorbed into physics; the stale/hallucinated merge was rejected so chem stayed
    expect(db.tables.categories.find((c) => c.slug === 'chem')?.hidden_at).toBeNull();
    expect(db.tables.question_categories.some((l) => l.question_id === 'q2' && l.category_id === 'id-quantum')).toBe(true);
  });

  it('refuses to apply when the backup cannot be written (nothing changes)', async () => {
    const db = makeFakeDb(seedApply());
    const planPath = join(tmp, 'apply2.plan.json');
    writeFileSync(planPath, JSON.stringify({ merges: [{ survivor: 'physics', absorbed: ['phys'], why: 'dup' }] }));
    const blocker = join(tmp, 'a-file');
    writeFileSync(blocker, 'x');
    const lines: string[] = [];
    const code = await runCli(['apply', '--plan', planPath, '--backup-dir', join(blocker, 'sub')], env, {
      now: () => NOON, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client, probe: async () => info(),
    });
    expect(code).toBe(1);
    expect(lastJson(lines).status).toBe('failed');
    expect(db.writes()).toBe(0);
  });

  it('rejects a malformed plan file before touching anything', async () => {
    const db = makeFakeDb(seedApply());
    const planPath = join(tmp, 'apply3.plan.json');
    writeFileSync(planPath, '{"merges":"drop table"}');
    const lines: string[] = [];
    const code = await runCli(['apply', '--plan', planPath, '--backup-dir', join(tmp, 'apply3')], env, {
      now: () => NOON, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client, probe: async () => info(),
    });
    expect(code).toBe(1);
    expect(db.writes()).toBe(0);
    expect(readdirSync(tmp).includes('apply3')).toBe(false);
  });
});
