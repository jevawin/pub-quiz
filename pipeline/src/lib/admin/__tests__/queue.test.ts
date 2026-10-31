import { describe, it, expect } from 'vitest';
import { processQueue } from '../queue.js';
import { applyPlan } from '../../taxonomy/apply.js';
import { makeFakeDb, type FakeDb } from '../../taxonomy/__tests__/fake-db.js';
import type { TaxTree } from '../../taxonomy/types.js';

type Row = Record<string, unknown>;
const cat = (slug: string, parent: string | null, depth: number, extra: Row = {}): Row => ({
  id: `id-${slug}`, slug, name: slug, parent_id: parent ? `id-${parent}` : null, depth,
  hidden_at: null, hidden_reason: null, protected: false, created_by: 'seed', ...extra,
});
const link = (q: string, c: string): Row => ({ question_id: q, category_id: `id-${c}`, estimate_score: 50, observed_score: null, observed_n: 0 });
const question = (id: string): Row => ({ id, question_text: `t ${id}`, correct_answer: 'a', distractors: ['b', 'c', 'd'], status: 'published', parked_reason: null });
const req = (id: number, action: string, payload: unknown, status = 'queued'): Row => ({
  id, action, payload, status, result: null, run_id: null, created_at: `2026-10-31T00:00:0${id}Z`, done_at: null,
});
function seed(reqs: Row[]): Record<string, Row[]> {
  return {
    categories: [
      cat('general-knowledge', null, 0), cat('food', null, 0), cat('geography', null, 0),
      cat('cheese', 'food', 1), cat('french-cheese', 'cheese', 2), cat('brie', 'french-cheese', 3),
    ],
    questions: ['q1', 'q2', 'q3'].map(question),
    question_categories: [link('q1', 'french-cheese'), link('q2', 'cheese'), link('q3', 'brie')],
    admin_requests: reqs,
  };
}
const opts = { now: () => new Date('2026-10-31T08:00:00Z'), maxRequests: 10 };
const reqRow = (db: FakeDb, id: number) => db.tables.admin_requests.find((r) => r.id === id)!;
const homes = (db: FakeDb, qid: string) => db.tables.question_categories.filter((l) => l.question_id === qid).map((l) => l.category_id);

describe('processQueue', () => {
  it('merges a selected child before its selected parent', async () => {
    const db = makeFakeDb(seed([req(1, 'merge', { slugs: ['french-cheese', 'brie'] })]));
    const r = await processQueue(db.client, opts);
    expect(r).toEqual({ done: 1, failed: 0 });
    expect(reqRow(db, 1).status).toBe('done');
    expect(reqRow(db, 1).run_id).toBe('admin-1');
    expect(reqRow(db, 1).done_at).toBe('2026-10-31T08:00:00.000Z');
    // brie -> french-cheese first, then french-cheese -> cheese: q3 ends in cheese
    expect(homes(db, 'q3')).toContain('id-cheese');
    expect(homes(db, 'q3')).not.toContain('id-brie');
    expect(homes(db, 'q1')).toContain('id-cheese');
    for (const slug of ['brie', 'french-cheese']) expect(db.tables.categories.find((c) => c.slug === slug)!.hidden_reason).toBe('merged');
    expect(db.tables.categories.find((c) => c.slug === 'cheese')!.hidden_reason).toBeNull();
  });

  it('a failed request does not stop the next', async () => {
    const db = makeFakeDb(seed([req(1, 'bogus', {}), req(2, 'drop', { slugs: ['cheese'] })]));
    const r = await processQueue(db.client, opts);
    expect(r).toEqual({ done: 1, failed: 1 });
    expect(reqRow(db, 1).status).toBe('failed');
    expect(reqRow(db, 2).status).toBe('done');
    expect(db.tables.categories.find((c) => c.slug === 'cheese')!.hidden_reason).toBe('dropped');
  });

  it('request claimed by another tick is skipped', async () => {
    const db = makeFakeDb(seed([req(1, 'drop', { slugs: ['cheese'] })]));
    // another tick wins the claim: flips the row to running right after our orphan reset
    let first = true;
    db.onWrite((t) => {
      if (t === 'admin_requests' && first) {
        first = false;
        reqRow(db, 1).status = 'running';
      }
    });
    const r = await processQueue(db.client, opts);
    expect(r).toEqual({ done: 0, failed: 0 });
    expect(reqRow(db, 1).status).toBe('running');
    expect(db.tables.categories.find((c) => c.slug === 'cheese')!.hidden_reason).toBeNull();
  });

  it('a running row left by a killed tick is retried', async () => {
    const db = makeFakeDb(seed([req(1, 'drop', { slugs: ['cheese'] }, 'running')]));
    const r = await processQueue(db.client, opts);
    expect(r).toEqual({ done: 1, failed: 0 });
    expect(reqRow(db, 1).status).toBe('done');
    expect(db.tables.categories.find((c) => c.slug === 'cheese')!.hidden_reason).toBe('dropped');
  });

  it('merges stay queued while deferMerges', async () => {
    const db = makeFakeDb(seed([req(1, 'merge', { slugs: ['brie'] })]));
    const r = await processQueue(db.client, { ...opts, deferMerges: true });
    expect(r).toEqual({ done: 0, failed: 0 });
    expect(reqRow(db, 1).status).toBe('queued');
  });

  it('drops still run while deferMerges', async () => {
    const db = makeFakeDb(seed([req(1, 'merge', { slugs: ['brie'] }), req(2, 'drop', { slugs: ['cheese'] })]));
    const r = await processQueue(db.client, { ...opts, deferMerges: true });
    expect(r).toEqual({ done: 1, failed: 0 });
    expect(reqRow(db, 1).status).toBe('queued');
    expect(reqRow(db, 2).status).toBe('done');
  });

  it('admin merge of a depth-1 category into its root succeeds', async () => {
    const db = makeFakeDb(seed([req(1, 'merge', { slugs: ['cheese'] })]));
    const r = await processQueue(db.client, opts);
    expect(r).toEqual({ done: 1, failed: 0 });
    expect(db.tables.categories.find((c) => c.slug === 'cheese')!.hidden_reason).toBe('merged');
    expect(homes(db, 'q2')).toContain('id-food');
  });

  it('sweep requests are left queued', async () => {
    const db = makeFakeDb(seed([req(1, 'sweep', {})]));
    const r = await processQueue(db.client, opts);
    expect(r).toEqual({ done: 0, failed: 0 });
    expect(reqRow(db, 1).status).toBe('queued');
  });

  it('undo request undoes the named run', async () => {
    const db = makeFakeDb(seed([]));
    const plan = { merges: [], hides: [], creates: [], rehomes: [], duplicates: [], drops: [{ slug: 'cheese', why: 't' }] };
    await applyPlan(db.client, {} as TaxTree, plan, { runId: 'r9', dryRun: false, call: (async () => { throw new Error('no'); }) as never, config: {} as never });
    expect(db.tables.categories.find((c) => c.slug === 'cheese')!.hidden_reason).toBe('dropped');
    db.tables.admin_requests.push(req(1, 'undo', { runId: 'r9' }));
    const r = await processQueue(db.client, opts);
    expect(r.done).toBe(1);
    expect(db.tables.categories.find((c) => c.slug === 'cheese')!.hidden_reason).toBeNull();
  });

  it('GK and root slugs are refused per slug, others applied', async () => {
    const db = makeFakeDb(seed([req(1, 'merge', { slugs: ['general-knowledge', 'food', 'french-cheese'] })]));
    const r = await processQueue(db.client, opts);
    expect(r).toEqual({ done: 1, failed: 0 });
    const row = reqRow(db, 1);
    expect(row.result).toMatch(/general-knowledge/);
    expect(row.result).toMatch(/food/);
    expect(db.tables.categories.find((c) => c.slug === 'french-cheese')!.hidden_reason).toBe('merged');
    expect(db.tables.categories.find((c) => c.slug === 'food')!.hidden_reason).toBeNull();
  });

  it('unhide clears the hide and the veto flag', async () => {
    const rows = seed([req(1, 'unhide', { slugs: ['cheese'] })]);
    rows.categories.find((c) => c.slug === 'cheese')!.hidden_reason = 'veto';
    rows.categories.find((c) => c.slug === 'cheese')!.hidden_at = '2026-10-01T00:00:00Z';
    rows.category_flags = [{ norm: 'cheese', name: 'cheese', category_id: 'id-cheese', note: 'veto hide x', created_at: '2026-10-01T00:00:00Z' }];
    const db = makeFakeDb(rows);
    const r = await processQueue(db.client, opts);
    expect(r.done).toBe(1);
    expect(db.tables.categories.find((c) => c.slug === 'cheese')!.hidden_reason).toBeNull();
    expect(db.tables.category_flags).toHaveLength(0);
  });

  it('unhide refuses a dropped or merged category and points at Undo (finding 1)', async () => {
    const rows = seed([req(1, 'unhide', { slugs: ['cheese'] }), req(2, 'unhide', { slugs: ['brie'] }), req(3, 'unhide', { slugs: ['cheese', 'geography'] })]);
    Object.assign(rows.categories.find((c) => c.slug === 'cheese')!, { hidden_reason: 'dropped', hidden_at: '2026-10-01T00:00:00Z' });
    Object.assign(rows.categories.find((c) => c.slug === 'brie')!, { hidden_reason: 'merged', hidden_at: '2026-10-01T00:00:00Z' });
    Object.assign(rows.categories.find((c) => c.slug === 'geography')!, { hidden_reason: 'trimmed', hidden_at: '2026-10-01T00:00:00Z' });
    const db = makeFakeDb(rows);
    const r = await processQueue(db.client, opts);
    expect(r).toEqual({ done: 1, failed: 2 });
    expect(reqRow(db, 1).result).toMatch(/cheese: use Undo on the drop run/);
    expect(reqRow(db, 2).result).toMatch(/brie: use Undo on the merge run/);
    expect(db.tables.categories.find((c) => c.slug === 'cheese')!.hidden_reason).toBe('dropped');
    expect(db.tables.categories.find((c) => c.slug === 'brie')!.hidden_reason).toBe('merged');
    // a mixed request still unhides the allowed slug and reports the refused one
    expect(reqRow(db, 3).result).toMatch(/unhid 1/);
    expect(reqRow(db, 3).result).toMatch(/cheese: use Undo on the drop run/);
    expect(db.tables.categories.find((c) => c.slug === 'geography')!.hidden_reason).toBeNull();
  });

  it('respects maxRequests', async () => {
    const db = makeFakeDb(seed([req(1, 'drop', { slugs: ['cheese'] }), req(2, 'drop', { slugs: ['geography'] })]));
    const r = await processQueue(db.client, { ...opts, maxRequests: 1 });
    expect(r.done).toBe(1);
    expect(reqRow(db, 2).status).toBe('queued');
  });
});

describe('applyPlan root survivor', () => {
  const mk = (survivor: string, absorbed: string) => ({ merges: [{ survivor, absorbed: [absorbed], why: 't' }], hides: [], creates: [], rehomes: [], duplicates: [], drops: [] });
  const o = (allow?: boolean) => ({ runId: 'rx', dryRun: false, call: (async () => { throw new Error('no'); }) as never, config: {} as never, allowRootSurvivor: allow });
  it('applyPlan without the flag still refuses a root survivor', async () => {
    const db = makeFakeDb(seed([]));
    const s = await applyPlan(db.client, {} as TaxTree, mk('food', 'cheese'), o());
    expect(s.merged).toBe(0);
    expect(s.errors.join()).toMatch(/root category cannot be merged/);
  });
  it('absorbed root still refused with the flag', async () => {
    const db = makeFakeDb(seed([]));
    const s = await applyPlan(db.client, {} as TaxTree, mk('geography', 'food'), o(true));
    expect(s.merged).toBe(0);
    expect(s.errors.join()).toMatch(/root category cannot be merged/);
  });
});
