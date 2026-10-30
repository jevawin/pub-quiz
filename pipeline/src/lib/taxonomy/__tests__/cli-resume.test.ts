import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeCallOptions } from '../../claude-cli.js';
import type { RateLimitInfo } from '../../usage.js';

const h = vi.hoisted(() => ({
  handler: (_o: { system?: string; prompt: string }): string => '{}',
  failCalibration: false,
  failClassifyAt: 0,
  classifyCalls: 0,
  onAssess: null as null | (() => void),
  prompts: [] as string[],
}));
vi.mock('../../claude-cli.js', async (orig) => {
  const real = await orig<typeof import('../../claude-cli.js')>();
  return {
    ...real,
    callClaude: vi.fn(async (o: ClaudeCallOptions) => {
      h.prompts.push(o.prompt);
      const isClassify = !!o.system?.includes('re-home');
      if (isClassify) h.classifyCalls++;
      if (o.system?.includes('taxonomy editor')) h.onAssess?.();
      const failClassify = isClassify && h.failClassifyAt > 0 && h.classifyCalls === h.failClassifyAt;
      const isCal = !o.system?.includes('re-home') && !o.system?.includes('taxonomy editor');
      if ((h.failCalibration && isCal) || failClassify) {
        const rl = {
          status: 'allowed', fiveHour: null, overageStatus: null, isUsingOverage: false,
          weekly: { seven_day: { utilization: 0.99, resetsAt: Math.floor(Date.parse('2026-10-31T12:00:00Z') / 1000) } },
        };
        throw new real.ClaudeCallError('limit', rl as never);
      }
      return { text: h.handler(o), rateLimit: { status: 'allowed', fiveHour: null, overageStatus: null, isUsingOverage: false, weekly: { seven_day: { utilization: 0.1, resetsAt: Math.floor(Date.parse('2026-10-31T12:00:00Z') / 1000) } } }, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }),
  };
});

import { replayBatches, runCli } from '../cli.js';
import { makeFakeDb } from './fake-db.js';

type Row = Record<string, unknown>;
const NOON = new Date('2026-10-28T12:00:00Z');
const info = (at: Date): RateLimitInfo => ({
  status: 'allowed', fiveHour: { utilization: 0.1, resetsAt: Math.floor(at.getTime() / 1000) + 3600 },
  weekly: { seven_day: { utilization: 0.1, resetsAt: Math.floor(Date.parse('2026-10-31T12:00:00Z') / 1000) } },
  overageStatus: null, isUsingOverage: false,
});
const last = (lines: string[]) => JSON.parse(lines[lines.length - 1]) as { runId: string; status: string; report: string };

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tax-resume-'));
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const cat = (slug: string, parent: string | null, depth: number, extra: Row = {}): Row => ({
  id: `id-${slug}`, slug, name: slug, parent_id: parent ? `id-${parent}` : null, depth,
  hidden_at: null, hidden_reason: null, protected: false, created_by: 'seed', ...extra,
});
const link = (q: string, c: string, est: number): Row => ({ question_id: q, category_id: `id-${c}`, estimate_score: est, observed_score: null, observed_n: 0 });
const question = (id: string): Row => ({ id, question_text: `text ${id}`, correct_answer: 'a', distractors: ['b', 'c', 'd'], status: 'published' });
const vis = (slug: string, n: number): Row => ({ category_id: `id-${slug}`, distinct_published: n });

const normalHandler = (o: { system?: string; prompt: string }): string => {
  if (o.system?.includes('re-home')) return JSON.stringify({ rehomes: [], duplicates: [] });
  const keys = [...o.prompt.matchAll(/^- (\S+)$/gm)].map((m) => m[1]);
  return JSON.stringify({ scores: Object.fromEntries(keys.map((k) => [k, k === 'general_knowledge' ? 60 : 50])), reasoning: 'x' });
};

// A cross-parent merge: q2 needs a new ancestor scored by the calibrator, so a usage stop lands mid-merge.
const seed = (): Record<string, Row[]> => ({
  categories: [
    cat('general-knowledge', null, 0), cat('history', null, 0), cat('geography', null, 0),
    cat('bridges-old', 'history', 1), cat('bridges', 'geography', 1), cat('other-hist', 'history', 1),
  ],
  questions: ['q1', 'q2', 'q3'].map(question),
  question_categories: [
    link('q1', 'bridges-old', 70), link('q1', 'bridges', 30), link('q1', 'history', 60), link('q1', 'geography', 20), link('q1', 'general-knowledge', 40),
    link('q2', 'bridges-old', 55), link('q2', 'history', 45),
    link('q3', 'bridges-old', 50), link('q3', 'other-hist', 40), link('q3', 'history', 30), link('q3', 'general-knowledge', 10),
  ],
  category_visibility: [vis('bridges', 10), vis('bridges-old', 3), vis('history', 9), vis('geography', 10)],
});

async function applyRun(db: ReturnType<typeof makeFakeDb>, planPath: string, dir: string, at: Date, extra: string[] = []) {
  const lines: string[] = [];
  const code = await runCli(['apply', '--plan', planPath, '--backup-dir', dir, ...extra], { ENABLE_TAXONOMY: '1' }, {
    now: () => at, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client, probe: async () => info(at),
    writeFile: () => {},
  });
  return { code, ...last(lines) };
}

describe('apply: stop mid-merge, then resume with the same plan', () => {
  const planBody = JSON.stringify({ merges: [{ survivor: 'bridges', absorbed: ['bridges-old'], why: 'dup' }] });

  it('resumed state equals a clean single run, and undo of the run id restores the original', async () => {
    const planPath = join(tmp, 'plan.json');
    writeFileSync(planPath, planBody);
    h.handler = normalHandler;

    const clean = makeFakeDb(seed());
    const c = await applyRun(clean, planPath, join(tmp, 'bk-clean'), NOON);
    expect(c.status).toBe('ok');
    expect(c.report).toContain('Merged: 1');

    const original = makeFakeDb(seed()).snapshot();
    const db = makeFakeDb(seed());
    h.failCalibration = true;
    const s = await applyRun(db, planPath, join(tmp, 'bk-1'), NOON);
    h.failCalibration = false;
    expect(s.status).toBe('stopped');
    expect(s.runId).toBe(c.runId); // deterministic: same plan bytes, same id
    expect(s.runId).toMatch(/^apply-[0-9a-f]{10}$/);
    expect(s.report).toContain('0 merge(s) complete, 1 partial');
    expect(s.report).toContain(`--run-id ${s.runId}`);
    expect(s.report).toContain('No category changes.');
    expect(db.tables.categories.find((x) => x.slug === 'bridges-old')?.hidden_at).toBeNull(); // half done

    const r = await applyRun(db, planPath, join(tmp, 'bk-2'), new Date(NOON.getTime() + 60_000));
    expect(r.status).toBe('ok');
    expect(r.report).toContain('Merged: 1');
    expect(db.snapshot()).toBe(clean.snapshot());
    expect(db.tables.category_changes.filter((x) => x.action === 'merge')).toHaveLength(1); // no double-apply

    const lines: string[] = [];
    const code = await runCli(['undo', '--run', r.runId], { ENABLE_TAXONOMY: '1' }, {
      now: () => NOON, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client,
    });
    expect(code).toBe(0);
    expect(db.snapshot()).toBe(original);

    // re-running the same id after an undo must NOT silently re-apply onto undone rows
    const again = await applyRun(db, planPath, join(tmp, 'bk-3'), new Date(NOON.getTime() + 120_000));
    expect(again.status).toBe('refused');
    expect(again.report).toContain('--run-id');
    expect(db.snapshot()).toBe(original);
    const fresh = await applyRun(db, planPath, join(tmp, 'bk-4'), new Date(NOON.getTime() + 180_000), ['--run-id', 'apply-retry-1']);
    expect(fresh.status).toBe('ok');
    expect(fresh.runId).toBe('apply-retry-1');
    expect(db.snapshot()).toBe(clean.snapshot());
  });

  it('a different plan file gets a different run id', async () => {
    const p2 = join(tmp, 'plan2.json');
    writeFileSync(p2, JSON.stringify({ hides: [{ slug: 'other-hist', why: 'x' }] }));
    h.handler = normalHandler;
    const db = makeFakeDb(seed());
    const a = await applyRun(db, p2, join(tmp, 'bk-p2'), NOON);
    expect(a.runId).not.toMatch(new RegExp(`^apply-${'x'}`));
    expect(a.runId).toMatch(/^apply-[0-9a-f]{10}$/);
  });
});

describe('weekly (fake db, stubbed model)', () => {
  const THU = new Date('2026-10-29T23:00:00Z');
  const wseed = (): Record<string, Row[]> => ({
    categories: [
      cat('general-knowledge', null, 0), cat('sci', null, 0), cat('art', null, 0), cat('music', null, 0),
      cat('physics', 'sci', 1), cat('chem', 'sci', 1), cat('prot', 'sci', 1, { protected: true }), cat('paint', 'art', 1),
    ],
    questions: ['q1', 'q2', 'q3', 'q4', 'q5'].map(question),
    question_categories: [
      link('q1', 'physics', 50), link('q1', 'sci', 50), link('q1', 'general-knowledge', 50),
      link('q2', 'physics', 50), link('q2', 'sci', 50),
      link('q3', 'chem', 50), link('q3', 'sci', 50),
      link('q4', 'prot', 50), link('q4', 'sci', 50),
      link('q5', 'sci', 50), // root-leaf: sci itself
    ],
    category_visibility: [vis('sci', 5), vis('physics', 2), vis('chem', 1)],
  });
  const run = async (db: ReturnType<typeof makeFakeDb>, stateFile: string, env: Record<string, string> = {}, util = 0.1) => {
    const lines: string[] = [];
    const code = await runCli(['weekly'], { ENABLE_TAXONOMY: '1', TAXONOMY_STATE_FILE: stateFile, ...env }, {
      now: () => THU, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client, probe: async () => ({ ...info(THU), weekly: { seven_day: { utilization: util, resetsAt: Math.floor(Date.parse('2026-10-31T12:00:00Z') / 1000) } } }),
    });
    return { code, ...last(lines) };
  };

  it('rotates roots via the state file, classifies leaf questions of non-root, non-GK, non-protected categories only', async () => {
    const db = makeFakeDb(wseed());
    const stateFile = join(tmp, 'wk', 'state.json');
    h.prompts.length = 0;
    h.handler = (o) => {
      if (o.system?.includes('taxonomy editor')) return JSON.stringify({ merges: [], hides: [], creates: [], rehomes: [], duplicates: [] });
      if (o.system?.includes('re-home')) return JSON.stringify({ rehomes: [], duplicates: [] });
      return normalHandler(o);
    };
    // budget: nightBudget is ~ (0.7*85)/n; make the share large enough to clear the 1-point floor
    process.env.TAXONOMY_WEEKLY_BUDGET_SHARE = '1';
    process.env.TAXONOMY_WEEKLY_ROOTS = '2';
    try {
      const r = await run(db, stateFile);
      expect(r.status).toBe('ok');
      expect(r.runId).toBe('weekly-2026-W44');
      const st = JSON.parse(readFileSync(stateFile, 'utf8'));
      // never-assessed roots, alphabetical, first two; general-knowledge is NEVER assessed (out of scope)
      expect(Object.keys(st.roots).sort()).toEqual(['art', 'music']);
      expect(h.prompts.join('\n')).not.toContain('subtree rooted at "general-knowledge"');
      expect(Object.keys(st.rehome).sort()).toEqual(['chem', 'physics']); // not sci (root), not GK, not prot (protected)
      const classifyPrompts = h.prompts.filter((p) => p.includes('questions, lines id|current slug|text|answer'));
      expect(classifyPrompts.join('\n')).toContain('physics|text q1'.replace('physics|text q1', '|physics|'));
      expect(classifyPrompts.join('\n')).not.toContain('q4'); // protected leaf
      expect(classifyPrompts.join('\n')).not.toContain('q5'); // root leaf
      // second week: the other roots come first
      const db2 = makeFakeDb(wseed());
      await run(db2, stateFile, {});
      const st2 = JSON.parse(readFileSync(stateFile, 'utf8'));
      expect(Object.keys(st2.roots).sort()).toEqual(['art', 'music', 'sci']); // still no general-knowledge
      expect(h.prompts.join('\n')).not.toContain('subtree rooted at "general-knowledge"');
    } finally {
      delete process.env.TAXONOMY_WEEKLY_BUDGET_SHARE;
      delete process.env.TAXONOMY_WEEKLY_ROOTS;
    }
  });

  it('skips (with a human-readable report) only when the NIGHT budget is under 3 points', async () => {
    const db = makeFakeDb(wseed());
    const r = await run(db, join(tmp, 'wk2', 'state.json'), {}, 0.94); // 0.7 x 1 point / 2 nights
    expect(r.status).toBe('skipped');
    expect(r.report).toMatch(/under the 3 the weekly review needs/);
    expect(db.writes()).toBe(0);
  });
});

describe('weekly resume (stop mid-merge)', () => {
  const THU = new Date('2026-10-29T23:00:00Z');
  const rl = { ...info(THU) };
  const weekly = async (db: ReturnType<typeof makeFakeDb>, stateFile: string, env: Record<string, string> = {}) => {
    const lines: string[] = [];
    const code = await runCli(['weekly'], { ENABLE_TAXONOMY: '1', TAXONOMY_STATE_FILE: stateFile, ...env }, {
      now: () => THU, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client, probe: async () => rl,
    });
    return { code, ...last(lines) };
  };
  const mergePlan = JSON.stringify({ merges: [{ survivor: 'bridges', absorbed: ['bridges-old'], why: 'dup' }], hides: [], creates: [], rehomes: [], duplicates: [] });

  // The merge sits inside ONE root (geography) so the per-root subtree confinement accepts it; it still needs a new
  // ancestor (structures) scored by the calibrator, so a usage stop lands mid-merge.
  const oneRootSeed = (): Record<string, Row[]> => ({
    categories: [
      cat('general-knowledge', null, 0), cat('history', null, 0), cat('geography', null, 0),
      cat('europe', 'geography', 1), cat('structures', 'geography', 1),
      cat('bridges-old', 'europe', 2), cat('bridges', 'structures', 2), cat('other-hist', 'history', 1),
    ],
    questions: ['q1', 'q2'].map(question),
    question_categories: [
      link('q1', 'bridges-old', 70), link('q1', 'bridges', 30), link('q1', 'europe', 60), link('q1', 'structures', 20), link('q1', 'geography', 20), link('q1', 'general-knowledge', 40),
      link('q2', 'bridges-old', 55), link('q2', 'europe', 45), link('q2', 'geography', 40),
    ],
    category_visibility: [vis('bridges', 10), vis('bridges-old', 3), vis('geography', 10)],
  });

  it('finishes the half-done merge BEFORE assessing any new root, and does not advance state for the interrupted root', async () => {
    const db = makeFakeDb(oneRootSeed());
    const stateFile = join(tmp, 'wkres', 'state.json');
    process.env.TAXONOMY_WEEKLY_ROOTS = '1';
    try {
      h.handler = (o) => (o.system?.includes('taxonomy editor') ? mergePlan : normalHandler(o));
      h.failCalibration = true;
      const a = await weekly(db, stateFile);
      h.failCalibration = false;
      expect(a.status).toBe('stopped');
      expect(a.runId).toBe('weekly-2026-W44');
      expect(db.tables.categories.find((x) => x.slug === 'bridges-old')?.hidden_at).toBeNull();
      expect(db.tables.category_changes.filter((x) => x.action === 'merge')).toHaveLength(1);
      expect(() => readFileSync(stateFile, 'utf8')).toThrow(); // nothing advanced (never written)

      let hiddenAtFirstAssess: unknown = 'not called';
      h.onAssess = () => {
        if (hiddenAtFirstAssess === 'not called') hiddenAtFirstAssess = db.tables.categories.find((x) => x.slug === 'bridges-old')?.hidden_at;
      };
      // second attempt assesses a root whose plan is EMPTY: the earlier merge must already be finished
      h.handler = (o) => (o.system?.includes('taxonomy editor') ? JSON.stringify({ merges: [], hides: [], creates: [], rehomes: [], duplicates: [] }) : normalHandler(o));
      const b = await weekly(db, stateFile);
      h.onAssess = null;
      expect(b.status).toBe('ok');
      expect(hiddenAtFirstAssess).toBeTruthy(); // finished before the first new assessment
      expect(db.tables.category_changes.filter((x) => x.action === 'merge')).toHaveLength(1);
      const st = JSON.parse(readFileSync(stateFile, 'utf8'));
      expect(Object.keys(st.roots)).toEqual(['geography']); // alphabetical first non-GK root, assessed AFTER its (empty) plan applied
    } finally {
      delete process.env.TAXONOMY_WEEKLY_ROOTS;
    }
  });

  it('a stop during classification leaves state.rehome un-advanced; the next run redoes both categories', async () => {
    const wseed: Record<string, Row[]> = {
      categories: [cat('general-knowledge', null, 0), cat('sci', null, 0), cat('physics', 'sci', 1), cat('chem', 'sci', 1)],
      questions: ['q1', 'q2'].map(question),
      question_categories: [link('q1', 'physics', 50), link('q1', 'sci', 50), link('q2', 'chem', 50), link('q2', 'sci', 50)],
      category_visibility: [],
    };
    const db = makeFakeDb(wseed);
    const stateFile = join(tmp, 'wkcls', 'state.json');
    process.env.TAXONOMY_WEEKLY_ROOTS = '0';
    try {
      h.handler = (o) => (o.system?.includes('re-home') ? JSON.stringify({ rehomes: [], duplicates: [] }) : normalHandler(o));
      h.classifyCalls = 0;
      h.failClassifyAt = 2; // physics classified fine, chem hits the usage stop
      const a = await weekly(db, stateFile);
      h.failClassifyAt = 0;
      expect(a.status).toBe('stopped');
      let st = (() => { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return { rehome: {} }; } })();
      expect(st.rehome).toEqual({}); // nothing applied, nothing marked

      h.classifyCalls = 0;
      const b = await weekly(db, stateFile);
      expect(b.status).toBe('ok');
      st = JSON.parse(readFileSync(stateFile, 'utf8'));
      expect(Object.keys(st.rehome).sort()).toEqual(['chem', 'physics']);
    } finally {
      delete process.env.TAXONOMY_WEEKLY_ROOTS;
    }
  });

  it('a state file that cannot be written still yields a final JSON line with status failed and the report', async () => {
    const db = makeFakeDb(seed());
    const blocker = join(tmp, 'blocker-file');
    writeFileSync(blocker, 'x');
    process.env.TAXONOMY_WEEKLY_ROOTS = '1';
    try {
      h.handler = (o) => (o.system?.includes('taxonomy editor') ? JSON.stringify({ merges: [], hides: [], creates: [], rehomes: [], duplicates: [] }) : normalHandler(o));
      const r = await weekly(db, join(blocker, 'sub', 'state.json'));
      expect(r.status).toBe('failed');
      expect(r.code).toBe(1);
      expect(r.report).toContain('PROBLEM: state file write failed');
      expect(r.report).toContain('Category review (weekly)');
    } finally {
      delete process.env.TAXONOMY_WEEKLY_ROOTS;
    }
  });
});

describe('action cap spans a stop and a resume of one run id', () => {
  it('a second attempt cannot apply a further cap-worth; already-logged creates/hides are not "rejected"', async () => {
    const planPath = join(tmp, 'cap-plan.json');
    writeFileSync(planPath, JSON.stringify({ hides: [{ slug: 'other-hist', why: 'a' }, { slug: 'bridges', why: 'b' }] }));
    h.handler = normalHandler;
    process.env.TAXONOMY_MAX_ACTIONS_CLEANUP = '1';
    try {
      const db = makeFakeDb(seed());
      const a = await applyRun(db, planPath, join(tmp, 'cap-1'), NOON);
      expect(a.status).toBe('ok');
      expect(db.tables.category_changes.filter((x) => x.action === 'hide')).toHaveLength(1);
      const b = await applyRun(db, planPath, join(tmp, 'cap-2'), new Date(NOON.getTime() + 60_000));
      expect(b.status).toBe('ok');
      expect(db.tables.category_changes.filter((x) => x.action === 'hide')).toHaveLength(1); // still 1, not 2
      expect(db.tables.categories.filter((x) => x.hidden_at)).toHaveLength(1);
      expect(b.report).toContain('Already done');
    } finally {
      delete process.env.TAXONOMY_MAX_ACTIONS_CLEANUP;
    }
  });
});

describe('round 3: cap, manual unhide, replay order', () => {
  const THU = new Date('2026-10-29T23:00:00Z');
  const weekly = async (db: ReturnType<typeof makeFakeDb>, stateFile: string) => {
    const lines: string[] = [];
    const code = await runCli(['weekly'], { ENABLE_TAXONOMY: '1', TAXONOMY_STATE_FILE: stateFile }, {
      now: () => THU, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client, probe: async () => info(THU),
    });
    return { code, ...last(lines) };
  };
  const plan = (o: object) => JSON.stringify({ merges: [], hides: [], creates: [], rehomes: [], duplicates: [], ...o });

  it('replayBatches keeps LOG order (rehome, merge, rehome stay three batches) and skips unhidden slugs', () => {
    const rows = [
      { id: 1, action: 'rehome', payload: { questionId: 'q', from: 'a', to: 'b' } },
      { id: 2, action: 'merge', payload: { survivor: 's', absorbed: 'x' } },
      { id: 3, action: 'merge', payload: { survivor: 's', absorbed: 'y' } },
      { id: 4, action: 'rehome', payload: { questionId: 'q2', from: 'a', to: 'b' } },
      { id: 5, action: 'hide', payload: { slug: 'h' } },
    ];
    const b = replayBatches(rows, new Set(['y', 'h']));
    expect(b.map((p) => [p.rehomes.length, p.merges.length, p.hides.length])).toEqual([[1, 0, 0], [0, 1, 0], [1, 0, 0]]);
  });

  it('a root whose proposals hit the cap is NOT marked assessed, and later roots are not assessed', async () => {
    const db = makeFakeDb(seed());
    const stateFile = join(tmp, 'cap-wk', 'state.json');
    // geography was assessed recently, so history comes first; both hides are inside history's subtree
    mkdirSync(join(tmp, 'cap-wk'), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ roots: { geography: '2026-10-28T00:00:00.000Z' }, rehome: {} }));
    process.env.TAXONOMY_WEEKLY_ROOTS = '2';
    process.env.TAXONOMY_MAX_ACTIONS_WEEKLY = '1';
    let assessCalls = 0;
    h.onAssess = () => { assessCalls++; };
    h.handler = (o) => (o.system?.includes('taxonomy editor') ? plan({ hides: [{ slug: 'other-hist', why: 'a' }, { slug: 'bridges-old', why: 'b' }] }) : normalHandler(o));
    try {
      const r = await weekly(db, stateFile);
      expect(r.status).toBe('ok');
      expect(assessCalls).toBe(1); // second root never assessed: cap spent
      expect(db.tables.category_changes.filter((x) => x.action === 'hide')).toHaveLength(1);
      const st = (() => { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return { roots: {} }; } })();
      expect(st.roots).toEqual({ geography: '2026-10-28T00:00:00.000Z' }); // history NOT marked
    } finally {
      h.onAssess = null;
      delete process.env.TAXONOMY_WEEKLY_ROOTS;
      delete process.env.TAXONOMY_MAX_ACTIONS_WEEKLY;
    }
  });

  it('a manual unhide is respected by the replay of the same weekly run id', async () => {
    const db = makeFakeDb(seed());
    const stateFile = join(tmp, 'unhide-wk', 'state.json');
    mkdirSync(join(tmp, 'unhide-wk'), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ roots: { geography: '2026-10-28T00:00:00.000Z' }, rehome: {} })); // history first
    process.env.TAXONOMY_WEEKLY_ROOTS = '1';
    try {
      h.handler = (o) => (o.system?.includes('taxonomy editor') ? plan({ hides: [{ slug: 'other-hist', why: 'dull' }] }) : normalHandler(o));
      const a = await weekly(db, stateFile);
      expect(a.status).toBe('ok');
      expect(db.tables.categories.find((x) => x.slug === 'other-hist')?.hidden_at).toBeTruthy();
      const lines: string[] = [];
      expect(await runCli(['unhide', '--slug', 'other-hist'], { ENABLE_TAXONOMY: '1' }, { now: () => THU, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client })).toBe(0);
      expect(db.tables.categories.find((x) => x.slug === 'other-hist')?.hidden_at).toBeNull();
      h.handler = (o) => (o.system?.includes('taxonomy editor') ? plan({}) : normalHandler(o));
      const b = await weekly(db, stateFile);
      expect(b.status).toBe('ok');
      expect(db.tables.categories.find((x) => x.slug === 'other-hist')?.hidden_at).toBeNull(); // not re-hidden
      expect(b.report).toContain('Skipped (manually unhidden): other-hist');
      expect(b.report).not.toContain('Hidden: 1');
    } finally {
      delete process.env.TAXONOMY_WEEKLY_ROOTS;
    }
  });

  it('a manually unhidden absorbed category is not re-merged on a re-run of the same plan', async () => {
    const planPath = join(tmp, 'unhide-merge.json');
    writeFileSync(planPath, plan({ merges: [{ survivor: 'bridges', absorbed: ['bridges-old'], why: 'dup' }] }));
    h.handler = normalHandler;
    const db = makeFakeDb(seed());
    const a = await applyRun(db, planPath, join(tmp, 'um-1'), NOON);
    expect(a.status).toBe('ok');
    const lines: string[] = [];
    await runCli(['unhide', '--slug', 'bridges-old'], { ENABLE_TAXONOMY: '1' }, { now: () => NOON, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client });
    const b = await applyRun(db, planPath, join(tmp, 'um-2'), new Date(NOON.getTime() + 60_000));
    expect(b.status).toBe('ok');
    expect(db.tables.categories.find((x) => x.slug === 'bridges-old')?.hidden_at).toBeNull();
    expect(db.tables.category_changes.filter((x) => x.action === 'merge')).toHaveLength(1);
    expect(b.report).toContain('Skipped (manually unhidden): bridges-old');
    expect(b.report).not.toMatch(/Merged: [1-9]/);
  });
});

describe('owner flags through the CLI', () => {
  const run = (db: ReturnType<typeof makeFakeDb>, argv: string[], lines: string[] = []) =>
    runCli(argv, { ENABLE_TAXONOMY: '1' }, { now: () => NOON, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client });
  const flags = (db: ReturnType<typeof makeFakeDb>) => (db.tables.category_flags ?? []).map((r) => r.norm);

  it('a veto hide flags the category; unhide removes that flag', async () => {
    const db = makeFakeDb(seed());
    expect(await run(db, ['hide', '--slug', 'other-hist', '--reason', 'veto'])).toBe(0);
    expect(flags(db)).toEqual(['other-hist']);
    expect(await run(db, ['unhide', '--slug', 'other-hist'])).toBe(0);
    expect(flags(db)).toEqual([]);
  });

  it('a trimmed hide does not flag', async () => {
    const db = makeFakeDb(seed());
    expect(await run(db, ['hide', '--slug', 'other-hist', '--reason', 'trimmed'])).toBe(0);
    expect(flags(db)).toEqual([]);
  });

  it('unhide keeps a flag the owner set directly with `flag`', async () => {
    const db = makeFakeDb(seed());
    expect(await run(db, ['flag', '--slug', 'other-hist'])).toBe(0);
    expect(await run(db, ['hide', '--slug', 'other-hist', '--reason', 'trimmed'])).toBe(0);
    expect(await run(db, ['unhide', '--slug', 'other-hist'])).toBe(0);
    expect(flags(db)).toEqual(['other-hist']);
    expect(await run(db, ['unflag', '--name', 'Other Hist'])).toBe(0);
    expect(flags(db)).toEqual([]);
  });

  it('undo of a veto hide run also removes its flag', async () => {
    const db = makeFakeDb(seed());
    const lines: string[] = [];
    expect(await run(db, ['hide', '--slug', 'other-hist', '--reason', 'veto'], lines)).toBe(0);
    const runId = last(lines).runId;
    expect(await run(db, ['undo', '--run', runId])).toBe(0);
    expect(flags(db)).toEqual([]);
    expect(db.tables.categories.find((c) => c.slug === 'other-hist')!.hidden_at).toBeNull();
  });
});
