import { describe, it, expect } from 'vitest';
import { applyPlan, undoRun } from '../apply.js';
import { makeFakeDb, type FakeDb } from './fake-db.js';
import type { TaxPlan, TaxTree } from '../types.js';
import type { ClaudeCaller } from '../../claude.js';
import type { PipelineConfig } from '../../config.js';

type Row = Record<string, unknown>;
const cat = (slug: string, parent: string | null, depth: number, extra: Row = {}): Row => ({
  id: `id-${slug}`, slug, name: slug, parent_id: parent ? `id-${parent}` : null, depth,
  hidden_at: null, hidden_reason: null, protected: false, created_by: 'seed', ...extra,
});
const link = (q: string, c: string, est = 50): Row => ({
  question_id: q, category_id: `id-${c}`, estimate_score: est, observed_score: null, observed_n: 0,
});
const question = (id: string): Row => ({
  id, question_text: `t ${id}`, correct_answer: 'a', distractors: ['b', 'c', 'd'], status: 'published', parked_reason: null,
});
const plan = (slug: string): TaxPlan => ({ merges: [], hides: [], creates: [], rehomes: [], duplicates: [], drops: [{ slug, why: 't' }] });
const tree = {} as TaxTree;
const config = { claudeModelVerification: 'sonnet' } as PipelineConfig;
const call: ClaudeCaller = async () => ({ text: '{}' }) as never;
const opts = (runId = 'run1') => ({ runId, dryRun: false, call, config });

function seed(extra: Row[] = []): Record<string, Row[]> {
  return {
    categories: [
      cat('general-knowledge', null, 0), cat('food', null, 0), cat('geography', null, 0), cat('history', null, 0),
      cat('cheese', 'food', 1), cat('french-cheese', 'cheese', 2), ...extra,
    ],
    questions: ['q1', 'q2', 'q3'].map(question),
    question_categories: [
      link('q1', 'french-cheese'),
      link('q2', 'cheese'), link('q2', 'geography'),
      link('q3', 'cheese'), link('q3', 'general-knowledge'),
    ],
  };
}
const q = (db: FakeDb, id: string) => db.tables.questions.find((r) => r.id === id)!;
const links = (db: FakeDb, id: string) => db.tables.question_categories.filter((l) => l.question_id === id).map((l) => l.category_id).sort();

describe('drop', () => {
  it('drop hides the subtree and parks questions with no other home', async () => {
    const db = makeFakeDb(seed());
    const s = await applyPlan(db.client, tree, plan('cheese'), opts());
    expect(s.errors).toEqual([]);
    expect(s.dropped).toBe(1);
    for (const slug of ['cheese', 'french-cheese']) {
      expect(db.tables.categories.find((c) => c.slug === slug)!.hidden_reason).toBe('dropped');
    }
    expect(q(db, 'q1').status).toBe('parked');
    expect(q(db, 'q1').parked_reason).toBe('owner: dropped cheese');
    expect(links(db, 'q1')).toEqual(['id-french-cheese']);
  });

  it('a question also in another branch keeps that home', async () => {
    const db = makeFakeDb(seed());
    await applyPlan(db.client, tree, plan('cheese'), opts());
    expect(q(db, 'q2').status).toBe('published');
    expect(links(db, 'q2')).toEqual(['id-geography']);
  });

  it('General Knowledge is not a home', async () => {
    const db = makeFakeDb(seed());
    await applyPlan(db.client, tree, plan('cheese'), opts());
    expect(q(db, 'q3').status).toBe('parked');
  });

  it('refuses root, GK and protected', async () => {
    for (const [slug, extra] of [['food', []], ['general-knowledge', []], ['cheese', [{ protect: true }]]] as const) {
      const rows = seed();
      if (extra.length) rows.categories.find((c) => c.slug === 'french-cheese')!.protected = true;
      const db = makeFakeDb(rows);
      const before = db.snapshot();
      const s = await applyPlan(db.client, tree, plan(slug), opts());
      expect(s.errors).toHaveLength(1);
      expect(s.dropped).toBe(0);
      expect(db.snapshot()).toBe(before);
    }
  });

  it('undo restores categories, links and status', async () => {
    const s0 = seed();
    const db = makeFakeDb(s0);
    const pick = () => JSON.stringify([db.tables.categories, db.tables.question_categories, db.tables.questions]);
    const before = pick();
    await applyPlan(db.client, tree, plan('cheese'), opts());
    expect(pick()).not.toBe(before);
    const r = await undoRun(db.client, 'run1');
    expect(r.blocked).toBe(0);
    const norm = (t: Row[]) => JSON.stringify([...t].map((x) => Object.entries(x).sort()).sort());
    const orig = makeFakeDb(s0);
    expect(norm(db.tables.categories)).toBe(norm(orig.tables.categories));
    expect(norm(db.tables.question_categories)).toBe(norm(orig.tables.question_categories));
    expect(norm(db.tables.questions)).toBe(norm(orig.tables.questions));
  });

  it('undo after a later re-home keeps the newer link', async () => {
    const db = makeFakeDb(seed());
    await applyPlan(db.client, tree, plan('cheese'), opts());
    db.tables.question_categories.push(link('q2', 'history'));
    await undoRun(db.client, 'run1');
    expect(links(db, 'q2')).toEqual(['id-cheese', 'id-geography', 'id-history']);
  });

  it('drop twice in one run is idempotent', async () => {
    const db = makeFakeDb(seed());
    await applyPlan(db.client, tree, plan('cheese'), opts());
    const s = await applyPlan(db.client, tree, plan('cheese'), opts());
    expect(s.skippedAlreadyDone).toBe(1);
    expect(s.dropped).toBe(0);
    expect(db.tables.category_changes.filter((c) => c.action === 'drop')).toHaveLength(1);
  });

  it('a partly applied drop is finished on retry', async () => {
    const clean = makeFakeDb(seed());
    await applyPlan(clean.client, tree, plan('cheese'), opts());
    const pick = (d: FakeDb) =>
      JSON.stringify([d.tables.categories.map((c) => ({ ...c, hidden_at: c.hidden_at ? 'T' : null })), d.tables.question_categories, d.tables.questions]);
    const db = makeFakeDb(seed());
    db.killAfter(3);
    const s1 = await applyPlan(db.client, tree, plan('cheese'), opts());
    expect(s1.errors.length).toBe(1);
    db.killAfter(null);
    const s2 = await applyPlan(db.client, tree, plan('cheese'), opts());
    expect(s2.errors).toEqual([]);
    expect(s2.dropped).toBe(1);
    expect(pick(db)).toBe(pick(clean));
    expect(db.tables.category_changes.filter((c) => c.action === 'drop')).toHaveLength(1);
  });

  it('undo does not republish a question parked separately after the drop', async () => {
    const db = makeFakeDb(seed());
    await applyPlan(db.client, tree, plan('cheese'), opts());
    Object.assign(q(db, 'q2'), { status: 'parked', parked_reason: 'owner: hidden' });
    await undoRun(db.client, 'run1');
    expect(q(db, 'q2').status).toBe('parked');
    expect(q(db, 'q2').parked_reason).toBe('owner: hidden');
    expect(q(db, 'q1').status).toBe('published');
  });

  it('a hidden category is not a home', async () => {
    const rows = seed([cat('trimmed-cat', 'history', 1, { hidden_at: '2026-01-01T00:00:00Z', hidden_reason: 'trimmed' })]);
    rows.question_categories.push(link('q1', 'trimmed-cat'));
    const db = makeFakeDb(rows);
    await applyPlan(db.client, tree, plan('cheese'), opts());
    expect(q(db, 'q1').status).toBe('parked');
  });

  it('undo restores only deleted links, leaving untouched ones alone', async () => {
    const db = makeFakeDb(seed());
    await applyPlan(db.client, tree, plan('cheese'), opts());
    Object.assign(db.tables.question_categories.find((l) => l.question_id === 'q2' && l.category_id === 'id-geography')!, { observed_n: 9 });
    await undoRun(db.client, 'run1');
    expect(db.tables.question_categories.find((l) => l.question_id === 'q2' && l.category_id === 'id-geography')!.observed_n).toBe(9);
    expect(links(db, 'q2')).toEqual(['id-cheese', 'id-geography']);
  });
});
