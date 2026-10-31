// Admin write API. Runs only after verifyAccess, the Origin check and the JSON content-type check (index.ts).
// Every input is validated here; errors name the field only, never the offending value.
import { json } from './auth';
import { normCategoryName } from './norm';
import type { Ctx, Route } from './api';

type Obj = Record<string, unknown>;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BIGINT = /^[1-9][0-9]{0,15}$/; // bigserial ids
const RUN_ID = /^[A-Za-z0-9._:-]{1,100}$/;

const bad = (field: string): Response => json({ error: `invalid ${field}` }, 400);
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, min: number, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length >= min && t.length <= max ? t : null;
};

async function body(request: Request): Promise<Obj | null> {
  try {
    const b = await request.json();
    return isObj(b) ? b : null;
  } catch {
    return null;
  }
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

async function queue(ctx: Ctx, action: string, payload: Obj): Promise<Response> {
  const { data, error } = await ctx.sb.from('admin_requests').insert({ action, payload }).select('id').single();
  if (error) fail('queue request', error);
  return json({ id: (data as Obj).id });
}

async function requests(ctx: Ctx): Promise<Response> {
  const b = await body(ctx.request);
  if (!b) return bad('body');
  if (b.action !== 'merge' && b.action !== 'drop' && b.action !== 'unhide') return bad('action');
  if (!Array.isArray(b.slugs) || b.slugs.length < 1 || b.slugs.length > 50) return bad('slugs');
  if (!b.slugs.every((s) => typeof s === 'string' && s.length <= 100 && SLUG.test(s))) return bad('slugs');
  return queue(ctx, b.action, { slugs: [...new Set(b.slugs as string[])] });
}

async function undo(ctx: Ctx): Promise<Response> {
  const b = await body(ctx.request);
  if (!b) return bad('body');
  if (typeof b.runId !== 'string' || !RUN_ID.test(b.runId)) return bad('runId');
  return queue(ctx, 'undo', { runId: b.runId });
}

async function hideQuestion(ctx: Ctx): Promise<Response> {
  const id = ctx.params.id ?? '';
  if (!UUID.test(id)) return bad('id');
  const b = await body(ctx.request);
  if (!b) return bad('body');
  const reason = str(b.reason, 1, 200);
  if (reason === null) return bad('reason');
  const runId = `admin-q-${Date.now()}`;
  const { error } = await ctx.sb.rpc('admin_hide_question', { p_question: id, p_reason: reason, p_run: runId });
  if (error) fail('hide question', error);
  return json({ ok: true, runId });
}

async function unhideQuestion(ctx: Ctx): Promise<Response> {
  const id = ctx.params.id ?? '';
  if (!UUID.test(id)) return bad('id');
  const runId = `admin-q-${Date.now()}`;
  const { error } = await ctx.sb.rpc('admin_unhide_question', { p_question: id, p_run: runId });
  if (error) fail('unhide question', error);
  return json({ ok: true, runId });
}

async function findCategory(ctx: Ctx, slug: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await ctx.sb.from('categories').select('id, name').eq('slug', slug).limit(1);
  if (error) fail('category', error);
  return ((data ?? []) as { id: string; name: string }[])[0] ?? null;
}

async function addFlag(ctx: Ctx): Promise<Response> {
  const b = await body(ctx.request);
  if (!b) return bad('body');
  if (typeof b.slug !== 'string' || b.slug.length > 100 || !SLUG.test(b.slug)) return bad('slug');
  const cat = await findCategory(ctx, b.slug);
  if (!cat) return json({ error: 'not found' }, 404);
  const norm = normCategoryName(cat.name);
  if (!norm) return bad('slug');
  const { error } = await ctx.sb
    .from('category_flags')
    .upsert({ name: cat.name.trim().slice(0, 120), norm, category_id: cat.id, note: 'admin' }, { onConflict: 'norm', ignoreDuplicates: true });
  if (error) fail('add flag', error);
  return json({ ok: true, norm });
}

async function removeFlag(ctx: Ctx): Promise<Response> {
  const slug = ctx.params.slug ?? '';
  if (slug.length > 100 || !SLUG.test(slug)) return bad('slug');
  const cat = await findCategory(ctx, slug);
  const norms = new Set([normCategoryName(slug)]);
  if (cat) norms.add(normCategoryName(cat.name));
  let removed = 0;
  if (cat) {
    const { data, error } = await ctx.sb.from('category_flags').delete().eq('category_id', cat.id).select('id');
    if (error) fail('remove flag', error);
    removed += (data ?? []).length;
  }
  for (const n of norms) {
    if (!n) continue;
    const { data, error } = await ctx.sb.from('category_flags').delete().eq('norm', n).select('id');
    if (error) fail('remove flag', error);
    removed += (data ?? []).length;
  }
  return json({ ok: true, removed });
}

async function addNote(ctx: Ctx): Promise<Response> {
  const b = await body(ctx.request);
  if (!b) return bad('body');
  if (b.targetType !== 'category' && b.targetType !== 'question') return bad('targetType');
  if (typeof b.targetId !== 'string' || !UUID.test(b.targetId)) return bad('targetId');
  const text = str(b.body, 1, 2000);
  if (text === null) return bad('body');
  const { data, error } = await ctx.sb
    .from('admin_notes')
    .insert({ target_type: b.targetType, target_id: b.targetId, body: text })
    .select('id')
    .single();
  if (error) fail('add note', error);
  return json({ id: (data as Obj).id });
}

async function addRule(ctx: Ctx): Promise<Response> {
  const b = await body(ctx.request);
  if (!b) return bad('body');
  const text = str(b.body, 5, 500);
  if (text === null) return bad('body');
  const row: Obj = { body: text };
  if (b.exampleQuestionId !== undefined && b.exampleQuestionId !== null) {
    if (typeof b.exampleQuestionId !== 'string' || !UUID.test(b.exampleQuestionId)) return bad('exampleQuestionId');
    row.example_question_id = b.exampleQuestionId;
  }
  const { data, error } = await ctx.sb.from('question_rules').insert(row).select('id').single();
  if (error) fail('add rule', error);
  return json({ id: (data as Obj).id });
}

async function setRuleActive(ctx: Ctx): Promise<Response> {
  const id = ctx.params.id ?? '';
  if (!BIGINT.test(id)) return bad('id');
  const b = await body(ctx.request);
  if (!b) return bad('body');
  if (typeof b.active !== 'boolean') return bad('active');
  const { data, error } = await ctx.sb.from('question_rules').update({ active: b.active }).eq('id', id).select('id');
  if (error) fail('set rule active', error);
  if (!(data ?? []).length) return json({ error: 'not found' }, 404);
  return json({ ok: true });
}

async function sweepRule(ctx: Ctx): Promise<Response> {
  const id = ctx.params.id ?? '';
  if (!BIGINT.test(id)) return bad('id');
  return queue(ctx, 'sweep', { ruleId: Number(id) });
}

async function keepProposals(ctx: Ctx): Promise<Response> {
  const id = ctx.params.id ?? '';
  if (!BIGINT.test(id)) return bad('id');
  const b = await body(ctx.request);
  if (!b) return bad('body');
  const ids = b.questionIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500) return bad('questionIds');
  if (!ids.every((q) => typeof q === 'string' && UUID.test(q))) return bad('questionIds');
  const { data, error } = await ctx.sb
    .from('sweep_proposals')
    .update({ kept_at: new Date().toISOString() })
    .eq('sweep_id', id)
    .is('applied_at', null)
    .in('question_id', [...new Set(ids as string[])])
    .select('question_id');
  if (error) fail('keep proposals', error);
  return json({ kept: (data ?? []).length });
}

export const WRITE_ROUTES: Route[] = [
  { method: 'POST', path: '/admin/api/requests', handler: requests },
  { method: 'POST', path: '/admin/api/undo', handler: undo },
  { method: 'POST', path: '/admin/api/questions/:id/hide', handler: hideQuestion },
  { method: 'POST', path: '/admin/api/questions/:id/unhide', handler: unhideQuestion },
  { method: 'POST', path: '/admin/api/flags', handler: addFlag },
  { method: 'DELETE', path: '/admin/api/flags/:slug', handler: removeFlag },
  { method: 'POST', path: '/admin/api/notes', handler: addNote },
  { method: 'POST', path: '/admin/api/rules', handler: addRule },
  { method: 'POST', path: '/admin/api/rules/:id', handler: setRuleActive },
  { method: 'POST', path: '/admin/api/rules/:id/sweep', handler: sweepRule },
  { method: 'POST', path: '/admin/api/sweeps/:id/keep', handler: keepProposals },
];
