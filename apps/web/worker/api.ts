// Admin read API. Every handler here runs only after verifyAccess passed (see index.ts).
// PostgREST caps a response at 1000 rows, so anything that can grow is paged with .range().
import type { SupabaseClient } from '@supabase/supabase-js';
import { json } from './auth';
import { WRITE_ROUTES } from './write';

export interface Ctx {
  sb: SupabaseClient;
  url: URL;
  params: Record<string, string>;
  request: Request;
  email: string;
}

export interface Route {
  method: 'GET' | 'POST' | 'DELETE';
  path: string; // `:name` segments are params
  handler: (ctx: Ctx) => Promise<Response>;
}

type Row = Record<string, any>;

const PAGE = 1000;
const IN_CHUNK = 100; // ids per `in.(...)` filter, keeps the URL short
const MAX_PAGES = 50; // hard stop: 50k rows

interface Res {
  data: unknown;
  error: { message: string } | null;
}

/** Pages a query until a short page. `build(from, to)` must apply a stable order and `.range(from, to)`. */
export async function pageAll(build: (from: number, to: number) => PromiseLike<Res>, what: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`${what}: ${error.message}`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  throw new Error(`${what}: more than ${MAX_PAGES * PAGE} rows`);
}

function chunks<T>(xs: T[], n = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Rows whose `col` is in `ids`, fetched in chunks (and paged within a chunk). */
async function inChunks(
  ids: string[],
  build: (chunk: string[], from: number, to: number) => PromiseLike<Res>,
  what: string,
): Promise<Row[]> {
  const out: Row[] = [];
  for (const c of chunks([...new Set(ids)])) out.push(...(await pageAll((f, t) => build(c, f, t), what)));
  return out;
}

function countBy(rows: Row[], key: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + 1);
  return m;
}

// ---- GET /admin/api/tree ----
async function tree({ sb }: Ctx): Promise<Response> {
  const [cats, vis, flags, notes] = await Promise.all([
    pageAll(
      (f, t) => sb.from('categories').select('id, slug, name, parent_id, depth, hidden_at, hidden_reason, protected').order('id').range(f, t),
      'categories',
    ),
    pageAll((f, t) => sb.from('category_visibility').select('category_id, distinct_published').order('category_id').range(f, t), 'visibility'),
    pageAll((f, t) => sb.from('category_flags').select('category_id').not('category_id', 'is', null).order('id').range(f, t), 'flags'),
    pageAll(
      (f, t) => sb.from('admin_notes').select('target_id').eq('target_type', 'category').order('id').range(f, t),
      'notes',
    ),
  ]);
  const count = new Map(vis.map((v) => [String(v.category_id), Number(v.distinct_published ?? 0)]));
  const flagged = new Set(flags.map((f) => String(f.category_id)));
  const noteCount = countBy(notes, 'target_id');
  return json({
    categories: cats.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      parentId: c.parent_id ?? null,
      depth: c.depth,
      count: count.get(c.id) ?? 0,
      hidden: c.hidden_at !== null && c.hidden_at !== undefined,
      hiddenReason: c.hidden_reason ?? null,
      protected: !!c.protected,
      flagged: flagged.has(c.id),
      notes: noteCount.get(c.id) ?? 0,
    })),
  });
}

// ---- GET /admin/api/categories/:slug/questions?include=hidden ----
async function categoryQuestions({ sb, url, params }: Ctx): Promise<Response> {
  const slug = params.slug ?? '';
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) return json({ error: 'not found' }, 404);
  const { data, error } = await sb.from('categories').select('id').eq('slug', slug).limit(1);
  if (error) throw new Error(`category: ${error.message}`);
  const cat = ((data ?? []) as Row[])[0];
  if (!cat) return json({ error: 'not found' }, 404);

  const statuses = url.searchParams.get('include') === 'hidden' ? ['published', 'parked'] : ['published'];
  const links = await pageAll(
    (f, t) => sb.from('question_categories').select('question_id').eq('category_id', cat.id).order('question_id').range(f, t),
    'links',
  );
  const qids = links.map((l) => String(l.question_id));
  const qs = await inChunks(
    qids,
    (c, f, t) =>
      sb
        .from('questions')
        .select('id, question_text, correct_answer, distractors, fun_fact, status')
        .in('id', c)
        .in('status', statuses)
        .order('id')
        .range(f, t),
    'questions',
  );
  const notes = await inChunks(
    qs.map((q) => String(q.id)),
    (c, f, t) => sb.from('admin_notes').select('target_id').eq('target_type', 'question').in('target_id', c).order('id').range(f, t),
    'notes',
  );
  const noteCount = countBy(notes, 'target_id');
  return json({
    questions: qs.map((q) => ({
      id: q.id,
      text: q.question_text,
      answer: q.correct_answer,
      distractors: Array.isArray(q.distractors) ? q.distractors : [],
      funFact: q.fun_fact ?? null,
      status: q.status,
      notes: noteCount.get(q.id) ?? 0,
    })),
  });
}

// ---- GET /admin/api/questions/hidden?limit=200 ---- (all parked questions, by id)
async function hiddenQuestions({ sb, url }: Ctx): Promise<Response> {
  const n = Number(url.searchParams.get('limit') ?? 200);
  const limit = Math.min(Math.max(Number.isFinite(n) ? Math.floor(n) : 200, 1), 500); // < PAGE, so one range is exact
  const { data, error } = await sb
    .from('questions')
    .select('id, question_text, correct_answer, parked_reason')
    .eq('status', 'parked')
    .order('id')
    .range(0, limit - 1);
  if (error) throw new Error(`hidden questions: ${error.message}`);
  return json({
    questions: ((data ?? []) as Row[]).map((q) => ({
      id: q.id,
      text: q.question_text,
      answer: q.correct_answer,
      parkedReason: q.parked_reason ?? null,
    })),
  });
}

// ---- GET /admin/api/changes?limit=50 ----
const clip = (v: unknown, n = 120): string => {
  const s = v === undefined || v === null ? '?' : String(v);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

export function summarise(action: string, payload: Row | null, prior: Row | null): string {
  const p = payload ?? {};
  switch (action) {
    case 'merge':
      return `Merged ${clip(p.absorbed)} into ${clip(p.survivor)}`;
    case 'hide':
      return `Hid ${clip(p.slug)}${p.reason ? ` (${clip(p.reason)})` : ''}`;
    case 'unhide':
      return `Unhid ${clip(p.slug)}`;
    case 'drop':
      return `Dropped ${clip(p.slug)}`;
    case 'create':
      return `Created ${clip(p.slug)}${p.parent ? ` under ${clip(p.parent)}` : ''}`;
    case 'rehome':
      return `Moved question ${clip(p.questionId)} from ${clip(p.from)} to ${clip(p.to)}`;
    case 'flag_duplicate':
      return `Flagged ${clip(p.flag)} as a duplicate of ${clip(p.keep)}`;
    case 'protect':
      return `${p.on ? 'Protected' : 'Unprotected'} ${clip(p.slug)}`;
    case 'hide_question':
      return `Hid question ${clip(p.questionId)}${p.reason ? `: ${clip(p.reason)}` : ''}`;
    case 'unhide_question':
      return `Unhid question ${clip(p.questionId)}`;
    case 'sweep_drop':
      return `Rule sweep hid question ${clip(p.questionId ?? prior?.id)}`;
    default:
      return clip(action);
  }
}

async function changes({ sb, url }: Ctx): Promise<Response> {
  const raw = url.searchParams.get('limit');
  const limit = raw === null ? 50 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return json({ error: 'limit must be 1..200' }, 400);

  // Newest rows first; stop once a run beyond the limit appears (so the last kept run is complete).
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES && seen.size <= limit; page++) {
    const from = page * PAGE;
    const { data, error } = await sb
      .from('category_changes')
      .select('id, run_id, action, payload, prior, created_at, undone_at')
      .order('id', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`changes: ${error.message}`);
    const got = (data ?? []) as Row[];
    for (const r of got) {
      seen.add(String(r.run_id));
      rows.push(r);
    }
    if (got.length < PAGE) break;
  }

  const runs = new Map<string, Row[]>();
  for (const r of rows) {
    const k = String(r.run_id);
    if (!runs.has(k)) {
      if (runs.size >= limit) continue;
      runs.set(k, []);
    }
    runs.get(k)!.push(r);
  }
  return json({
    runs: [...runs.entries()].map(([runId, rs]) => {
      const asc = [...rs].sort((a, b) => Number(a.id) - Number(b.id));
      return {
        runId,
        at: asc.map((r) => String(r.created_at)).reduce((a, b) => (b > a ? b : a)),
        actions: asc.map((r) => ({ action: r.action, summary: summarise(String(r.action), r.payload, r.prior) })),
        undone: asc.every((r) => r.undone_at !== null && r.undone_at !== undefined),
      };
    }),
  });
}

// ---- GET /admin/api/requests?limit=50 ---- (queued/running/done/failed admin requests, newest first)
async function requests({ sb, url }: Ctx): Promise<Response> {
  const raw = url.searchParams.get('limit');
  const limit = raw === null ? 50 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return json({ error: 'limit must be 1..200' }, 400);
  const { data, error } = await sb
    .from('admin_requests')
    .select('id, action, payload, status, result, created_at, done_at')
    .order('id', { ascending: false })
    .range(0, limit - 1);
  if (error) throw new Error(`requests: ${error.message}`);
  return json({
    requests: ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      action: r.action,
      payload: r.payload ?? null,
      status: r.status,
      result: r.result ?? null,
      createdAt: r.created_at ?? null,
      doneAt: r.done_at ?? null,
    })),
  });
}

// ---- GET /admin/api/rules ----
function sweepSummary(s: Row) {
  return {
    id: s.id,
    status: s.status,
    total: s.total ?? null,
    judged: s.judged,
    proposed: s.proposed,
    executeAfter: s.execute_after ?? null,
    createdAt: s.created_at,
  };
}

async function rules({ sb }: Ctx): Promise<Response> {
  const [rs, sweeps] = await Promise.all([
    pageAll((f, t) => sb.from('question_rules').select('id, body, example_question_id, active, created_at').order('id', { ascending: false }).range(f, t), 'rules'),
    pageAll(
      (f, t) => sb.from('sweep_runs').select('id, rule_id, status, total, judged, proposed, execute_after, created_at').order('id', { ascending: false }).range(f, t),
      'sweeps',
    ),
  ]);
  const last = new Map<string, Row>();
  for (const s of sweeps) if (!last.has(String(s.rule_id))) last.set(String(s.rule_id), s); // newest first
  return json({
    rules: rs.map((r) => {
      const s = last.get(String(r.id));
      return {
        id: r.id,
        body: r.body,
        exampleQuestionId: r.example_question_id ?? null,
        active: !!r.active,
        createdAt: r.created_at,
        lastSweep: s ? sweepSummary(s) : null,
      };
    }),
  });
}

// ---- GET /admin/api/sweeps ----
async function sweeps({ sb }: Ctx): Promise<Response> {
  const { data, error } = await sb
    .from('sweep_runs')
    .select('id, rule_id, status, total, judged, proposed, notice_sent_at, execute_after, created_at')
    .order('id', { ascending: false })
    .range(0, 49);
  if (error) throw new Error(`sweeps: ${error.message}`);
  const runs = (data ?? []) as Row[];
  const sweepIds = runs.map((r) => String(r.id));
  const ruleIds = runs.map((r) => String(r.rule_id));

  const [ruleRows, props] = await Promise.all([
    inChunks(ruleIds, (c, f, t) => sb.from('question_rules').select('id, body').in('id', c).order('id').range(f, t), 'rules'),
    inChunks(
      sweepIds,
      (c, f, t) =>
        sb
          .from('sweep_proposals')
          .select('sweep_id, question_id, reason, kept_at, applied_at')
          .in('sweep_id', c)
          .eq('verdict', 'drop')
          .order('sweep_id')
          .order('question_id')
          .range(f, t),
      'proposals',
    ),
  ]);
  const qs = await inChunks(
    props.map((p) => String(p.question_id)),
    (c, f, t) => sb.from('questions').select('id, question_text, correct_answer').in('id', c).order('id').range(f, t),
    'questions',
  );
  const ruleBody = new Map(ruleRows.map((r) => [String(r.id), r.body]));
  const qById = new Map(qs.map((q) => [String(q.id), q]));
  const bySweep = new Map<string, Row[]>();
  for (const p of props) {
    const k = String(p.sweep_id);
    if (!bySweep.has(k)) bySweep.set(k, []);
    bySweep.get(k)!.push(p);
  }
  return json({
    sweeps: runs.map((s) => ({
      ...sweepSummary(s),
      ruleId: s.rule_id,
      ruleBody: ruleBody.get(String(s.rule_id)) ?? null,
      noticeSentAt: s.notice_sent_at ?? null,
      proposals: (bySweep.get(String(s.id)) ?? [])
        .sort((a, b) => String(a.question_id).localeCompare(String(b.question_id)))
        .map((p) => {
          const q = qById.get(String(p.question_id));
          return {
            questionId: p.question_id,
            text: q?.question_text ?? null,
            answer: q?.correct_answer ?? null,
            reason: p.reason ?? null,
            keptAt: p.kept_at ?? null,
            appliedAt: p.applied_at ?? null,
          };
        }),
    })),
  });
}

export const ROUTES: Route[] = [
  { method: 'GET', path: '/admin/api/tree', handler: tree },
  { method: 'GET', path: '/admin/api/categories/:slug/questions', handler: categoryQuestions },
  { method: 'GET', path: '/admin/api/questions/hidden', handler: hiddenQuestions },
  { method: 'GET', path: '/admin/api/changes', handler: changes },
  { method: 'GET', path: '/admin/api/requests', handler: requests },
  { method: 'GET', path: '/admin/api/rules', handler: rules },
  { method: 'GET', path: '/admin/api/sweeps', handler: sweeps },
  ...WRITE_ROUTES,
];

export function matchRoute(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  const segs = pathname.replace(/\/+$/, '').split('/');
  for (const route of ROUTES) {
    if (route.method !== method.toUpperCase()) continue;
    const pat = route.path.split('/');
    if (pat.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pat.length; i++) {
      const p = pat[i] as string;
      const s = segs[i] as string;
      if (p.startsWith(':')) {
        try {
          params[p.slice(1)] = decodeURIComponent(s);
        } catch {
          ok = false;
        }
        if (!s) ok = false;
      } else if (p !== s) ok = false;
      if (!ok) break;
    }
    if (ok) return { route, params };
  }
  return null;
}
