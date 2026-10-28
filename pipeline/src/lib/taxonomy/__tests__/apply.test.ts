import { describe, it, expect } from 'vitest';
import { UsageStopError } from '../../usage.js';
import { applyPlan, undoRun, setHidden, setProtected } from '../apply.js';
import { makeFakeDb, type FakeDb } from './fake-db.js';
import type { TaxPlan, TaxTree } from '../types.js';
import type { ClaudeCaller } from '../../claude.js';
import type { PipelineConfig } from '../../config.js';

type Row = Record<string, unknown>;

const cat = (slug: string, parent: string | null, depth: number, extra: Row = {}): Row => ({
  id: `id-${slug}`, slug, name: slug, parent_id: parent ? `id-${parent}` : null, depth,
  hidden_at: null, hidden_reason: null, protected: false, created_by: 'seed', ...extra,
});
const link = (q: string, c: string, est: number, obsN = 0, extra: Row = {}): Row => ({
  question_id: q, category_id: `id-${c}`, estimate_score: est, observed_score: obsN ? est : null, observed_n: obsN, ...extra,
});
const question = (id: string): Row => ({
  id, question_text: `text ${id}`, correct_answer: 'a', distractors: ['b', 'c', 'd'], status: 'published',
});
const emptyPlan = (): TaxPlan => ({ merges: [], hides: [], creates: [], rehomes: [], duplicates: [] });
const tree = {} as TaxTree; // apply reads the live DB, never the stale tree

const config = { claudeModelVerification: 'sonnet' } as PipelineConfig;
let calls = 0;
const call: ClaudeCaller = async (opts) => {
  calls++;
  const keys = [...opts.prompt.matchAll(/^- (\S+)$/gm)].map((m) => m[1]);
  const scores = Object.fromEntries(keys.map((k) => [k, k === 'general_knowledge' ? 60 : 50]));
  return { text: JSON.stringify({ scores, reasoning: 'x' }) } as never;
};

function seed(): Record<string, Row[]> {
  return {
    categories: [
      cat('general-knowledge', null, 0),
      cat('history', null, 0),
      cat('geography', null, 0),
      cat('bridges-old', 'history', 1),
      cat('bridges', 'geography', 1),
      cat('other-hist', 'history', 1),
      cat('misc', 'history', 1),
    ],
    questions: ['q1', 'q2', 'q3', 'q4'].map(question),
    question_categories: [
      // q1: collision. absorbed obs 40 vs survivor obs 3
      link('q1', 'bridges-old', 70, 40), link('q1', 'bridges', 30, 3), link('q1', 'history', 60), link('q1', 'geography', 20), link('q1', 'general-knowledge', 40),
      // q2: cross-parent, no GK
      link('q2', 'bridges-old', 55), link('q2', 'history', 45),
      // q3: also has an unrelated leaf under history
      link('q3', 'bridges-old', 50), link('q3', 'other-hist', 40), link('q3', 'history', 30), link('q3', 'general-knowledge', 10),
      // q4: tie on observed_n (both 5): survivor's row wins
      link('q4', 'bridges-old', 99, 5), link('q4', 'bridges', 11, 5), link('q4', 'history', 5), link('q4', 'geography', 5),
    ],
    category_aliases: [{ old_slug: 'ancient-bridges', category_id: 'id-bridges-old' }],
  };
}

const mergePlan = (): TaxPlan => ({ ...emptyPlan(), merges: [{ survivor: 'bridges', absorbed: ['bridges-old'], why: 't' }] });
const opts = (db: FakeDb, runId = 'run1', dryRun = false) => ({ runId, dryRun, call, config });
const linksOf = (db: FakeDb, q: string) =>
  db.tables.question_categories.filter((l) => l.question_id === q).map((l) => String(l.category_id).replace('id-', '')).sort();
const rowOf = (db: FakeDb, q: string, c: string) =>
  db.tables.question_categories.find((l) => l.question_id === q && l.category_id === `id-${c}`);

describe('applyPlan: merge', () => {
  it('(a) collision keeps the higher observed_n row; ties keep the survivor row', async () => {
    const db = makeFakeDb(seed());
    const s = await applyPlan(db.client, tree, mergePlan(), opts(db));
    expect(s.errors).toEqual([]);
    expect(rowOf(db, 'q1', 'bridges')).toMatchObject({ observed_n: 40, estimate_score: 70 });
    expect(rowOf(db, 'q1', 'bridges-old')).toBeUndefined();
    expect(rowOf(db, 'q4', 'bridges')).toMatchObject({ observed_n: 5, estimate_score: 11 });
  });

  it('(b) cross-parent merge drops the stale history link, never GK, scores geography via calibrator', async () => {
    const db = makeFakeDb(seed());
    await applyPlan(db.client, tree, mergePlan(), opts(db));
    expect(linksOf(db, 'q2')).toEqual(['bridges', 'geography']); // history gone; GK not newly added
    expect(linksOf(db, 'q1')).toEqual(['bridges', 'general-knowledge', 'geography']);
  });

  it('(c) history link is kept when another leaf under history remains', async () => {
    const db = makeFakeDb(seed());
    await applyPlan(db.client, tree, mergePlan(), opts(db));
    expect(linksOf(db, 'q3')).toContain('history');
    expect(linksOf(db, 'q3')).toEqual(['bridges', 'general-knowledge', 'geography', 'history', 'other-hist']);
  });

  it('absorbed node is hidden last as merged, aliased, and existing aliases are re-pointed', async () => {
    const db = makeFakeDb(seed());
    await applyPlan(db.client, tree, mergePlan(), opts(db));
    const a = db.tables.categories.find((c) => c.slug === 'bridges-old')!;
    expect(a.hidden_reason).toBe('merged');
    expect(a.hidden_at).toBeTruthy();
    const aliases = Object.fromEntries(db.tables.category_aliases.map((x) => [x.old_slug, x.category_id]));
    expect(aliases).toEqual({ 'bridges-old': 'id-bridges', 'ancient-bridges': 'id-bridges' });
  });

  it('(d) a second run makes 0 writes and counts every action as already done', async () => {
    const db = makeFakeDb(seed());
    const plan: TaxPlan = {
      ...mergePlan(),
      hides: [{ slug: 'misc', why: 'dull' }],
      creates: [{ slug: 'viaducts', name: 'Viaducts', parent: 'bridges', why: 'x' }],
      rehomes: [{ questionId: 'q3', from: 'other-hist', to: 'viaducts' }],
      duplicates: [{ keep: 'q1', flag: 'q2', why: 'dup' }],
    };
    const first = await applyPlan(db.client, tree, plan, opts(db));
    expect(first.errors).toEqual([]);
    expect(first).toMatchObject({ merged: 1, hidden: 1, created: ['viaducts'], rehomed: 1, flagged: 1 });
    const w = db.writes();
    const second = await applyPlan(db.client, tree, plan, opts(db));
    expect(db.writes()).toBe(w);
    expect(second).toMatchObject({ merged: 0, hidden: 0, created: [], rehomed: 0, flagged: 0, skippedAlreadyDone: 5, errors: [] });
  });

  it('(e) undoRun restores links, hidden flags and aliases exactly', async () => {
    const db = makeFakeDb(seed());
    const before = db.snapshot();
    const plan: TaxPlan = {
      ...mergePlan(),
      hides: [{ slug: 'misc', why: 'dull' }],
      creates: [{ slug: 'viaducts', name: 'Viaducts', parent: 'bridges', why: 'x' }],
      rehomes: [{ questionId: 'q3', from: 'other-hist', to: 'viaducts' }],
      duplicates: [{ keep: 'q1', flag: 'q2', why: 'dup' }],
    };
    await applyPlan(db.client, tree, plan, opts(db));
    expect(db.snapshot()).not.toBe(before);
    const u = await undoRun(db.client, 'run1');
    expect(u.undone).toBe(5);
    expect(db.snapshot()).toBe(before);
  });

  it('undo applied twice is a no-op; changes carry undone_at', async () => {
    const db = makeFakeDb(seed());
    await applyPlan(db.client, tree, mergePlan(), opts(db));
    await undoRun(db.client, 'run1');
    const w = db.writes();
    const again = await undoRun(db.client, 'run1');
    expect(again.undone).toBe(0);
    expect(db.writes()).toBe(w);
    expect(db.tables.category_changes.every((c) => c.undone_at)).toBe(true);
  });

  it('undo runs newest first', async () => {
    const db = makeFakeDb(seed());
    const plan: TaxPlan = {
      ...emptyPlan(),
      creates: [{ slug: 'viaducts', name: 'V', parent: 'bridges', why: '' }],
      rehomes: [{ questionId: 'q3', from: 'other-hist', to: 'viaducts' }],
    };
    await applyPlan(db.client, tree, plan, opts(db));
    // If create were undone first the RESTRICT FK (rehomed link) would block it; reverse order succeeds.
    const u = await undoRun(db.client, 'run1');
    expect(u).toEqual({ undone: 2, blocked: 0 });
    expect(db.tables.categories.some((c) => c.slug === 'viaducts')).toBe(false);
  });

  it('(f) dryRun leaves the database untouched', async () => {
    const db = makeFakeDb(seed());
    const before = JSON.stringify(db.tables);
    const plan: TaxPlan = {
      ...mergePlan(),
      hides: [{ slug: 'misc', why: '' }],
      creates: [{ slug: 'viaducts', name: 'V', parent: 'bridges', why: '' }],
      rehomes: [{ questionId: 'q3', from: 'other-hist', to: 'viaducts' }],
      duplicates: [{ keep: 'q1', flag: 'q2', why: '' }],
    };
    const s = await applyPlan(db.client, tree, plan, opts(db, 'dry', true));
    expect(db.writes()).toBe(0);
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(s).toMatchObject({ merged: 1, hidden: 1, created: ['viaducts'], rehomed: 1, flagged: 1, errors: [] });
  });

  it('(g) a child that would exceed depth 5 is skipped with an error; other actions proceed', async () => {
    const s0 = seed();
    s0.categories.push(
      cat('a', 'history', 1), cat('b', 'a', 2), cat('deep', 'b', 3),
      cat('x-old', 'history', 1),
      cat('kid', 'x-old', 2), cat('g1', 'kid', 3), // fits under deep (kid 4, g1 5)
      cat('kid2', 'x-old', 2), cat('g2', 'kid2', 3), cat('gg2', 'g2', 4), // would reach 6
    );
    const db = makeFakeDb(s0);
    const plan: TaxPlan = {
      ...emptyPlan(),
      merges: [{ survivor: 'deep', absorbed: ['x-old'], why: '' }],
      hides: [{ slug: 'misc', why: '' }],
    };
    const s = await applyPlan(db.client, tree, plan, opts(db));
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toMatch(/kid2.*depth 6/);
    expect(s.hidden).toBe(1);
    const d = (slug: string) => db.tables.categories.find((c) => c.slug === slug)!;
    expect(d('kid')).toMatchObject({ parent_id: 'id-deep', depth: 4 });
    expect(d('g1').depth).toBe(5);
    expect(d('kid2')).toMatchObject({ parent_id: 'id-x-old', depth: 2 });
    expect(d('x-old').hidden_reason).toBe('merged');
    // undo restores the tree shape
    await undoRun(db.client, 'run1');
    expect(d('kid')).toMatchObject({ parent_id: 'id-x-old', depth: 2 });
    expect(d('g1').depth).toBe(3);
  });

  it('never newly adds GK to a question that lacked it', async () => {
    const db = makeFakeDb(seed());
    await applyPlan(db.client, tree, mergePlan(), opts(db));
    expect(linksOf(db, 'q2')).not.toContain('general-knowledge');
  });

  it('never deletes questions', async () => {
    const db = makeFakeDb(seed());
    await applyPlan(db.client, tree, mergePlan(), opts(db));
    expect(db.tables.questions).toHaveLength(4);
  });

  it('a failing write records an error and stops only that action', async () => {
    const db = makeFakeDb(seed());
    db.killAfter(0);
    const s = await applyPlan(db.client, tree, { ...mergePlan(), hides: [{ slug: 'misc', why: '' }] }, opts(db));
    expect(s.errors).toHaveLength(2);
    expect(s.merged + s.hidden).toBe(0);
  });
});

describe('applyPlan: crash and resume', () => {
  const plan = (): TaxPlan => ({
    ...mergePlan(),
    hides: [{ slug: 'misc', why: '' }],
    creates: [{ slug: 'viaducts', name: 'V', parent: 'bridges', why: '' }],
    rehomes: [{ questionId: 'q3', from: 'other-hist', to: 'viaducts' }],
  });

  it('a run killed after N writes, re-run, equals a clean run; undo restores the pre-apply state', async () => {
    const clean = makeFakeDb(seed());
    await applyPlan(clean.client, tree, plan(), opts(clean));
    const total = clean.writes();
    const finalState = clean.snapshot();
    const pre = makeFakeDb(seed()).snapshot();

    for (let n = 0; n < total; n++) {
      const db = makeFakeDb(seed());
      db.killAfter(n);
      await applyPlan(db.client, tree, plan(), opts(db));
      db.killAfter(null);
      const second = await applyPlan(db.client, tree, plan(), opts(db));
      expect(second.errors, `kill after ${n}`).toEqual([]);
      expect(db.snapshot(), `kill after ${n}`).toBe(finalState);
      // no duplicate aliases or change rows for the same action
      const keys = db.tables.category_changes.map((c) => `${c.action}:${JSON.stringify(c.payload)}`);
      expect(new Set(keys).size, `kill after ${n}`).toBe(keys.length);
      await undoRun(db.client, 'run1');
      expect(db.snapshot(), `kill after ${n}`).toBe(pre);
    }
  });
});

describe('applyPlan: rehome duties', () => {
  it('(b) a target absorbed earlier in the plan resolves through its alias', async () => {
    const db = makeFakeDb(seed());
    const plan: TaxPlan = { ...mergePlan(), rehomes: [{ questionId: 'q3', from: 'other-hist', to: 'bridges-old' }] };
    const s = await applyPlan(db.client, tree, plan, opts(db));
    expect(s.errors).toEqual([]);
    expect(linksOf(db, 'q3')).toContain('bridges');
    expect(linksOf(db, 'q3')).not.toContain('bridges-old');
  });

  it('(b) a target hidden as trimmed is an error and nothing is linked', async () => {
    const db = makeFakeDb(seed());
    const plan: TaxPlan = { ...emptyPlan(), hides: [{ slug: 'misc', why: '' }], rehomes: [{ questionId: 'q3', from: 'other-hist', to: 'misc' }] };
    const s = await applyPlan(db.client, tree, plan, opts(db));
    expect(s.errors).toHaveLength(1);
    expect(linksOf(db, 'q3')).toContain('other-hist');
    expect(linksOf(db, 'q3')).not.toContain('misc');
  });

  it('(c) a question not linked to `from` is an error and is skipped', async () => {
    const db = makeFakeDb(seed());
    const plan: TaxPlan = { ...emptyPlan(), rehomes: [{ questionId: 'q2', from: 'other-hist', to: 'geography' }] };
    const w = db.writes();
    const s = await applyPlan(db.client, tree, plan, opts(db));
    expect(s.errors[0]).toMatch(/not linked to other-hist/);
    expect(db.writes()).toBe(w);
  });

  it('rehome keeps `from` when it is still an ancestor of another leaf', async () => {
    const s0 = seed();
    s0.categories.push(cat('deep-hist', 'other-hist', 2));
    s0.question_categories.push(link('q3', 'deep-hist', 40));
    const db = makeFakeDb(s0);
    // move q3 off `misc`-style leaf: other-hist is an ancestor of deep-hist, which stays
    const plan: TaxPlan = { ...emptyPlan(), rehomes: [{ questionId: 'q3', from: 'other-hist', to: 'geography' }] };
    await applyPlan(db.client, tree, plan, opts(db));
    expect(linksOf(db, 'q3')).toContain('other-hist');
    expect(linksOf(db, 'q3')).toContain('geography');
  });

  it('create refuses a parent at max depth', async () => {
    const s0 = seed();
    s0.categories.push(cat('d1', 'history', 1), cat('d2', 'd1', 2), cat('d3', 'd2', 3), cat('d4', 'd3', 4), cat('d5', 'd4', 5));
    const db = makeFakeDb(s0);
    const s = await applyPlan(db.client, tree, { ...emptyPlan(), creates: [{ slug: 'too-deep', name: 'T', parent: 'd5', why: '' }] }, opts(db));
    expect(s.errors[0]).toMatch(/max depth/);
    expect(db.tables.categories.some((c) => c.slug === 'too-deep')).toBe(false);
  });
});

describe('manual controls', () => {
  it('setHidden / setProtected write change rows and undo restores', async () => {
    const db = makeFakeDb(seed());
    const before = db.snapshot();
    await setHidden(db.client, 'misc', 'veto', 'man1');
    await setProtected(db.client, 'history', true, 'man1');
    expect(db.tables.categories.find((c) => c.slug === 'misc')).toMatchObject({ hidden_reason: 'veto' });
    expect(db.tables.categories.find((c) => c.slug === 'history')!.protected).toBe(true);
    await setHidden(db.client, 'misc', null, 'man1');
    expect(db.tables.categories.find((c) => c.slug === 'misc')!.hidden_at).toBeNull();
    await undoRun(db.client, 'man1');
    expect(db.snapshot()).toBe(before);
  });

  it('protected categories are not merged or hidden at apply time', async () => {
    const s0 = seed();
    (s0.categories.find((c) => c.slug === 'history')!).protected = true;
    const db = makeFakeDb(s0);
    const s = await applyPlan(db.client, tree, { ...mergePlan(), hides: [{ slug: 'misc', why: '' }] }, opts(db));
    expect(s.errors).toHaveLength(2);
    expect(calls).toBeGreaterThan(0);
  });
});

describe('fix round 1', () => {
  const deepSeed = (): Record<string, Row[]> => {
    const s0 = seed();
    s0.categories.push(
      cat('a', 'history', 1), cat('b', 'a', 2), cat('deep', 'b', 3), cat('x-old', 'history', 1),
      cat('kid', 'x-old', 2), cat('g1', 'kid', 3),
    );
    s0.question_categories.push(link('q2', 'g1', 30), link('q2', 'kid', 30), link('q2', 'x-old', 30));
    return s0;
  };
  const deepPlan = (): TaxPlan => ({ ...emptyPlan(), merges: [{ survivor: 'deep', absorbed: ['x-old'], why: '' }] });

  it('crash during re-parenting: re-run ends with the same depths as a clean run, and undo is exact', async () => {
    const clean = makeFakeDb(deepSeed());
    await applyPlan(clean.client, tree, deepPlan(), opts(clean));
    const total = clean.writes();
    const finalState = clean.snapshot();
    const pre = makeFakeDb(deepSeed()).snapshot();
    expect(clean.tables.categories.find((c) => c.slug === 'g1')!.depth).toBe(5);
    for (let n = 0; n < total; n++) {
      const db = makeFakeDb(deepSeed());
      db.killAfter(n);
      await applyPlan(db.client, tree, deepPlan(), opts(db));
      db.killAfter(null);
      const second = await applyPlan(db.client, tree, deepPlan(), opts(db));
      expect(second.errors, `kill after ${n}`).toEqual([]);
      expect(db.snapshot(), `kill after ${n}`).toBe(finalState);
      await undoRun(db.client, 'run1');
      expect(db.snapshot(), `kill after ${n}`).toBe(pre);
    }
  });

  const capSeed = (): Record<string, Row[]> => {
    const s0 = seed();
    for (const x of ['x1', 'x2', 'x3', 'x4', 'x5', 'x6']) s0.categories.push(cat(x, null, 0));
    s0.questions.push(question('q8'), question('q9'));
    // q8: 8 rows, survivor link absent: must move in place
    s0.question_categories.push(
      link('q8', 'bridges-old', 60), link('q8', 'history', 50), link('q8', 'general-knowledge', 40),
      ...['x1', 'x2', 'x3', 'x4', 'x5'].map((x) => link('q8', x, 20)),
    );
    // q9: 8 rows and no room for the missing ancestor (geography) afterwards
    s0.question_categories.push(
      link('q9', 'bridges-old', 60), link('q9', 'general-knowledge', 40),
      ...['x1', 'x2', 'x3', 'x4', 'x5', 'x6'].map((x) => link('q9', x, 20)),
    );
    return s0;
  };

  it('a question already at 8 rows moves in place; the old insert-first path would have tripped the cap', async () => {
    const db = makeFakeDb(capSeed());
    const probe = await db.client.from('question_categories').insert({ question_id: 'q8', category_id: 'id-bridges', estimate_score: 1, observed_n: 0 } as never);
    expect((probe as { error: unknown }).error).toBeTruthy(); // fake enforces the cap on insert
    const s = await applyPlan(db.client, tree, mergePlan(), opts(db));
    expect(s.errors.filter((e) => e.includes('q8'))).toEqual([]);
    expect(linksOf(db, 'q8')).toContain('bridges');
    expect(linksOf(db, 'q8')).not.toContain('bridges-old');
    expect(linksOf(db, 'q8').length).toBeLessThanOrEqual(8);
  });

  it('a calibrator chain insert that exceeds 8 is recorded for that question and the merge still completes', async () => {
    const db = makeFakeDb(capSeed());
    const pre = db.snapshot();
    const s = await applyPlan(db.client, tree, mergePlan(), opts(db));
    expect(s.errors.some((e) => e.startsWith('calibrate q9'))).toBe(true);
    expect(s.merged).toBe(1);
    expect(linksOf(db, 'q9')).toContain('bridges');
    expect(db.tables.categories.find((c) => c.slug === 'bridges-old')!.hidden_reason).toBe('merged');
    await undoRun(db.client, 'run1');
    expect(db.snapshot()).toBe(pre);
  });

  it('undo of an in-place moved link restores the original row', async () => {
    const db = makeFakeDb(capSeed());
    const pre = db.snapshot();
    await applyPlan(db.client, tree, mergePlan(), opts(db));
    await undoRun(db.client, 'run1');
    expect(db.snapshot()).toBe(pre);
    expect(rowOf(db, 'q8', 'bridges-old')).toBeTruthy();
  });

  it('a link added to the absorbed node mid-apply is moved too, and undo stays exact', async () => {
    const s0 = seed();
    s0.questions.push(question('q5'));
    const db = makeFakeDb(s0);
    const pre = db.snapshot();
    let injected = false;
    db.onWrite((table, op) => {
      if (!injected && table === 'question_categories' && (op === 'update' || op === 'delete')) {
        injected = true;
        db.tables.question_categories.push(link('q5', 'bridges-old', 44) as never, link('q5', 'history', 33) as never);
      }
    });
    const s = await applyPlan(db.client, tree, mergePlan(), opts(db));
    db.onWrite(null);
    expect(s.errors).toEqual([]);
    expect(rowOf(db, 'q5', 'bridges-old')).toBeUndefined();
    expect(linksOf(db, 'q5')).toContain('bridges');
    expect(s.merged).toBe(1);
    // undo restores everything except the injected rows, which belonged to the "outside world" (q5 snapshot
    // taken after injection restores its post-injection state)
    await undoRun(db.client, 'run1');
    expect(rowOf(db, 'q5', 'bridges-old')).toBeTruthy();
    expect(db.snapshot().replace(/\{[^{}]*"question_id":"q5"[^{}]*\},?/g, '')).toBe(
      pre.replace(/\{[^{}]*"question_id":"q5"[^{}]*\},?/g, ''),
    );
  });

  it('links that keep appearing on the absorbed node: error, not hidden, not counted as merged', async () => {
    const s0 = seed();
    const db = makeFakeDb(s0);
    let i = 0;
    db.onWrite((table) => {
      if (table !== 'question_categories') return;
      db.tables.questions.push(question(`z${i}`) as never);
      db.tables.question_categories.push(link(`z${i++}`, 'bridges-old', 10) as never);
    });
    const s = await applyPlan(db.client, tree, mergePlan(), opts(db));
    db.onWrite(null);
    expect(s.merged).toBe(0);
    expect(s.errors.some((e) => e.includes('still on absorbed'))).toBe(true);
    expect(db.tables.categories.find((c) => c.slug === 'bridges-old')!.hidden_at).toBeNull();
  });
});

describe('fix round 2: usage stop', () => {
  it('a UsageStopError mid-merge rejects, leaves the node un-hidden and un-aliased; re-run completes; undo exact', async () => {
    // q2 and q1 both need new ancestors (geography via calibrator): q2 lacks it, so does q3? use q2 + a second one.
    const s0 = seed();
    s0.questions.push(question('q6'));
    s0.question_categories.push(link('q6', 'bridges-old', 50), link('q6', 'history', 40));
    const clean = makeFakeDb(s0);
    await applyPlan(clean.client, tree, mergePlan(), opts(clean));
    const finalState = clean.snapshot();

    const db = makeFakeDb(s0);
    const pre = db.snapshot();
    let n = 0;
    const stopping: ClaudeCaller = async (o) => {
      if (++n === 2) throw new UsageStopError('five-hour window');
      return call(o);
    };
    await expect(
      applyPlan(db.client, tree, mergePlan(), { runId: 'run1', dryRun: false, call: stopping, config }),
    ).rejects.toBeInstanceOf(UsageStopError);
    expect(n).toBe(2);
    const a = db.tables.categories.find((c) => c.slug === 'bridges-old')!;
    expect(a.hidden_at).toBeNull();
    expect(db.tables.category_aliases.some((x) => x.old_slug === 'bridges-old')).toBe(false);

    const s = await applyPlan(db.client, tree, mergePlan(), opts(db));
    expect(s.errors).toEqual([]);
    expect(s.merged).toBe(1);
    expect(db.snapshot()).toBe(finalState);
    await undoRun(db.client, 'run1');
    expect(db.snapshot()).toBe(pre);
  });

  it('the same (question, message) error is recorded once per run', async () => {
    const s0 = seed();
    s0.questions.push(question('q6'));
    s0.question_categories.push(link('q6', 'bridges-old', 50));
    const db = makeFakeDb(s0);
    let i = 0;
    db.onWrite((table) => {
      if (table !== 'question_categories') return;
      db.tables.questions.push(question(`z${i}`) as never);
      db.tables.question_categories.push(link(`z${i++}`, 'bridges-old', 10) as never);
    });
    const s = await applyPlan(db.client, tree, mergePlan(), opts(db));
    db.onWrite(null);
    expect(new Set(s.errors).size).toBe(s.errors.length);
  });
});

describe('round 3: replay safety', () => {
  it('a finished merge whose survivor was hidden later is complete, not an error', async () => {
    const db = makeFakeDb(seed());
    await applyPlan(db.client, tree, mergePlan(), opts(db));
    await setHidden(db.client, 'bridges', 'veto', 'manual1');
    const again = await applyPlan(db.client, tree, mergePlan(), opts(db));
    expect(again.errors).toEqual([]);
    expect(again.merged).toBe(0);
  });

  it('three attempts: rehome (stopped), a later merge of another leaf, then a replay never links the merged-away category', async () => {
    const mk = (): Record<string, Row[]> => ({
      categories: [
        cat('general-knowledge', null, 0), cat('sci', null, 0),
        cat('physics', 'sci', 1), cat('optics', 'sci', 1), cat('chem', 'sci', 1), cat('chemistry', 'sci', 1),
      ],
      questions: [question('q')],
      question_categories: [link('q', 'physics', 50), link('q', 'chem', 50), link('q', 'sci', 50), link('q', 'general-knowledge', 50)],
    });
    const db = makeFakeDb(mk());
    const rehome: TaxPlan = { ...emptyPlan(), rehomes: [{ questionId: 'q', from: 'physics', to: 'optics' }] };
    const merge: TaxPlan = { ...emptyPlan(), merges: [{ survivor: 'chemistry', absorbed: ['chem'], why: 't' }] };
    // attempt 1: only the change-log row lands (snapshot taken with leaves physics + chem), then the process dies
    db.killAfter(1);
    await applyPlan(db.client, tree, rehome, opts(db, 'wk'));
    db.killAfter(null);
    expect(db.tables.category_changes.filter((c) => c.action === 'rehome')).toHaveLength(1);
    expect(linksOf(db, 'q')).toContain('physics');
    // attempt 2 (same run id): a later action merges chem into chemistry
    await applyPlan(db.client, tree, merge, opts(db, 'wk'));
    expect(linksOf(db, 'q')).toContain('chemistry');
    // attempt 3: replay the logged rehome with its STALE snapshot
    const s = await applyPlan(db.client, tree, rehome, opts(db, 'wk'));
    expect(s.errors).toEqual([]);
    const links = linksOf(db, 'q');
    expect(links).not.toContain('chem'); // hidden as merged
    expect(links).toContain('chemistry');
    expect(links).toContain('optics');
    expect(links).not.toContain('physics');
    expect(db.tables.categories.find((c) => c.slug === 'chem')?.hidden_reason).toBe('merged');
  });

  it('replaying an old rehome after a later run moved the question elsewhere does not re-link the old target', async () => {
    const db = makeFakeDb({
      categories: [
        cat('general-knowledge', null, 0), cat('sci', null, 0),
        cat('physics', 'sci', 1), cat('optics', 'sci', 1), cat('astro', 'sci', 1),
      ],
      questions: [question('q')],
      question_categories: [link('q', 'physics', 50), link('q', 'sci', 50), link('q', 'general-knowledge', 50)],
    });
    const r1: TaxPlan = { ...emptyPlan(), rehomes: [{ questionId: 'q', from: 'physics', to: 'optics' }] };
    const r2: TaxPlan = { ...emptyPlan(), rehomes: [{ questionId: 'q', from: 'optics', to: 'astro' }] };
    expect((await applyPlan(db.client, tree, r1, opts(db, 'R1'))).errors).toEqual([]);
    expect(linksOf(db, 'q')).toContain('optics');
    expect((await applyPlan(db.client, tree, r2, opts(db, 'R2'))).errors).toEqual([]);
    expect(linksOf(db, 'q')).toEqual(['astro', 'general-knowledge', 'sci']);
    const changesBefore = db.tables.category_changes.length;
    const callsBefore = calls;
    const s = await applyPlan(db.client, tree, r1, opts(db, 'R1')); // resume of R1 replays its logged rehome
    expect(s.errors).toEqual([]);
    expect(s.rehomed).toBe(0);
    expect(linksOf(db, 'q')).toEqual(['astro', 'general-knowledge', 'sci']); // optics NOT regained
    expect(calls).toBe(callsBefore); // calibrator not called
    expect(db.tables.category_changes.length).toBe(changesBefore);
  });

  it('a replay follows a chained merge (chem -> chemistry -> chem2) to the final survivor and keeps its ancestor', async () => {
    const db = makeFakeDb({
      categories: [
        cat('general-knowledge', null, 0), cat('sci', null, 0), cat('art', null, 0),
        cat('physics', 'sci', 1), cat('optics', 'sci', 1),
        cat('chem', 'art', 1), cat('chemistry', 'art', 1), cat('chem2', 'art', 1),
      ],
      questions: [question('q')],
      question_categories: [
        link('q', 'physics', 50), link('q', 'sci', 50), link('q', 'chem', 50), link('q', 'art', 50), link('q', 'general-knowledge', 50),
      ],
    });
    const rehome: TaxPlan = { ...emptyPlan(), rehomes: [{ questionId: 'q', from: 'physics', to: 'optics' }] };
    // attempt 1: only the change-log row lands (snapshot leaves physics + chem), then the process dies
    db.killAfter(1);
    await applyPlan(db.client, tree, rehome, opts(db, 'wk'));
    db.killAfter(null);
    expect(linksOf(db, 'q')).toContain('physics');
    // two chained merges by later runs
    const m1: TaxPlan = { ...emptyPlan(), merges: [{ survivor: 'chemistry', absorbed: ['chem'], why: 't' }] };
    const m2: TaxPlan = { ...emptyPlan(), merges: [{ survivor: 'chem2', absorbed: ['chemistry'], why: 't' }] };
    expect((await applyPlan(db.client, tree, m1, opts(db, 'm1'))).errors).toEqual([]);
    expect((await applyPlan(db.client, tree, m2, opts(db, 'm2'))).errors).toEqual([]);
    // leave the chain un-flattened (chem -> chemistry -> chem2), as an alias written before re-pointing would be
    const chemAlias = db.tables.category_aliases.find((a) => a.old_slug === 'chem');
    expect(chemAlias).toBeDefined();
    chemAlias!.category_id = 'id-chemistry';
    expect(linksOf(db, 'q')).toEqual(['art', 'chem2', 'general-knowledge', 'physics', 'sci']);
    // attempt 3: replay the logged rehome with its stale snapshot
    const s = await applyPlan(db.client, tree, rehome, opts(db, 'wk'));
    expect(s.errors).toEqual([]);
    const links = linksOf(db, 'q');
    expect(links).toEqual(['art', 'chem2', 'general-knowledge', 'optics', 'sci']); // art kept for chem2
    expect(links).not.toContain('chem');
    expect(links).not.toContain('chemistry');
  });
});
