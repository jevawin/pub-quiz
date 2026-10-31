// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { handle } from '../index';
import { normCategoryName } from '../norm';
import { makeEnv, makeKeys, req, sign, stubFetch, type Keys, type Tables, type WriteReply } from './helpers';

let keys: Keys;
let token: string;
beforeAll(async () => {
  keys = await makeKeys();
  token = await sign(keys);
});

const Q = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';

async function call(method: string, path: string, body?: unknown, tables: Tables = {}, reply?: WriteReply, extra: Record<string, string> = {}) {
  const s = stubFetch(keys, tables, reply);
  const res = await handle(req(path, token, method, body, extra), makeEnv(), { fetch: s.fetch });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { res, body: parsed, writes: s.writes, calls: s.calls };
}

describe('norm', () => {
  // Expected values were computed by running the pipeline's normCategoryName (pipeline/src/lib/taxonomy/flags.ts)
  // on 2026-10-30; the pipeline file is outside this package's tsconfig, so they are hard-coded.
  const cases: [string, string][] = [
    ['Breakfast Foods', 'breakfast-food'],
    ['breakfast-foods', 'breakfast-food'],
    ['The Breakfast Food', 'breakfast-food'],
    ['Rock & Roll', 'rock-roll'],
    ['Ships', 'ship'],
    ['Glass', 'glass'],
    ['Science and Nature', 'science-nature'],
    ['  Cats!! ', 'cat'],
    ['Art of the 90s', 'art-90s'],
    ['Éclairs & Café', 'clair-caf'],
  ];
  it('norm matches pipeline normCategoryName', () => {
    for (const [i, o] of cases) expect(normCategoryName(i)).toBe(o);
  });
});

describe('POST /admin/api/requests', () => {
  it('merge request queues one row', async () => {
    const { res, body, writes } = await call('POST', '/admin/api/requests', { action: 'merge', slugs: ['a-b', 'c', 'a-b'] }, {}, () => [{ id: 7 }]);
    expect(res.status).toBe(200);
    expect(body).toEqual({ id: 7 });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.table).toBe('admin_requests');
    expect(writes[0]!.method).toBe('POST');
    expect(writes[0]!.body).toEqual({ action: 'merge', payload: { slugs: ['a-b', 'c'] } });
  });
  it('rejects 51 slugs, 0 slugs, bad slugs, bad action', async () => {
    const many = Array.from({ length: 51 }, (_, i) => `s${i}`);
    for (const b of [
      { action: 'merge', slugs: many },
      { action: 'merge', slugs: [] },
      { action: 'merge', slugs: ['Bad Slug'] },
      { action: 'merge', slugs: ['-x'] },
      { action: 'merge', slugs: [1] },
      { action: 'sweep', slugs: ['a'] },
      { action: 'drop' },
      [],
      'str',
    ]) {
      const r = await call('POST', '/admin/api/requests', b);
      expect(r.res.status, JSON.stringify(b)).toBe(400);
      expect(r.writes).toEqual([]);
      expect(typeof r.body.error).toBe('string');
    }
  });
  it('bad JSON -> 400 without echoing the input', async () => {
    const r = await call('POST', '/admin/api/requests', '{not json SECRET');
    expect(r.res.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain('SECRET');
  });
  it('unhide and drop are accepted', async () => {
    for (const action of ['unhide', 'drop']) {
      expect((await call('POST', '/admin/api/requests', { action, slugs: ['x'] })).res.status).toBe(200);
    }
  });
});

describe('POST /admin/api/undo', () => {
  it('queues an undo row', async () => {
    const r = await call('POST', '/admin/api/undo', { runId: 'admin-q-1700000000000' });
    expect(r.res.status).toBe(200);
    expect(r.writes[0]!.body).toEqual({ action: 'undo', payload: { runId: 'admin-q-1700000000000' } });
  });
  it('rejects empty / odd / long runId', async () => {
    for (const runId of ['', 'a b', 'x'.repeat(101), 5, undefined]) {
      expect((await call('POST', '/admin/api/undo', { runId })).res.status).toBe(400);
    }
  });
});

describe('question hide / unhide', () => {
  it('hide calls the rpc with an admin run id', async () => {
    const before = Date.now();
    const r = await call('POST', `/admin/api/questions/${Q}/hide`, { reason: 'too hard' }, {}, () => null);
    expect(r.res.status).toBe(200);
    const w = r.writes[0]!;
    expect(w.table).toBe('rpc/admin_hide_question');
    expect(w.body.p_question).toBe(Q);
    expect(w.body.p_reason).toBe('too hard');
    expect(w.body.p_run).toMatch(/^admin-q-\d{13}$/);
    expect(Number(w.body.p_run.slice(8))).toBeGreaterThanOrEqual(before);
    expect(r.body.runId).toBe(w.body.p_run);
  });
  it('unhide calls the rpc', async () => {
    const r = await call('POST', `/admin/api/questions/${Q}/unhide`, {}, {}, () => null);
    expect(r.res.status).toBe(200);
    expect(r.writes[0]!.table).toBe('rpc/admin_unhide_question');
    expect(r.writes[0]!.body.p_question).toBe(Q);
    expect(r.writes[0]!.body.p_run).toMatch(/^admin-q-\d+$/);
  });
  it('validates id and reason', async () => {
    expect((await call('POST', '/admin/api/questions/nope/hide', { reason: 'x' })).res.status).toBe(400);
    expect((await call('POST', `/admin/api/questions/${Q}/hide`, { reason: '' })).res.status).toBe(400);
    expect((await call('POST', `/admin/api/questions/${Q}/hide`, { reason: 'x'.repeat(201) })).res.status).toBe(400);
    expect((await call('POST', `/admin/api/questions/${Q}/hide`, {})).res.status).toBe(400);
  });
});

describe('flags', () => {
  const cats = [{ id: C, slug: 'breakfast-foods', name: 'Breakfast Foods' }];
  it('POST upserts with the pipeline semantics', async () => {
    const r = await call('POST', '/admin/api/flags', { slug: 'breakfast-foods' }, { categories: cats });
    expect(r.res.status).toBe(200);
    const w = r.writes[0]!;
    expect(w.table).toBe('category_flags');
    expect(w.query).toContain('on_conflict=norm');
    expect(w.body).toEqual({ name: 'Breakfast Foods', norm: 'breakfast-food', category_id: C, note: 'admin' });
  });
  it('POST unknown category -> 404, bad slug -> 400', async () => {
    const r = await call('POST', '/admin/api/flags', { slug: 'nope' }, { categories: cats });
    expect(r.res.status).toBe(404);
    expect(r.writes).toEqual([]);
    expect((await call('POST', '/admin/api/flags', { slug: 'No Good' }, { categories: cats })).res.status).toBe(400);
  });
  it('DELETE removes by category id and by norm', async () => {
    const r = await call('DELETE', '/admin/api/flags/breakfast-foods', undefined, { categories: cats }, () => []);
    expect(r.res.status).toBe(200);
    const qs = r.writes.map((w) => decodeURIComponent(w.query));
    expect(r.writes.every((w) => w.method === 'DELETE' && w.table === 'category_flags')).toBe(true);
    expect(qs.some((q) => q.includes(`category_id=eq.${C}`))).toBe(true);
    expect(qs.some((q) => q.includes('norm=eq.breakfast-food'))).toBe(true);
  });
  it('DELETE bad slug -> 400', async () => {
    expect((await call('DELETE', '/admin/api/flags/Bad_Slug')).res.status).toBe(400);
  });
});

describe('notes and rules', () => {
  it('note insert', async () => {
    const r = await call('POST', '/admin/api/notes', { targetType: 'question', targetId: Q, body: 'hmm' });
    expect(r.res.status).toBe(200);
    expect(r.writes[0]!.table).toBe('admin_notes');
    expect(r.writes[0]!.body).toEqual({ target_type: 'question', target_id: Q, body: 'hmm' });
  });
  it('note validation', async () => {
    for (const b of [
      { targetType: 'user', targetId: Q, body: 'x' },
      { targetType: 'category', targetId: 'zz', body: 'x' },
      { targetType: 'category', targetId: Q, body: '' },
      { targetType: 'category', targetId: Q, body: 'x'.repeat(2001) },
    ]) {
      expect((await call('POST', '/admin/api/notes', b)).res.status, JSON.stringify(b)).toBe(400);
    }
  });
  it('rule insert with and without example', async () => {
    const a = await call('POST', '/admin/api/rules', { body: 'no trick questions' });
    expect(a.writes[0]!.body).toEqual({ body: 'no trick questions' });
    const b = await call('POST', '/admin/api/rules', { body: 'no trick questions', exampleQuestionId: Q });
    expect(b.writes[0]!.body).toEqual({ body: 'no trick questions', example_question_id: Q });
    for (const bad of [{ body: 'abcd' }, { body: 'x'.repeat(501) }, { body: 'fine rule', exampleQuestionId: 'no' }]) {
      expect((await call('POST', '/admin/api/rules', bad)).res.status).toBe(400);
    }
  });
  it('rule active toggle; 404 when absent', async () => {
    const ok = await call('POST', '/admin/api/rules/12', { active: false }, {}, () => [{ id: 12 }]);
    expect(ok.res.status).toBe(200);
    expect(ok.writes[0]!.method).toBe('PATCH');
    expect(ok.writes[0]!.body).toEqual({ active: false });
    expect((await call('POST', '/admin/api/rules/12', { active: false }, {}, () => [])).res.status).toBe(404);
    expect((await call('POST', '/admin/api/rules/12', { active: 'no' })).res.status).toBe(400);
    expect((await call('POST', '/admin/api/rules/abc', { active: true })).res.status).toBe(400);
  });
  it('rule sweep queues a sweep request', async () => {
    const r = await call('POST', '/admin/api/rules/12/sweep', {}, {}, () => [{ id: 9 }]);
    expect(r.body).toEqual({ id: 9 });
    expect(r.writes[0]!.body).toEqual({ action: 'sweep', payload: { ruleId: 12 } });
  });
});

describe('sweep keep', () => {
  it('keep only touches unapplied proposals', async () => {
    const r = await call('POST', '/admin/api/sweeps/5/keep', { questionIds: [Q, C] }, {}, () => [{ question_id: Q }]);
    expect(r.res.status).toBe(200);
    expect(r.body).toEqual({ kept: 1 });
    const w = r.writes[0]!;
    expect(w.method).toBe('PATCH');
    expect(w.table).toBe('sweep_proposals');
    const q = decodeURIComponent(w.query);
    expect(q).toContain('sweep_id=eq.5');
    expect(q).toContain('applied_at=is.null');
    expect(q).toContain(`question_id=in.(${Q},${C})`);
    expect(typeof w.body.kept_at).toBe('string');
  });
  it('validates ids', async () => {
    expect((await call('POST', '/admin/api/sweeps/5/keep', { questionIds: [] })).res.status).toBe(400);
    expect((await call('POST', '/admin/api/sweeps/5/keep', { questionIds: ['x'] })).res.status).toBe(400);
    expect((await call('POST', '/admin/api/sweeps/x/keep', { questionIds: [Q] })).res.status).toBe(400);
  });
});

describe('CSRF hardening', () => {
  it('POST with non-JSON content-type -> 415', async () => {
    const r = await call('POST', '/admin/api/undo', 'runId=x', {}, undefined, { 'content-type': 'application/x-www-form-urlencoded' });
    expect(r.res.status).toBe(415);
    expect(r.writes).toEqual([]);
  });
  it('foreign Origin -> 403; own Origin passes', async () => {
    const bad = await call('POST', '/admin/api/undo', { runId: 'x' }, {}, undefined, { origin: 'https://evil.example' });
    expect(bad.res.status).toBe(403);
    expect(bad.writes).toEqual([]);
    const del = await call('DELETE', '/admin/api/flags/x', undefined, {}, undefined, { origin: 'https://evil.example' });
    expect(del.res.status).toBe(403);
    const ok = await call('POST', '/admin/api/undo', { runId: 'x' }, {}, undefined, { origin: 'https://quiz.example' });
    expect(ok.res.status).toBe(200);
  });
});

describe('write routes without auth', () => {
  it('writes without auth -> 401', async () => {
    for (const [m, p] of [
      ['POST', '/admin/api/requests'],
      ['POST', '/admin/api/undo'],
      ['DELETE', '/admin/api/flags/x'],
      ['POST', `/admin/api/questions/${Q}/hide`],
    ] as const) {
      const s = stubFetch(keys);
      const res = await handle(req(p, undefined, m, {}), makeEnv(), { fetch: s.fetch });
      expect(res.status, p).toBe(401);
      expect(s.writes).toEqual([]);
    }
  });
});
