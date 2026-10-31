// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { handle } from '../index';
import { makeEnv, makeKeys, req, sign, stubFetch, type Keys, type Row, type Tables } from './helpers';

let keys: Keys;
let token: string;

beforeAll(async () => {
  keys = await makeKeys();
  token = await sign(keys);
});

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

async function get(path: string, tables: Tables): Promise<{ status: number; body: any; calls: string[] }> {
  const { fetch, calls } = stubFetch(keys, tables);
  const res = await handle(req(path, token), makeEnv(), { fetch });
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.get('content-type')).toMatch(/application\/json/);
  return { status: res.status, body: await res.json(), calls };
}

describe('GET /admin/api/tree', () => {
  it('tree returns counts and flags (paged past the 1000-row cap)', async () => {
    const categories: Row[] = [
      { id: id(1), slug: 'food', name: 'Food', parent_id: null, depth: 0, hidden_at: null, hidden_reason: null, protected: false },
      { id: id(2), slug: 'cheese', name: 'Cheese', parent_id: id(1), depth: 1, hidden_at: '2026-10-01T00:00:00Z', hidden_reason: 'veto', protected: true },
    ];
    for (let i = 3; i <= 1502; i++) {
      categories.push({ id: id(i), slug: `c${i}`, name: `C${i}`, parent_id: id(1), depth: 1, hidden_at: null, hidden_reason: null, protected: false });
    }
    const visibility: Row[] = categories.map((c, i) => ({ category_id: c.id, distinct_published: i * 2, hidden: false, visible: true }));
    const { status, body, calls } = await get('/admin/api/tree', {
      categories,
      category_visibility: visibility,
      category_flags: [
        { id: 1, name: 'Cheese', norm: 'cheese', category_id: id(2), note: null, created_at: 'x' },
        { id: 2, name: 'Gone', norm: 'gone', category_id: null, note: null, created_at: 'x' },
      ],
      admin_notes: [
        { id: 1, target_type: 'category', target_id: id(2), body: 'a', created_at: 'x' },
        { id: 2, target_type: 'category', target_id: id(2), body: 'b', created_at: 'x' },
        { id: 3, target_type: 'question', target_id: id(1), body: 'q note, not a category', created_at: 'x' },
      ],
    });
    expect(status).toBe(200);
    expect(body.categories).toHaveLength(1502);
    expect(body.categories[0]).toEqual({
      id: id(1), slug: 'food', name: 'Food', parentId: null, depth: 0, count: 0,
      hidden: false, hiddenReason: null, protected: false, flagged: false, notes: 0,
    });
    expect(body.categories[1]).toEqual({
      id: id(2), slug: 'cheese', name: 'Cheese', parentId: id(1), depth: 1, count: 2,
      hidden: true, hiddenReason: 'veto', protected: true, flagged: true, notes: 2,
    });
    expect(body.categories[1501].count).toBe(3002);
    // categories and visibility both needed a second page
    expect(calls.filter((c) => c.includes('/rest/v1/categories?')).length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => c.includes('/rest/v1/category_visibility?')).length).toBeGreaterThanOrEqual(2);
  });
});

describe('GET /admin/api/categories/:slug/questions', () => {
  const tables = (): Tables => ({
    categories: [
      { id: id(1), slug: 'food', name: 'Food', parent_id: null, depth: 0, hidden_at: null, hidden_reason: null, protected: false },
      { id: id(2), slug: 'cheese', name: 'Cheese', parent_id: id(1), depth: 1, hidden_at: null, hidden_reason: null, protected: false },
    ],
    question_categories: [
      { question_id: id(10), category_id: id(2) },
      { question_id: id(11), category_id: id(2) },
      { question_id: id(12), category_id: id(2) },
      { question_id: id(13), category_id: id(1) }, // parent only: not a direct link
    ],
    questions: [
      { id: id(10), question_text: 'Q10', correct_answer: 'A10', distractors: ['x', 'y', 'z'], fun_fact: 'F', status: 'published', parked_reason: null },
      { id: id(11), question_text: 'Q11', correct_answer: 'A11', distractors: ['x'], fun_fact: null, status: 'parked', parked_reason: 'owner: meh' },
      { id: id(12), question_text: 'Q12', correct_answer: 'A12', distractors: [], fun_fact: null, status: 'pending', parked_reason: null },
      { id: id(13), question_text: 'Q13', correct_answer: 'A13', distractors: [], fun_fact: null, status: 'published', parked_reason: null },
    ],
    admin_notes: [{ id: 1, target_type: 'question', target_id: id(10), body: 'n', created_at: 'x' }],
  });

  it('published direct links only by default', async () => {
    const { status, body } = await get('/admin/api/categories/cheese/questions', tables());
    expect(status).toBe(200);
    expect(body.questions).toEqual([
      { id: id(10), text: 'Q10', answer: 'A10', distractors: ['x', 'y', 'z'], funFact: 'F', status: 'published', notes: 1 },
    ]);
  });

  it('include=hidden adds parked questions', async () => {
    const { body } = await get('/admin/api/categories/cheese/questions?include=hidden', tables());
    expect(body.questions.map((q: { id: string }) => q.id).sort()).toEqual([id(10), id(11)]);
  });

  it('unknown slug -> 404', async () => {
    const { status } = await get('/admin/api/categories/nope/questions', tables());
    expect(status).toBe(404);
  });
});

describe('GET /admin/api/changes', () => {
  it('groups by run, newest first, with summaries and undone state', async () => {
    const { status, body } = await get('/admin/api/changes?limit=2', {
      category_changes: [
        { id: 1, run_id: 'r1', action: 'hide', payload: { slug: 'a', reason: 'trimmed' }, prior: {}, created_at: '2026-10-01T00:00:00Z', undone_at: null },
        { id: 2, run_id: 'r2', action: 'merge', payload: { survivor: 'food', absorbed: 'cheese', why: 'w' }, prior: {}, created_at: '2026-10-02T00:00:00Z', undone_at: '2026-10-03T00:00:00Z' },
        { id: 3, run_id: 'r3', action: 'drop', payload: { slug: 'b' }, prior: {}, created_at: '2026-10-04T00:00:00Z', undone_at: null },
        { id: 4, run_id: 'r3', action: 'hide_question', payload: { questionId: id(9), reason: 'dull' }, prior: {}, created_at: '2026-10-04T00:00:01Z', undone_at: null },
      ],
    });
    expect(status).toBe(200);
    expect(body.runs).toEqual([
      { runId: 'r3', at: '2026-10-04T00:00:01Z', undone: false, actions: [
        { action: 'drop', summary: 'Dropped b' },
        { action: 'hide_question', summary: `Hid question ${id(9)}: dull` },
      ] },
      { runId: 'r2', at: '2026-10-02T00:00:00Z', undone: true, actions: [{ action: 'merge', summary: 'Merged cheese into food' }] },
    ]);
  });

  it('rejects a bad limit', async () => {
    const { status } = await get('/admin/api/changes?limit=abc', { category_changes: [] });
    expect(status).toBe(400);
  });
});

describe('GET /admin/api/rules and /sweeps', () => {
  const tables = (): Tables => ({
    question_rules: [
      { id: 1, body: 'No dull meals', example_question_id: null, active: true, created_at: '2026-10-01T00:00:00Z' },
      { id: 2, body: 'No dates', example_question_id: id(10), active: false, created_at: '2026-10-02T00:00:00Z' },
    ],
    sweep_runs: [
      { id: 5, rule_id: 1, status: 'applied', total: 10, judged: 10, proposed: 1, notice_sent_at: null, tg_message_id: null, execute_after: null, created_at: '2026-10-03T00:00:00Z' },
      { id: 6, rule_id: 1, status: 'noticed', total: 10, judged: 10, proposed: 2, notice_sent_at: 'n', tg_message_id: 7, execute_after: '2026-10-05T00:00:00Z', created_at: '2026-10-04T00:00:00Z' },
    ],
    sweep_proposals: [
      { sweep_id: 6, question_id: id(10), verdict: 'drop', reason: 'dull', kept_at: null, applied_at: null },
      { sweep_id: 6, question_id: id(11), verdict: 'keep', reason: 'fine', kept_at: null, applied_at: null },
      { sweep_id: 6, question_id: id(12), verdict: 'drop', reason: 'meh', kept_at: 'k', applied_at: null },
    ],
    questions: [
      { id: id(10), question_text: 'Q10', correct_answer: 'A10', status: 'published' },
      { id: id(12), question_text: 'Q12', correct_answer: 'A12', status: 'published' },
    ],
  });

  it('rules carry their last sweep', async () => {
    const { status, body } = await get('/admin/api/rules', tables());
    expect(status).toBe(200);
    expect(body.rules).toEqual([
      { id: 2, body: 'No dates', exampleQuestionId: id(10), active: false, createdAt: '2026-10-02T00:00:00Z', lastSweep: null },
      { id: 1, body: 'No dull meals', exampleQuestionId: null, active: true, createdAt: '2026-10-01T00:00:00Z',
        lastSweep: { id: 6, status: 'noticed', total: 10, judged: 10, proposed: 2, executeAfter: '2026-10-05T00:00:00Z', createdAt: '2026-10-04T00:00:00Z' } },
    ]);
  });

  it('sweeps list drop proposals only', async () => {
    const { body } = await get('/admin/api/sweeps', tables());
    expect(body.sweeps.map((s: { id: number }) => s.id)).toEqual([6, 5]);
    expect(body.sweeps[0]).toMatchObject({ id: 6, ruleId: 1, ruleBody: 'No dull meals', status: 'noticed' });
    expect(body.sweeps[0].proposals).toEqual([
      { questionId: id(10), text: 'Q10', answer: 'A10', reason: 'dull', keptAt: null, appliedAt: null },
      { questionId: id(12), text: 'Q12', answer: 'A12', reason: 'meh', keptAt: 'k', appliedAt: null },
    ]);
    expect(body.sweeps[1].proposals).toEqual([]);
  });
});

describe('GET /admin/api/questions/hidden', () => {
  it('hidden questions route lists parked questions with reasons', async () => {
    const { status, body } = await get('/admin/api/questions/hidden?limit=2', {
      questions: [
        { id: id(1), question_text: 'Q1', correct_answer: 'A1', status: 'parked', parked_reason: 'owner: meh' },
        { id: id(2), question_text: 'Q2', correct_answer: 'A2', status: 'published', parked_reason: null },
        { id: id(3), question_text: 'Q3', correct_answer: 'A3', status: 'parked', parked_reason: 'rule 7' },
        { id: id(4), question_text: 'Q4', correct_answer: 'A4', status: 'parked', parked_reason: 'owner: dropped' },
      ],
    });
    expect(status).toBe(200);
    expect(body.questions).toEqual([
      { id: id(1), text: 'Q1', answer: 'A1', parkedReason: 'owner: meh' },
      { id: id(3), text: 'Q3', answer: 'A3', parkedReason: 'rule 7' },
    ]);
  });
});

describe('GET /admin/api/requests (finding 4)', () => {
  const admin_requests: Row[] = [
    { id: 1, action: 'drop', payload: { slugs: ['a'] }, status: 'done', result: 'dropped 1', run_id: 'admin-1', created_at: '2026-10-01T00:00:00Z', done_at: '2026-10-01T00:05:00Z' },
    { id: 2, action: 'merge', payload: { slugs: ['b'] }, status: 'queued', result: null, run_id: null, created_at: '2026-10-02T00:00:00Z', done_at: null },
    { id: 3, action: 'unhide', payload: { slugs: ['c'] }, status: 'failed', result: 'c: use Undo on the drop run', run_id: 'admin-3', created_at: '2026-10-03T00:00:00Z', done_at: '2026-10-03T00:05:00Z' },
  ];
  it('lists the newest requests with status and result', async () => {
    const { status, body } = await get('/admin/api/requests?limit=2', { admin_requests });
    expect(status).toBe(200);
    expect(body.requests).toEqual([
      { id: 3, action: 'unhide', payload: { slugs: ['c'] }, status: 'failed', result: 'c: use Undo on the drop run', createdAt: '2026-10-03T00:00:00Z', doneAt: '2026-10-03T00:05:00Z' },
      { id: 2, action: 'merge', payload: { slugs: ['b'] }, status: 'queued', result: null, createdAt: '2026-10-02T00:00:00Z', doneAt: null },
    ]);
  });
  it('defaults to 50 and rejects a bad limit', async () => {
    const ok = await get('/admin/api/requests', { admin_requests });
    expect(ok.body.requests).toHaveLength(3);
    const bad = await get('/admin/api/requests?limit=0', { admin_requests });
    expect(bad.status).toBe(400);
  });
});
