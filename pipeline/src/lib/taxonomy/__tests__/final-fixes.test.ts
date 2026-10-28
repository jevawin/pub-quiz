// Regression tests for the final whole-branch review fix wave (2026-10-27/28): C1, I1, I3, I4, report honesty.
// Fakes only: the in-memory fake DB and a stubbed model. Never the live DB, never a real model call.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeCallOptions } from '../../claude-cli.js';
import type { RateLimitInfo } from '../../usage.js';

const h = vi.hoisted(() => ({
  handler: (_o: { system?: string; prompt: string }): string => '{}',
  prompts: [] as string[],
}));
vi.mock('../../claude-cli.js', async (orig) => {
  const real = await orig<typeof import('../../claude-cli.js')>();
  return {
    ...real,
    callClaude: vi.fn(async (o: ClaudeCallOptions) => {
      h.prompts.push(o.prompt);
      return {
        text: h.handler(o),
        rateLimit: { status: 'allowed', fiveHour: null, overageStatus: null, isUsingOverage: false, weekly: { seven_day: { utilization: 0.1, resetsAt: Math.floor(Date.parse('2026-11-07T12:00:00Z') / 1000) } } },
        inputTokens: 0, outputTokens: 0, costUsd: 0,
      };
    }),
  };
});

import { checkGates, parseArgs, runCli } from '../cli.js';
import { applyPlan, setHidden } from '../apply.js';
import { ASSESS_SYSTEM } from '../assess.js';
import { validatePlan } from '../rules.js';
import * as rules from '../rules.js';
import { pickRehomeCategories } from '../select.js';
import { makeFakeDb, type FakeDb } from './fake-db.js';
import type { TaxNode, TaxPlan, TaxTree } from '../types.js';
import type { ClaudeCaller } from '../../claude.js';
import type { PipelineConfig } from '../../config.js';

type Row = Record<string, unknown>;
let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tax-final-'));
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// ---- helpers ----
const NOON = new Date('2026-10-28T12:00:00Z'); // Wednesday, outside the generator window
const THU = new Date('2026-10-29T23:00:00Z');
const info = (at: Date): RateLimitInfo => ({
  status: 'allowed', fiveHour: { utilization: 0.1, resetsAt: Math.floor(at.getTime() / 1000) + 3600 },
  weekly: { seven_day: { utilization: 0.1, resetsAt: Math.floor(Date.parse('2026-11-07T12:00:00Z') / 1000) } },
  overageStatus: null, isUsingOverage: false,
});
const last = (lines: string[]) => JSON.parse(lines[lines.length - 1]) as { runId: string; status: string; report: string };
const cat = (slug: string, parent: string | null, depth: number, extra: Row = {}): Row => ({
  id: `id-${slug}`, slug, name: slug, parent_id: parent ? `id-${parent}` : null, depth,
  hidden_at: null, hidden_reason: null, protected: false, created_by: 'seed', ...extra,
});
const link = (q: string, c: string, est = 50): Row => ({ question_id: q, category_id: `id-${c}`, estimate_score: est, observed_score: null, observed_n: 0 });
const question = (id: string): Row => ({ id, question_text: `text ${id}`, correct_answer: 'a', distractors: ['b', 'c', 'd'], status: 'published' });
const vis = (slug: string, n: number): Row => ({ category_id: `id-${slug}`, distinct_published: n });
const emptyPlan = (): TaxPlan => ({ merges: [], hides: [], creates: [], rehomes: [], duplicates: [] });
const scoreHandler = (o: { system?: string; prompt: string }): string => {
  if (o.system?.includes('re-home')) return JSON.stringify({ rehomes: [], duplicates: [] });
  if (o.system?.includes('taxonomy editor')) return JSON.stringify(emptyPlan());
  const keys = [...o.prompt.matchAll(/^- (\S+)$/gm)].map((m) => m[1]);
  return JSON.stringify({ scores: Object.fromEntries(keys.map((k) => [k, 50])), reasoning: 'x' });
};
const rootOf = (prompt: string): string | null => /subtree rooted at "([^"]+)"/.exec(prompt)?.[1] ?? null;

const mk = (slug: string, parent: string | null, depth: number, n = 0, extra: Partial<TaxNode> = {}): TaxNode => ({
  id: `id-${slug}`, slug, name: slug, parentId: parent ? `id-${parent}` : null, depth, distinctPublished: n,
  hidden: false, hiddenReason: null, protected: false, childIds: [], ...extra,
});
function tree(nodes: TaxNode[]): TaxTree {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) if (n.parentId) byId.get(n.parentId)!.childIds.push(n.id);
  return { byId, bySlug: new Map(nodes.map((n) => [n.slug, n])), aliases: new Map() };
}
const gkTree = () =>
  tree([
    mk('general-knowledge', null, 0, 500),
    mk('gk-child', 'general-knowledge', 1, 50),
    mk('science', null, 0, 50),
    mk('physics', 'science', 1, 20),
    mk('optics', 'physics', 2, 5),
    mk('chemistry', 'science', 1, 10),
    mk('geography', null, 0, 40),
    mk('bridges', 'geography', 1, 5),
  ]);
const vopts = { maxActions: 100, allowedQuestionIds: new Set(['q1']) };

const config = { claudeModelVerification: 'sonnet' } as PipelineConfig;
const call: ClaudeCaller = async (o) => ({ text: scoreHandler(o) }) as never;

// =====================================================================================
describe('C1: general-knowledge is protected everywhere', () => {
  it('validatePlan rejects GK (and GK descendants) as merge survivor/absorbed, hide target, create parent, rehome end', () => {
    const t = gkTree();
    const r = validatePlan(t, {
      ...emptyPlan(),
      merges: [
        { survivor: 'general-knowledge', absorbed: ['physics'], why: '' },
        { survivor: 'chemistry', absorbed: ['general-knowledge'], why: '' },
        { survivor: 'chemistry', absorbed: ['gk-child'], why: '' },
      ],
      hides: [{ slug: 'general-knowledge', why: '' }, { slug: 'gk-child', why: '' }],
      creates: [
        { slug: 'gk-new', name: 'GK new', parent: 'general-knowledge', why: '' },
        { slug: 'gk-deeper', name: 'GK deeper', parent: 'gk-child', why: '' },
      ],
      rehomes: [{ questionId: 'q1', from: 'physics', to: 'general-knowledge' }],
    }, vopts);
    expect(r.plan).toEqual(emptyPlan());
    expect(r.rejected).toHaveLength(8);
    for (const x of r.rejected) expect(x.reason).toContain('general-knowledge');
  });

  it('the apply engine refuses GK merges/hides/creates even when validatePlan is bypassed (replay/pinned path)', async () => {
    const db = makeFakeDb({
      categories: [cat('general-knowledge', null, 0), cat('gk-child', 'general-knowledge', 1), cat('history', null, 0), cat('other-hist', 'history', 1)],
      questions: ['q1'].map(question),
      question_categories: [link('q1', 'other-hist'), link('q1', 'history'), link('q1', 'general-knowledge')],
    });
    const before = JSON.stringify(db.tables);
    const s = await applyPlan(db.client, {} as TaxTree, {
      ...emptyPlan(),
      merges: [
        { survivor: 'other-hist', absorbed: ['general-knowledge'], why: '' },
        { survivor: 'general-knowledge', absorbed: ['other-hist'], why: '' },
        { survivor: 'other-hist', absorbed: ['gk-child'], why: '' },
      ],
      hides: [{ slug: 'general-knowledge', why: '' }, { slug: 'gk-child', why: '' }],
      creates: [{ slug: 'gk-new', name: 'n', parent: 'general-knowledge', why: '' }, { slug: 'gk-new2', name: 'n', parent: 'gk-child', why: '' }],
    }, { runId: 'r-gk', dryRun: false, call, config });
    expect(s.merged + s.hidden + s.created.length).toBe(0);
    expect(s.errors).toHaveLength(7);
    for (const e of s.errors) expect(e).toContain('general-knowledge is out of scope');
    expect(JSON.stringify(db.tables)).toBe(before); // not even a change-log row
    expect(db.writes()).toBe(0);
  });

  it('setHidden (manual `hide` CLI) refuses to hide GK or a GK descendant; unhiding GK stays allowed', async () => {
    const db = makeFakeDb({ categories: [cat('general-knowledge', null, 0), cat('gk-child', 'general-knowledge', 1)] });
    await expect(setHidden(db.client, 'general-knowledge', 'veto', 'hide-1')).rejects.toThrow(/general-knowledge is out of scope/);
    await expect(setHidden(db.client, 'gk-child', 'trimmed', 'hide-2')).rejects.toThrow(/general-knowledge is out of scope/);
    expect(db.writes()).toBe(0);
    await setHidden(db.client, 'general-knowledge', null, 'unhide-1'); // the repair path
    expect(db.tables.categories.find((c) => c.slug === 'general-knowledge')?.hidden_at).toBeNull();
  });

  it('plan mode never assesses GK: not in the default root list, and an explicit --roots general-knowledge is skipped', async () => {
    const db = makeFakeDb({ categories: [cat('general-knowledge', null, 0), cat('sci', null, 0), cat('art', null, 0)] });
    h.handler = scoreHandler;
    h.prompts.length = 0;
    const files: Record<string, string> = {};
    const run = async (extra: string[]) => {
      const lines: string[] = [];
      await runCli(['plan', '--out', 'p.json', '--md', 'p.md', ...extra], {}, {
        now: () => NOON, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client, probe: async () => info(NOON),
        writeFile: (p, t) => { files[p] = t; },
      });
      return last(lines);
    };
    const first = await run([]);
    expect(first.status).toBe('ok');
    const roots = h.prompts.map(rootOf);
    expect(roots.sort()).toEqual(['art', 'sci']);
    h.prompts.length = 0;
    await run(['--roots', 'general-knowledge']);
    expect(h.prompts).toHaveLength(0);
    expect(files['p.md']).toContain('out of scope');
  });

  it('re-home selection never picks a GK descendant', () => {
    const t = gkTree();
    const direct = new Map([['id-gk-child', 99], ['id-physics', 1]]);
    expect(pickRehomeCategories(t, direct, {}, 5, NOON)).toEqual(['physics']);
  });

  it('the assessor prompt says general-knowledge is out of scope', () => {
    expect(ASSESS_SYSTEM).toMatch(/general-knowledge is out of scope/);
  });
});

// =====================================================================================
describe('I1: plans are confined to their own subtree; roots are never merged or hidden', () => {
  it('confineToSubtree rejects a guessed slug from another root; creates may use the root as parent', () => {
    const t = gkTree();
    const r = rules.confineToSubtree(t, 'science', {
      ...emptyPlan(),
      merges: [{ survivor: 'physics', absorbed: ['bridges'], why: 'guessed' }, { survivor: 'physics', absorbed: ['optics'], why: 'ok' }],
      hides: [{ slug: 'bridges', why: 'guessed' }, { slug: 'chemistry', why: 'ok' }],
      creates: [
        { slug: 'under-root', name: 'x', parent: 'science', why: '' },
        { slug: 'chained', name: 'x', parent: 'under-root', why: '' },
        { slug: 'elsewhere', name: 'x', parent: 'geography', why: '' },
      ],
    });
    expect(r.plan.merges.map((m) => m.absorbed[0])).toEqual(['optics']);
    expect(r.plan.hides.map((x) => x.slug)).toEqual(['chemistry']);
    expect(r.plan.creates.map((c) => c.slug)).toEqual(['under-root', 'chained']);
    expect(r.rejected).toHaveLength(3);
    for (const x of r.rejected) expect(x.reason).toContain('outside assessed subtree');
  });

  it('validatePlan rejects any merge naming a root (either side) and any hide of a root', () => {
    const t = gkTree();
    const r = validatePlan(t, {
      ...emptyPlan(),
      merges: [{ survivor: 'science', absorbed: ['geography'], why: '' }, { survivor: 'physics', absorbed: ['geography'], why: '' }, { survivor: 'geography', absorbed: ['bridges'], why: '' }],
      hides: [{ slug: 'geography', why: '' }],
    }, vopts);
    expect(r.plan.merges).toHaveLength(0);
    expect(r.plan.hides).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason).every((m) => /root category cannot be (merged|hidden)/.test(m))).toBe(true);
  });

  it('plan mode: a hide/merge/create naming another root\'s slug is rejected as outside the assessed subtree', async () => {
    const db = makeFakeDb({
      categories: [cat('sci', null, 0), cat('physics', 'sci', 1), cat('art', null, 0), cat('paint', 'art', 1)],
      category_visibility: [vis('physics', 20), vis('paint', 3)],
    });
    h.handler = (o) =>
      rootOf(o.prompt) === 'sci'
        ? JSON.stringify({ ...emptyPlan(), merges: [{ survivor: 'physics', absorbed: ['paint'], why: 'guess' }], hides: [{ slug: 'paint', why: 'guess' }], creates: [{ slug: 'oils', name: 'Oils', parent: 'art', why: '' }, { slug: 'quantum', name: 'Quantum', parent: 'sci', why: '' }] })
        : JSON.stringify(emptyPlan());
    const files: Record<string, string> = {};
    const lines: string[] = [];
    await runCli(['plan', '--out', 'p.json', '--md', 'p.md'], {}, {
      now: () => NOON, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client, probe: async () => info(NOON),
      writeFile: (p, t) => { files[p] = t; },
    });
    const plan = JSON.parse(files['p.json']) as TaxPlan;
    expect(plan.merges).toEqual([]);
    expect(plan.hides).toEqual([]);
    expect(plan.creates.map((c) => c.slug)).toEqual(['quantum']);
    expect(files['p.md']).toContain('outside assessed subtree');
  });

  it('weekly: a root\'s plan cannot hide a category of another root', async () => {
    const db = makeFakeDb({
      categories: [cat('general-knowledge', null, 0), cat('art', null, 0), cat('paint', 'art', 1), cat('sci', null, 0), cat('physics', 'sci', 1)],
      questions: [], question_categories: [], category_visibility: [],
    });
    process.env.TAXONOMY_WEEKLY_ROOTS = '1';
    h.handler = (o) => (o.system?.includes('taxonomy editor') ? JSON.stringify({ ...emptyPlan(), hides: [{ slug: 'physics', why: 'guess' }] }) : scoreHandler(o));
    try {
      const lines: string[] = [];
      await runCli(['weekly'], { ENABLE_TAXONOMY: '1', TAXONOMY_STATE_FILE: join(tmp, 'i1wk', 'state.json') }, {
        now: () => THU, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client, probe: async () => info(THU),
      });
      expect(last(lines).status).toBe('ok');
      expect(db.tables.categories.find((c) => c.slug === 'physics')?.hidden_at).toBeNull();
    } finally {
      delete process.env.TAXONOMY_WEEKLY_ROOTS;
    }
  });

  it('the apply engine refuses to merge or hide a root even when validatePlan is bypassed', async () => {
    const db = makeFakeDb({ categories: [cat('history', null, 0), cat('geography', null, 0), cat('bridges', 'geography', 1)] });
    const s = await applyPlan(db.client, {} as TaxTree, {
      ...emptyPlan(),
      merges: [{ survivor: 'bridges', absorbed: ['history'], why: '' }],
      hides: [{ slug: 'history', why: '' }],
    }, { runId: 'r-root', dryRun: false, call, config });
    expect(s.errors.join('\n')).toMatch(/root category cannot be merged/);
    expect(s.errors.join('\n')).toMatch(/root category cannot be hidden/);
    expect(db.writes()).toBe(0);
  });
});

// =====================================================================================
describe('I3: one re-home error no longer freezes the weekly rotation', () => {
  // physics' only re-home always fails (its target is hidden mid-run); chem's succeeds.
  const seed = (): Record<string, Row[]> => ({
    categories: [
      cat('general-knowledge', null, 0), cat('sci', null, 0), cat('physics', 'sci', 1), cat('chem', 'sci', 1),
      cat('optics', 'physics', 2), cat('organic', 'chem', 2),
    ],
    questions: ['q1', 'q2'].map(question),
    question_categories: [link('q1', 'physics'), link('q1', 'sci'), link('q2', 'chem'), link('q2', 'sci')],
    category_visibility: [],
  });
  const handlerFor = (db: FakeDb) => (o: { system?: string; prompt: string }): string => {
    if (o.system?.includes('re-home')) {
      if (o.prompt.includes('q1|physics|')) {
        const optics = db.tables.categories.find((c) => c.slug === 'optics')!;
        optics.hidden_at = '2026-10-29T00:00:00.000Z';
        optics.hidden_reason = 'trimmed';
        return JSON.stringify({ rehomes: [{ questionId: 'q1', from: 'physics', to: 'optics' }], duplicates: [] });
      }
      if (o.prompt.includes('q2|chem|')) return JSON.stringify({ rehomes: [{ questionId: 'q2', from: 'chem', to: 'organic' }], duplicates: [] });
    }
    return scoreHandler(o);
  };
  const unhideOptics = (db: FakeDb) => {
    const optics = db.tables.categories.find((c) => c.slug === 'optics')!;
    optics.hidden_at = null;
    optics.hidden_reason = null;
  };
  const weekly = async (db: FakeDb, stateFile: string, at: Date) => {
    const lines: string[] = [];
    await runCli(['weekly'], { ENABLE_TAXONOMY: '1', TAXONOMY_STATE_FILE: stateFile }, {
      now: () => at, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client, probe: async () => info(at),
    });
    return last(lines);
  };

  it('marks the clean category, counts attempts per run id, and gives up after 2 failed runs with a report line', async () => {
    const db = makeFakeDb(seed());
    const stateFile = join(tmp, 'i3', 'state.json');
    h.handler = handlerFor(db);
    process.env.TAXONOMY_WEEKLY_ROOTS = '0';
    try {
      const a = await weekly(db, stateFile, THU);
      let st = JSON.parse(readFileSync(stateFile, 'utf8'));
      expect(Object.keys(st.rehome)).toEqual(['chem']); // old code: nothing marked (one error froze all)
      expect(st.rehomeAttempts).toEqual({ physics: { n: 1, run: 'weekly-2026-W44' } });
      expect(a.report).not.toContain('skipped after repeated errors');

      unhideOptics(db);
      await weekly(db, stateFile, THU); // a resume of the SAME run id does not count again
      st = JSON.parse(readFileSync(stateFile, 'utf8'));
      expect(st.rehomeAttempts).toEqual({ physics: { n: 1, run: 'weekly-2026-W44' } });
      expect(st.rehome.physics).toBeUndefined();

      unhideOptics(db);
      const nextWeek = new Date(THU.getTime() + 7 * 86_400_000);
      const c = await weekly(db, stateFile, nextWeek);
      st = JSON.parse(readFileSync(stateFile, 'utf8'));
      expect(st.rehome.physics).toBe(nextWeek.toISOString());
      expect(st.rehomeAttempts?.physics).toBeUndefined();
      expect(c.report).toContain('skipped after repeated errors: physics');
    } finally {
      delete process.env.TAXONOMY_WEEKLY_ROOTS;
    }
  });
});

// =====================================================================================
describe('I4: findChange scans the run log without the large prior snapshot', () => {
  it('no category_changes scan selects prior; prior is read by id only for a matched row', async () => {
    const db = makeFakeDb({
      categories: [cat('general-knowledge', null, 0), cat('history', null, 0), cat('other-hist', 'history', 1), cat('misc', 'history', 1)],
      questions: ['q1', 'q2', 'q3'].map(question),
      question_categories: [link('q3', 'other-hist'), link('q3', 'history')],
    });
    const plan: TaxPlan = {
      ...emptyPlan(),
      rehomes: [{ questionId: 'q3', from: 'other-hist', to: 'misc' }],
      duplicates: [{ keep: 'q1', flag: 'q2', why: 'dup' }],
    };
    await applyPlan(db.client, {} as TaxTree, plan, { runId: 'r-i4', dryRun: false, call, config });
    await applyPlan(db.client, {} as TaxTree, plan, { runId: 'r-i4', dryRun: false, call, config }); // resume: rows match
    const cc = db.selects.filter((x) => x.table === 'category_changes');
    const scans = cc.filter((x) => x.eqs.includes('run_id'));
    expect(scans.length).toBeGreaterThan(0);
    for (const x of scans) expect(x.cols).not.toMatch(/prior/);
    const priorReads = cc.filter((x) => /prior/.test(x.cols));
    expect(priorReads.length).toBeGreaterThan(0); // the matched rows' snapshots were fetched
    for (const x of priorReads) expect(x.eqs).toEqual(['id']);
  });
});

// =====================================================================================
describe('report honesty', () => {
  const applySeed = (): Record<string, Row[]> => ({
    categories: [
      cat('general-knowledge', null, 0), cat('history', null, 0), cat('geography', null, 0),
      cat('bridges-old', 'history', 1), cat('bridges', 'geography', 1), cat('other-hist', 'history', 1), cat('misc', 'history', 1),
      // depth chain for a depth-skip preview: survivor d4 at depth 4; absorbed x-old has a 2-level subtree
      cat('d1', 'geography', 1), cat('d2', 'd1', 2), cat('d3', 'd2', 3), cat('d4', 'd3', 4),
      cat('x-old', 'history', 1), cat('x-kid', 'x-old', 2), cat('x-gkid', 'x-kid', 3),
    ],
    questions: ['q1', 'q2'].map(question),
    question_categories: [link('q1', 'bridges-old'), link('q1', 'history')],
    category_visibility: [vis('bridges', 10), vis('bridges-old', 3), vis('d4', 10), vis('x-old', 1)],
  });
  const apply = async (db: FakeDb, planBody: object, extra: string[] = [], env: Record<string, string> = { ENABLE_TAXONOMY: '1' }, at = NOON, probe?: () => Promise<RateLimitInfo | null>) => {
    const planPath = join(tmp, `plan-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(planPath, JSON.stringify(planBody));
    const lines: string[] = [];
    const code = await runCli(['apply', '--plan', planPath, ...extra], env, {
      now: () => at, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client,
      probe: probe ?? (async () => info(at)), writeFile: () => { throw new Error('no report file expected'); },
    });
    return { code, ...last(lines) };
  };

  it('(a) a create logged but whose write failed is NOT counted as new; it is reported as not applied', async () => {
    const db = makeFakeDb(applySeed());
    db.onWrite((table, op) => { if (table === 'category_changes' && op === 'insert') db.killAfter(0); });
    const r = await apply(db, { creates: [{ slug: 'quantum', name: 'Quantum', parent: 'geography', why: '' }] }, ['--backup-dir', join(tmp, 'bk-a')]);
    expect(db.tables.categories.some((c) => c.slug === 'quantum')).toBe(false);
    expect(r.report).toContain('New: 0 (+1 logged but NOT applied');
    expect(r.report).not.toContain('New categories');
    expect(r.report).toMatch(/Errors: 1\n- create quantum: .*simulated crash/);
  });

  it('(a) a re-home logged but whose write failed is NOT counted as re-homed (weekly)', async () => {
    const db = makeFakeDb({
      categories: [cat('general-knowledge', null, 0), cat('sci', null, 0), cat('physics', 'sci', 1), cat('optics', 'physics', 2)],
      questions: ['q1'].map(question),
      question_categories: [link('q1', 'physics'), link('q1', 'sci')],
      category_visibility: [],
    });
    h.handler = (o) => (o.system?.includes('re-home') ? JSON.stringify({ rehomes: [{ questionId: 'q1', from: 'physics', to: 'optics' }], duplicates: [] }) : scoreHandler(o));
    db.onWrite((table, op) => { if (table === 'category_changes' && op === 'insert') db.killAfter(0); });
    process.env.TAXONOMY_WEEKLY_ROOTS = '0';
    try {
      const lines: string[] = [];
      await runCli(['weekly'], { ENABLE_TAXONOMY: '1', TAXONOMY_STATE_FILE: join(tmp, 'rh-a', 'state.json') }, {
        now: () => THU, out: (l) => lines.push(l), err: () => {}, createSupabase: () => db.client, probe: async () => info(THU),
      });
      const r = last(lines);
      expect(db.tables.category_changes.filter((c) => c.action === 'rehome')).toHaveLength(1); // logged
      expect(r.report).toContain('Re-homed: 0 (+1 logged but NOT applied');
      expect(r.report).toContain('Errors: 1');
    } finally {
      delete process.env.TAXONOMY_WEEKLY_ROOTS;
    }
  });

  it('(b) a survivor overridden at apply time is named in the report text', async () => {
    const db = makeFakeDb(applySeed());
    h.handler = scoreHandler;
    const r = await apply(db, { merges: [{ survivor: 'bridges-old', absorbed: ['bridges'], why: 'dup' }] }, ['--backup-dir', join(tmp, 'bk-b')]);
    expect(r.status).toBe('ok');
    expect(r.report).toContain('Merged: 1');
    expect(r.report).toContain('Survivor overridden (plan -> applied): bridges-old -> bridges');
  });

  it('(c) apply --dry-run: no ENABLE_TAXONOMY, inside the window, no probe, no backup; DB byte-identical; full preview', async () => {
    const db = makeFakeDb(applySeed());
    const before = JSON.stringify(db.tables);
    const writesBefore = db.writes();
    const backupDir = join(tmp, 'bk-dry');
    h.prompts.length = 0;
    process.env.TAXONOMY_MAX_ACTIONS_CLEANUP = '3';
    try {
      const r = await apply(
        db,
        {
          merges: [{ survivor: 'bridges-old', absorbed: ['bridges'], why: 'dup' }, { survivor: 'd4', absorbed: ['x-old'], why: 'deep' }],
          hides: [{ slug: 'other-hist', why: '' }, { slug: 'misc', why: '' }],
        },
        ['--dry-run'],
        {}, // no ENABLE_TAXONOMY
        new Date('2026-10-28T01:30:00Z'), // inside 00:40-06:40 London
        async () => { throw new Error('the dry run must not probe (a model call)'); },
      );
      expect(r.code).toBe(0);
      expect(r.status).toBe('ok');
      expect(r.report).toContain('DRY RUN');
      expect(r.report).toContain('Merged: 2');
      expect(r.report).toContain('Hidden: 1');
      expect(r.report).toContain('Survivor overridden (plan -> applied): bridges-old -> bridges');
      expect(r.report).toContain('Dropped: over the action cap (1): hide misc');
      expect(r.report).toMatch(/would NOT be re-parented \(depth\/cycle\) \(1\): merge x-old: child x-kid not re-parented/);
      expect(JSON.stringify(db.tables)).toBe(before);
      expect(db.writes()).toBe(writesBefore);
      expect(existsSync(backupDir)).toBe(false);
      expect(h.prompts).toHaveLength(0);
    } finally {
      delete process.env.TAXONOMY_MAX_ACTIONS_CLEANUP;
    }
  });

  it('(c) parseArgs/checkGates: --dry-run needs no --backup-dir and passes the kill switch and window; a real apply does not', () => {
    expect(parseArgs(['apply', '--plan', 'p', '--dry-run'])).toEqual({ mode: 'apply', flags: { plan: 'p', 'dry-run': true } });
    expect(parseArgs(['apply', '--plan', 'p'])).toHaveProperty('error');
    const inWindow = new Date('2026-10-28T01:30:00Z');
    expect(checkGates('apply', {}, inWindow, { dryRun: true })).toBeNull();
    expect(checkGates('apply', {}, inWindow)).not.toBeNull();
    expect(checkGates('apply', { ENABLE_TAXONOMY: '1' }, inWindow)).not.toBeNull();
  });
});
