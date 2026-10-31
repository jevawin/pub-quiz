import { describe, it, expect } from 'vitest';
import { applyPlan, undoRun } from '../apply.js';
import { makeFakeDb, type FakeDb } from './fake-db.js';
import type { TaxPlan, TaxTree } from '../types.js';
import type { ClaudeCaller } from '../../claude.js';
import type { PipelineConfig } from '../../config.js';
import type { TypedSupabaseClient } from '../../supabase.js';

type Row = Record<string, unknown>;
const cat = (slug: string, parent: string | null, depth: number): Row => ({
  id: `id-${slug}`, slug, name: slug, parent_id: parent ? `id-${parent}` : null, depth,
  hidden_at: null, hidden_reason: null, protected: false, created_by: 'seed',
});
const question = (id: string): Row => ({ id, question_text: `t ${id}`, correct_answer: 'a', distractors: ['b', 'c', 'd'], status: 'published', parked_reason: null });
const link = (q: string, c: string): Row => ({ question_id: q, category_id: `id-${c}`, estimate_score: 50, observed_score: null, observed_n: 0 });

// JS ports of the live SQL functions admin_hide_question / admin_unhide_question (migration 00042).
function hideQuestion(db: FakeDb, qid: string, reason: string, run: string): void {
  const q = db.tables.questions.find((r) => r.id === qid)!;
  if (q.status === 'parked') return;
  const id = Math.max(0, ...db.tables.category_changes.map((c) => c.id as number)) + 1000;
  db.tables.category_changes.push({ id, run_id: run, action: 'hide_question', payload: { questionId: qid, reason }, prior: { id: qid, status: q.status, parked_reason: q.parked_reason }, undone_at: null });
  Object.assign(q, { status: 'parked', parked_reason: `owner: ${reason}` });
}
function unhideQuestion(db: FakeDb, qid: string, run: string): void {
  const q = db.tables.questions.find((r) => r.id === qid)!;
  if (q.status !== 'parked') throw new Error(`question ${qid} is no longer parked`);
  const src = db.tables.category_changes
    .filter((c) => ['hide_question', 'sweep_drop'].includes(c.action as string) && c.undone_at === null && (c.prior as Row).id === qid)
    .sort((a, b) => (b.id as number) - (a.id as number))[0];
  if (!src) throw new Error(`admin_unhide_question: no undoable hide for question ${qid}`);
  const id = Math.max(0, ...db.tables.category_changes.map((c) => c.id as number)) + 1;
  db.tables.category_changes.push({ id, run_id: run, action: 'unhide_question', payload: { questionId: qid }, prior: { id: qid, status: q.status, parked_reason: q.parked_reason }, undone_at: null });
  const p = src.prior as Row;
  Object.assign(q, { status: p.status, parked_reason: p.parked_reason });
  src.undone_at = '2026-10-31T09:00:00Z';
}

const q = (db: FakeDb, id: string) => db.tables.questions.find((r) => r.id === id)!;

describe('undo of unhide_question (finding 3)', () => {
  it('hide -> unhide -> undo(unhide) -> the question can be unhidden again', async () => {
    const db = makeFakeDb({ questions: [question('q1')] });
    hideQuestion(db, 'q1', 'wrong answer', 'admin-1');
    unhideQuestion(db, 'q1', 'admin-2');
    expect(q(db, 'q1').status).toBe('published');
    const r = await undoRun(db.client, 'admin-2');
    expect(r).toEqual({ undone: 1, blocked: 0 });
    expect(q(db, 'q1')).toMatchObject({ status: 'parked', parked_reason: 'owner: wrong answer' });
    const hideRow = db.tables.category_changes.find((c) => c.action === 'hide_question')!;
    expect(hideRow.undone_at).toBeNull();
    // the admin unhide path works again, and so does undoing the original hide
    unhideQuestion(db, 'q1', 'admin-3');
    expect(q(db, 'q1').status).toBe('published');
    await undoRun(db.client, 'admin-3');
    expect(q(db, 'q1').status).toBe('parked');
    const r2 = await undoRun(db.client, 'admin-1');
    expect(r2).toEqual({ undone: 1, blocked: 0 });
    expect(q(db, 'q1')).toMatchObject({ status: 'published', parked_reason: null });
  });

  it('clears only the newest marked hide row older than the unhide', async () => {
    const db = makeFakeDb({ questions: [question('q1')] });
    hideQuestion(db, 'q1', 'one', 'admin-1');
    unhideQuestion(db, 'q1', 'admin-2');
    hideQuestion(db, 'q1', 'two', 'admin-3');
    unhideQuestion(db, 'q1', 'admin-4');
    await undoRun(db.client, 'admin-4');
    const hides = db.tables.category_changes.filter((c) => c.action === 'hide_question');
    expect(hides.find((c) => c.run_id === 'admin-1')!.undone_at).not.toBeNull();
    expect(hides.find((c) => c.run_id === 'admin-3')!.undone_at).toBeNull();
    expect(q(db, 'q1').parked_reason).toBe('owner: two');
  });
});

describe('single-question undo guard (finding 5)', () => {
  it('undoing a hide restores only while the question is still parked by that hide', async () => {
    const db = makeFakeDb({ questions: [question('q1'), question('q2')] });
    hideQuestion(db, 'q1', 'bad', 'admin-1');
    hideQuestion(db, 'q2', 'bad', 'admin-1');
    // q1 was later re-parked for another reason; q2 untouched
    Object.assign(q(db, 'q1'), { status: 'parked', parked_reason: 'owner: dropped cheese' });
    const r = await undoRun(db.client, 'admin-1');
    expect(r).toEqual({ undone: 1, blocked: 1 });
    expect(q(db, 'q1')).toMatchObject({ status: 'parked', parked_reason: 'owner: dropped cheese' });
    expect(q(db, 'q2')).toMatchObject({ status: 'published', parked_reason: null });
  });

  it('a sweep_drop undo is skipped once the question was re-published another way', async () => {
    const db = makeFakeDb({ questions: [question('q1')] });
    db.tables.category_changes.push({ id: 1, run_id: 'sweep-1', action: 'sweep_drop', payload: { questionId: 'q1', ruleId: 4, reason: 'too easy' }, prior: { id: 'q1', status: 'published', parked_reason: null }, undone_at: null });
    Object.assign(q(db, 'q1'), { status: 'parked', parked_reason: 'rule 4: too easy' });
    q(db, 'q1').status = 'verified';
    q(db, 'q1').parked_reason = null;
    expect(await undoRun(db.client, 'sweep-1')).toEqual({ undone: 0, blocked: 1 });
    expect(q(db, 'q1').status).toBe('verified');
    // still parked by the sweep -> restored
    Object.assign(q(db, 'q1'), { status: 'parked', parked_reason: 'rule 4: too easy' });
    expect(await undoRun(db.client, 'sweep-1')).toEqual({ undone: 1, blocked: 0 });
    expect(q(db, 'q1')).toMatchObject({ status: 'published', parked_reason: null });
  });
});

describe('drop with more than 100 questions (finding 6)', () => {
  const N = 150;
  const ids = Array.from({ length: N }, (_, i) => `q${String(i).padStart(3, '0')}`);
  const plan: TaxPlan = { merges: [], hides: [], creates: [], rehomes: [], duplicates: [], drops: [{ slug: 'cheese', why: 't' }] };
  const call: ClaudeCaller = async () => {
    throw new Error('no model');
  };
  const opts = (runId: string) => ({ runId, dryRun: false, call, config: { claudeModelVerification: 'sonnet' } as PipelineConfig });

  function recording(db: FakeDb): { client: TypedSupabaseClient; maxIn: () => number } {
    let max = 0;
    const client = {
      from: (t: string) => {
        const b = db.client.from(t as never) as unknown as Record<string, (...a: unknown[]) => unknown>;
        if (t !== 'questions') return b;
        const wrapped: Record<string, unknown> = new Proxy(b, {
          get(target, prop) {
            const v = target[prop as string];
            if (typeof v !== 'function') return v;
            return (...a: unknown[]) => {
              if (prop === 'in' && a[0] === 'id') max = Math.max(max, (a[1] as unknown[]).length);
              const out = v(...a);
              return out === target ? wrapped : out;
            };
          },
        });
        return wrapped;
      },
    } as unknown as TypedSupabaseClient;
    return { client, maxIn: () => max };
  }

  it('loads question statuses in chunks of at most 100 (apply, retry, undo)', async () => {
    const seed = {
      categories: [cat('general-knowledge', null, 0), cat('food', null, 0), cat('cheese', 'food', 1)],
      questions: ids.map(question),
      question_categories: ids.map((id) => link(id, 'cheese')),
    };
    const db = makeFakeDb(seed);
    const { client, maxIn } = recording(db);
    const s = await applyPlan(client, {} as TaxTree, plan, opts('r1'));
    expect(s.errors).toEqual([]);
    expect(db.tables.questions.filter((r) => r.status === 'parked')).toHaveLength(N);
    // re-run (resume path) is a no-op but must also chunk
    const s2 = await applyPlan(client, {} as TaxTree, plan, opts('r1'));
    expect(s2.errors).toEqual([]);
    await undoRun(client, 'r1');
    expect(db.tables.questions.filter((r) => r.status === 'published')).toHaveLength(N);
    expect(maxIn()).toBeGreaterThan(0);
    expect(maxIn()).toBeLessThanOrEqual(100);
  });
});
