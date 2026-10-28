import { randomUUID } from 'node:crypto';
import type { PipelineConfig } from '../config.js';
import type { ClaudeCaller } from '../claude.js';
import type { TypedSupabaseClient } from '../supabase.js';
import { calibrateQuestionWithChain } from '../../agents/calibrator.js';
import { expandSlugsToChain } from '../category-chain.js';
import { GENERAL_KNOWLEDGE_SLUG } from '../general-knowledge-guard.js';
import { log } from '../logger.js';
import { MAX_DEPTH, type TaxPlan, type TaxTree } from './types.js';

export interface ApplyOpts {
  runId: string;
  dryRun: boolean;
  call: ClaudeCaller;
  config: PipelineConfig;
}

export interface ApplySummary {
  merged: number;
  hidden: number;
  created: string[];
  rehomed: number;
  flagged: number;
  skippedAlreadyDone: number;
  errors: string[];
  /** Report only: actions logged under the run whose effect is NOT present in the live DB (the write failed). */
  notApplied?: { hidden: number; created: number; rehomed: number };
}

// The supabase-js builder is deliberately loosely typed here: this module only uses a small,
// well-defined slice of it (select/insert/upsert/update/delete with eq/in/is/order/range).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = { from: (table: string) => any };
const loose = (s: TypedSupabaseClient): Loose => s as unknown as Loose;

interface Cat {
  id: string;
  slug: string;
  parent_id: string | null;
  depth: number;
  hidden_at: string | null;
  hidden_reason: string | null;
  protected: boolean;
}
interface Link {
  question_id: string;
  category_id: string;
  estimate_score: number;
  observed_score: number | null;
  observed_n: number;
  created_at?: string;
  updated_at?: string;
}
interface AliasRow {
  old_slug: string;
  category_id: string;
  created_at?: string | null;
}
interface QSnap {
  links: Link[];
  leafIds: string[];
}
interface ChangeRow {
  id: number;
  payload: Record<string, unknown>;
  prior: Record<string, unknown> | null;
}

interface Ctx {
  sb: Loose;
  raw: TypedSupabaseClient;
  runId: string;
  call: ClaudeCaller;
  config: PipelineConfig;
  dry: boolean;
  summary: ApplySummary;
  /** Number of DB writes issued so far (change-log rows included). */
  writes: number;
  /** dry-run only: slugs the plan would create, so later actions can accept them. */
  dryCreated: Set<string>;
}

/** Record an error once per run: extra passes must not repeat the same (question, message) line. */
function addError(summary: ApplySummary, msg: string): void {
  if (!summary.errors.includes(msg)) summary.errors.push(msg);
}

const PAGE = 1000;
const CHUNK = 100;

type Res<T> = { data: T | null; error: { message: string } | null };

function must<T>(res: Res<T>, what: string): T | null {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

// PostgREST max-rows MEASURED 2026-10-27 on the live project: exactly 1000 (a Range 0-1999 request returned 1000
// rows of 10280). PAGE must stay <= max-rows: a server max-rows LOWER than PAGE would end the loop after the first
// short page and silently truncate every read.
async function pageAll<T>(mk: (from: number, to: number) => PromiseLike<Res<T[]>>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const data = must(await mk(from, from + PAGE - 1), what) ?? [];
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

async function loadCats(sb: Loose): Promise<Cat[]> {
  return pageAll<Cat>(
    (f, t) =>
      sb
        .from('categories')
        .select('id, slug, parent_id, depth, hidden_at, hidden_reason, protected')
        .order('id', { ascending: true })
        .range(f, t),
    'load categories',
  );
}

async function loadAliases(sb: Loose): Promise<AliasRow[]> {
  return pageAll<AliasRow>(
    (f, t) =>
      sb.from('category_aliases').select('old_slug, category_id, created_at').order('old_slug', { ascending: true }).range(f, t),
    'load aliases',
  );
}

const LINK_COLS = 'question_id, category_id, estimate_score, observed_score, observed_n, created_at, updated_at';

async function linksOfCategory(sb: Loose, categoryId: string): Promise<Link[]> {
  return pageAll<Link>(
    (f, t) =>
      sb
        .from('question_categories')
        .select(LINK_COLS)
        .eq('category_id', categoryId)
        .order('question_id', { ascending: true })
        .range(f, t),
    'load category links',
  );
}

async function linksOfQuestions(sb: Loose, qids: string[]): Promise<Link[]> {
  const out: Link[] = [];
  for (let i = 0; i < qids.length; i += CHUNK) {
    const chunk = qids.slice(i, i + CHUNK);
    out.push(
      ...(await pageAll<Link>(
        (f, t) =>
          sb
            .from('question_categories')
            .select(LINK_COLS)
            .in('question_id', chunk)
            .order('question_id', { ascending: true })
            .order('category_id', { ascending: true })
            .range(f, t),
        'load question links',
      )),
    );
  }
  return out;
}

// ---- write helpers (each counts as one write; errors throw and stop the current action) ----

async function insertRows(ctx: Ctx, table: string, rows: object | object[], what: string): Promise<void> {
  ctx.writes++;
  must(await ctx.sb.from(table).insert(rows), what);
}
async function upsertRows(
  ctx: Ctx,
  table: string,
  rows: object | object[],
  onConflict: string,
  what: string,
): Promise<void> {
  ctx.writes++;
  must(await ctx.sb.from(table).upsert(rows, { onConflict, ignoreDuplicates: false }), what);
}
async function updateRows(ctx: Ctx, table: string, vals: object, eqs: Record<string, string | number>, what: string): Promise<void> {
  ctx.writes++;
  let q = ctx.sb.from(table).update(vals);
  for (const [k, v] of Object.entries(eqs)) q = q.eq(k, v);
  must(await q, what);
}
async function deleteRows(ctx: Ctx, table: string, eqs: Record<string, string | number>, what: string): Promise<void> {
  ctx.writes++;
  let q = ctx.sb.from(table).delete();
  for (const [k, v] of Object.entries(eqs)) q = q.eq(k, v);
  must(await q, what);
}

// ---- change log ----

type Action = 'merge' | 'hide' | 'unhide' | 'create' | 'rehome' | 'flag_duplicate' | 'protect';

/**
 * The scan reads only id/payload/undone_at: `prior` holds whole question snapshots and is large, and this runs once
 * per action, so reading it on every scan was quadratic. `prior` is fetched by id for the one matched row only.
 */
async function findChange(ctx: Ctx, action: Action, match: (p: Record<string, unknown>) => boolean): Promise<ChangeRow | null> {
  const rows = await pageAll<{ id: number; payload: Record<string, unknown> | null; undone_at: string | null }>(
    (f, t) =>
      ctx.sb
        .from('category_changes')
        .select('id, payload, undone_at')
        .eq('run_id', ctx.runId)
        .eq('action', action)
        .order('id', { ascending: true })
        .range(f, t),
    'find change',
  );
  const hit = rows.find((r) => !r.undone_at && match(r.payload ?? {}));
  if (!hit) return null;
  const full = must(
    await ctx.sb.from('category_changes').select('prior').eq('id', hit.id).single(),
    'load change snapshot',
  ) as { prior: Record<string, unknown> | null } | null;
  return { id: hit.id, payload: hit.payload ?? {}, prior: full?.prior ?? null };
}

async function newChange(ctx: Ctx, action: Action, payload: object, prior: object | null): Promise<ChangeRow> {
  ctx.writes++;
  const data = must(
    await ctx.sb
      .from('category_changes')
      .insert({ run_id: ctx.runId, action, payload, prior })
      .select('id')
      .single(),
    'write change log',
  ) as { id: number } | null;
  if (!data) throw new Error('write change log: no id returned');
  return { id: data.id, payload: payload as Record<string, unknown>, prior: prior as Record<string, unknown> | null };
}

// ---- tree helpers (all on fresh DB reads, never on the stale TaxTree) ----

const byId = (cats: Cat[]) => new Map(cats.map((c) => [c.id, c]));
const bySlug = (cats: Cat[]) => new Map(cats.map((c) => [c.slug, c]));

function isProtectedOrUnder(cats: Cat[], id: string): boolean {
  const m = byId(cats);
  const seen = new Set<string>();
  let n = m.get(id);
  while (n && !seen.has(n.id)) {
    if (n.protected) return true;
    seen.add(n.id);
    n = n.parent_id ? m.get(n.parent_id) : undefined;
  }
  return false;
}

function isAncestorId(m: Map<string, Cat>, ancestorId: string, id: string): boolean {
  const seen = new Set<string>();
  let n = m.get(id);
  while (n && n.parent_id && !seen.has(n.id)) {
    seen.add(n.id);
    if (n.parent_id === ancestorId) return true;
    n = m.get(n.parent_id);
  }
  return false;
}

/** Node plus all descendants, with their current depths. */
function subtreeOf(cats: Cat[], rootId: string): Cat[] {
  const kids = new Map<string, Cat[]>();
  for (const c of cats) if (c.parent_id) kids.set(c.parent_id, [...(kids.get(c.parent_id) ?? []), c]);
  const root = byId(cats).get(rootId);
  if (!root) return [];
  const out: Cat[] = [];
  const seen = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
    stack.push(...(kids.get(n.id) ?? []));
  }
  return out;
}

/** Hops from `rootId` to every node in its subtree (root = 0). Independent of stored depths. */
function relDepths(cats: Cat[], rootId: string): Map<string, number> {
  const kids = new Map<string, Cat[]>();
  for (const c of cats) if (c.parent_id) kids.set(c.parent_id, [...(kids.get(c.parent_id) ?? []), c]);
  const out = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const k of kids.get(id) ?? []) {
      if (out.has(k.id)) continue;
      out.set(k.id, out.get(id)! + 1);
      queue.push(k.id);
    }
  }
  return out;
}

/** Slug -> category, falling back to the alias table. Returns null when neither knows it. */
function resolveSlug(cats: Cat[], aliases: AliasRow[], slug: string): Cat | null {
  const direct = bySlug(cats).get(slug);
  if (direct) return direct;
  const a = aliases.find((x) => x.old_slug === slug);
  return a ? (byId(cats).get(a.category_id) ?? null) : null;
}

/**
 * Resolve a rehome/create target: a hidden-merged node is followed through its alias to the
 * survivor; any other hidden node (trimmed/veto), or a dead alias chain, is an error.
 */
function resolveLiveTarget(cats: Cat[], aliases: AliasRow[], slug: string): Cat {
  let c = resolveSlug(cats, aliases, slug);
  const m = byId(cats);
  for (let hops = 0; c && c.hidden_at && hops < 5; hops++) {
    if (c.hidden_reason !== 'merged') throw new Error(`${slug} is hidden (${c.hidden_reason ?? 'unknown'})`);
    const a = aliases.find((x) => x.old_slug === c!.slug);
    c = a ? (m.get(a.category_id) ?? null) : null;
  }
  if (!c) throw new Error(`unknown or unresolvable slug: ${slug}`);
  if (c.hidden_at) throw new Error(`${slug} resolves to a hidden category`);
  return c;
}

function leafIdsOf(cats: Cat[], links: Link[], gkId: string | null): string[] {
  const m = byId(cats);
  const ids = links.map((l) => l.category_id).filter((id) => id !== gkId && m.has(id));
  return ids.filter((id) => !ids.some((other) => other !== id && isAncestorId(m, id, other)));
}

// ---- the shared link-move + chain-repair step (merge and rehome) ----

async function moveQuestion(
  ctx: Ctx,
  qid: string,
  snap: QSnap,
  fromId: string,
  toId: string,
  cats: Cat[],
  excludeFromChain: Set<string>,
  gkId: string | null,
): Promise<void> {
  const m = byId(cats);
  const slugOf = (id: string) => m.get(id)?.slug;
  const parentSlug = new Map<string, string | null>(
    cats.map((c) => [c.slug, c.parent_id ? (m.get(c.parent_id)?.slug ?? null) : null]),
  );

  // Desired chain, computed from the PRE-move leaves (stored in the snapshot) with from -> to.
  // A stale snapshot may name a leaf that was merged away since: follow its alias chain (bounded, cycle-safe,
  // like resolveLiveTarget) to the final live survivor, or drop it if none resolves, so a replay can never link a
  // question to a category that is now hidden as merged.
  const isMergedAway = (id: string): boolean => {
    const c = m.get(id);
    return !!c && !!c.hidden_at && c.hidden_reason === 'merged';
  };
  let leafIds0 = snap.leafIds.map((id) => (id === fromId ? toId : id));
  if (leafIds0.some(isMergedAway)) {
    const al = await loadAliases(ctx.sb);
    const survivorOf = (start: string): string | null => {
      const seen = new Set<string>();
      let id: string | null = start;
      for (let hops = 0; id && isMergedAway(id) && hops < 5; hops++) {
        if (seen.has(id)) return null;
        seen.add(id);
        const a = al.find((x) => x.old_slug === m.get(id!)!.slug);
        id = a && m.has(a.category_id) ? a.category_id : null;
      }
      return id && !m.get(id)!.hidden_at ? id : null;
    };
    leafIds0 = leafIds0.flatMap((id) => {
      if (!isMergedAway(id)) return [id];
      const s = survivorOf(id);
      return s ? [s] : [];
    });
  }
  const leafIds = [...new Set(leafIds0)];
  const leafSlugs = leafIds.map(slugOf).filter((s): s is string => !!s);
  const slugToId = new Map(cats.map((c) => [c.slug, c.id]));
  const desired = new Set(
    expandSlugsToChain(parentSlug, leafSlugs)
      .map((s) => slugToId.get(s))
      .filter((id): id is string => !!id && id !== gkId && !excludeFromChain.has(id)),
  );

  const cur = await linksOfQuestions(ctx.sb, [qid]);
  const fromLink = cur.find((l) => l.category_id === fromId);
  const toLink = cur.find((l) => l.category_id === toId);

  if (fromLink) {
    // Cap-safe move (the per-question cap trigger counts every statement, and a question may already sit
    // at 8 rows): no survivor link -> re-point the row IN PLACE (row count unchanged); survivor link exists
    // -> optionally upgrade its scores, then delete (count drops). Undo restores from the change-log snapshot.
    const keepFrom = desired.has(fromId); // a rehome keeps `from` when it is still an ancestor of another leaf
    if (toLink) {
      if (fromLink.observed_n > toLink.observed_n) {
        await updateRows(
          ctx,
          'question_categories',
          {
            estimate_score: fromLink.estimate_score,
            observed_score: fromLink.observed_score,
            observed_n: fromLink.observed_n,
          },
          { question_id: qid, category_id: toId },
          `collision update ${qid}`,
        );
      } // ties and lower: the target's own row is kept untouched
      if (!keepFrom) {
        await deleteRows(ctx, 'question_categories', { question_id: qid, category_id: fromId }, `link move delete ${qid}`);
      }
    } else if (keepFrom) {
      // Needs a genuine extra row; fails (and is recorded) if the question is already at the cap.
      await insertRows(
        ctx,
        'question_categories',
        {
          question_id: qid,
          category_id: toId,
          estimate_score: fromLink.estimate_score,
          observed_score: fromLink.observed_score,
          observed_n: fromLink.observed_n,
        },
        `link copy ${qid}`,
      );
    } else {
      await updateRows(
        ctx,
        'question_categories',
        { category_id: toId },
        { question_id: qid, category_id: fromId },
        `link move ${qid}`,
      );
    }
  }

  // Stale ancestors: only links this question had at snapshot time, never GK.
  const snapIds = new Set(snap.links.map((l) => l.category_id));
  const cur2 = await linksOfQuestions(ctx.sb, [qid]);
  for (const l of cur2) {
    if (l.category_id === gkId) continue;
    if (!snapIds.has(l.category_id) || desired.has(l.category_id)) continue;
    await deleteRows(ctx, 'question_categories', { question_id: qid, category_id: l.category_id }, `stale ancestor delete ${qid}`);
  }

  // New ancestors, scored by the chain calibrator (insert-only).
  const have = new Set((await linksOfQuestions(ctx.sb, [qid])).map((l) => l.category_id));
  const missing = [...desired].filter((id) => !have.has(id));
  if (missing.length && leafSlugs.length) {
    const q = must(
      await ctx.sb.from('questions').select('id, question_text, correct_answer, distractors').eq('id', qid).single(),
      `load question ${qid}`,
    ) as { id: string; question_text: string; correct_answer: string; distractors: unknown } | null;
    if (!q) throw new Error(`question ${qid} not found`);
    ctx.writes++;
    const out = await calibrateQuestionWithChain(
      ctx.raw as never,
      {
        id: q.id,
        question_text: q.question_text,
        correct_answer: q.correct_answer,
        distractors: Array.isArray(q.distractors) ? (q.distractors as string[]) : [],
        assigned_slugs: leafSlugs,
      },
      ctx.call,
      ctx.config,
    );
    // A failure here (e.g. the 8-row cap) only costs this question its missing ancestor rows: record, go on.
    if (!out.success) addError(ctx.summary, `calibrate ${qid}: ${out.error ?? 'failed'} (ancestors not added)`);
  }

  // GK is never touched by taxonomy changes: drop a GK row the calibrator newly added. Runs on every
  // pass (not only after a calibration) so a crash between the calibrator insert and this delete heals.
  if (gkId && !snapIds.has(gkId)) {
    const after = await linksOfQuestions(ctx.sb, [qid]);
    if (after.some((l) => l.category_id === gkId)) {
      await deleteRows(ctx, 'question_categories', { question_id: qid, category_id: gkId }, `drop calibrator GK ${qid}`);
    }
  }
}

async function snapshotQuestions(
  ctx: Ctx,
  cats: Cat[],
  qids: string[],
  gkId: string | null,
): Promise<Record<string, QSnap>> {
  const all = await linksOfQuestions(ctx.sb, qids);
  const grouped = new Map<string, Link[]>();
  for (const l of all) grouped.set(l.question_id, [...(grouped.get(l.question_id) ?? []), l]);
  const out: Record<string, QSnap> = {};
  for (const qid of qids) {
    const links = grouped.get(qid) ?? [];
    out[qid] = { links, leafIds: leafIdsOf(cats, links, gkId) };
  }
  return out;
}

const gkIdOf = (cats: Cat[]): string | null => bySlug(cats).get(GENERAL_KNOWLEDGE_SLUG)?.id ?? null;

/** GK or anything beneath it: never merged, hidden or given children (see rules.ts isGeneralKnowledgeOrUnder). */
function isGkOrUnder(cats: Cat[], id: string): boolean {
  const m = byId(cats);
  const seen = new Set<string>();
  let n = m.get(id);
  while (n && !seen.has(n.id)) {
    if (n.slug === GENERAL_KNOWLEDGE_SLUG) return true;
    seen.add(n.id);
    n = n.parent_id ? m.get(n.parent_id) : undefined;
  }
  return false;
}
const GK_REFUSAL = `${GENERAL_KNOWLEDGE_SLUG} is out of scope for taxonomy changes`;

// ---- actions ----

type Outcome = 'done' | 'skipped';

// Known Minor limitations (reviewed, deliberately left): children skipped for depth leave their questions'
// chains inconsistent; undo overwrites newer observed stats on restored rows; a rehome from a non-leaf `from`
// moves only that row; dry-run does not model state changes between actions; hideOne also resolves aliases.
async function mergeOne(ctx: Ctx, survivorSlug: string, absorbedSlug: string, why: string): Promise<Outcome> {
  const cats = await loadCats(ctx.sb);
  const aliases = await loadAliases(ctx.sb);
  const m = byId(cats);
  const S = resolveSlug(cats, aliases, survivorSlug);
  const A = bySlug(cats).get(absorbedSlug);
  if (!S) throw new Error(`unknown survivor ${survivorSlug}`);
  if (!A) throw new Error(`unknown absorbed ${absorbedSlug}`);
  if (S.id === A.id) throw new Error('survivor and absorbed are the same');
  // Defence in depth: replayed and pinned merges never pass validatePlan again.
  if (isGkOrUnder(cats, S.id) || isGkOrUnder(cats, A.id)) throw new Error(GK_REFUSAL);
  if (S.parent_id === null || A.parent_id === null) throw new Error('root category cannot be merged');
  if (isProtectedOrUnder(cats, S.id) || isProtectedOrUnder(cats, A.id)) throw new Error('protected category');
  if (isAncestorId(m, A.id, S.id)) throw new Error('cannot absorb an ancestor of the survivor');

  const links = await linksOfCategory(ctx.sb, A.id);
  const children = cats.filter((c) => c.parent_id === A.id);
  const plans = children.map((c) => {
    const sub = subtreeOf(cats, c.id);
    const rel = relDepths(cats, c.id);
    const maxNew = S.depth + 1 + Math.max(...sub.map((n) => rel.get(n.id) ?? 0));
    const cycle = sub.some((n) => n.id === S.id);
    return { child: c, sub, rel, ok: maxNew <= MAX_DEPTH && !cycle, maxNew, cycle };
  });
  const movable = plans.filter((p) => p.ok);
  const aliasOk = aliases.some((a) => a.old_slug === A.slug && a.category_id === S.id);
  const repoint = aliases.filter((a) => a.category_id === A.id);
  const done =
    !!A.hidden_at && A.hidden_reason === 'merged' && aliasOk && links.length === 0 && movable.length === 0 && repoint.length === 0;
  if (done) return 'skipped'; // checked BEFORE the survivor-hidden guard: a finished merge stays finished if its survivor is hidden later
  if (S.hidden_at) throw new Error(`survivor ${S.slug} is hidden (${S.hidden_reason ?? '?'})`);

  for (const p of plans.filter((x) => !x.ok)) {
    ctx.summary.errors.push(
      p.cycle
        ? `merge ${absorbedSlug}: child ${p.child.slug} not re-parented (would sit under itself)`
        : `merge ${absorbedSlug}: child ${p.child.slug} not re-parented (subtree would reach depth ${p.maxNew} > ${MAX_DEPTH})`,
    );
  }
  if (ctx.dry) return 'done';

  const payload = { survivor: survivorSlug, absorbed: absorbedSlug, why };
  let row = await findChange(ctx, 'merge', (p) => p.absorbed === absorbedSlug && p.survivor === survivorSlug);
  if (!row) {
    const gk = gkIdOf(cats);
    const qids = [...new Set(links.map((l) => l.question_id))];
    const prior = {
      survivorId: S.id,
      category: { id: A.id, hidden_at: A.hidden_at, hidden_reason: A.hidden_reason },
      children: children.map((c) => ({
        id: c.id,
        parent_id: c.parent_id,
        depth: c.depth,
        subtree: subtreeOf(cats, c.id).map((n) => ({ id: n.id, depth: n.depth })),
      })),
      aliasForAbsorbed: aliases.find((a) => a.old_slug === A.slug) ?? null,
      repointed: repoint,
      questions: await snapshotQuestions(ctx, cats, qids, gk),
    };
    row = await newChange(ctx, 'merge', payload, prior);
  }
  const prior = row.prior as unknown as {
    questions: Record<string, QSnap>;
  };

  // 1. re-parent absorbed children to the survivor. Descendant depths are set ABSOLUTELY (from hops below
  // the child) and the child's own parent_id/depth row is written LAST, so a crash in between leaves the
  // child still under the absorbed node and the re-run redoes the whole subtree.
  for (const p of movable) {
    for (const n of p.sub) {
      if (n.id === p.child.id) continue;
      await updateRows(ctx, 'categories', { depth: S.depth + 1 + (p.rel.get(n.id) ?? 0) }, { id: n.id }, `re-depth ${n.slug}`);
    }
    await updateRows(ctx, 'categories', { parent_id: S.id, depth: S.depth + 1 }, { id: p.child.id }, `reparent ${p.child.slug}`);
  }

  // 2. move every question link, repair chains (fresh tree: parents changed in step 1).
  // Errors are isolated per question: record, continue; a question whose link could not move keeps its
  // link on the absorbed node, which blocks the hide below (so a re-run retries it).
  const fresh = await loadCats(ctx.sb);
  const gk = gkIdOf(fresh);
  const tryMove = async (qid: string, snap: QSnap): Promise<void> => {
    try {
      await moveQuestion(ctx, qid, snap, A.id, S.id, fresh, new Set([A.id]), gk);
    } catch (err) {
      // A usage stop must end the whole run: the unit stays un-hidden/un-aliased and its change row intact,
      // so a re-run redoes the remaining work (links already moved, ancestors still to score).
      if (err instanceof Error && err.name === 'UsageStopError') throw err;
      addError(ctx.summary, `merge ${absorbedSlug}: question ${qid}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  for (const [qid, snap] of Object.entries(prior.questions)) await tryMove(qid, snap);

  // 2b. links added to the absorbed node after the snapshot: snapshot them into the same change row
  // (so undo stays exact) and move them, at most 3 extra passes.
  let remaining = await linksOfCategory(ctx.sb, A.id);
  for (let pass = 0; pass < 3 && remaining.length; pass++) {
    const fresh2 = new Map(Object.entries(prior.questions));
    const newIds = [...new Set(remaining.map((l) => l.question_id))].filter((q) => !fresh2.has(q));
    if (newIds.length) {
      Object.assign(prior.questions, await snapshotQuestions(ctx, fresh, newIds, gk));
      await updateRows(ctx, 'category_changes', { prior: row.prior }, { id: row.id }, 'extend change snapshot');
    }
    for (const qid of new Set(remaining.map((l) => l.question_id))) await tryMove(qid, prior.questions[qid]);
    remaining = await linksOfCategory(ctx.sb, A.id);
  }
  if (remaining.length) {
    throw new Error(`${remaining.length} link(s) still on absorbed ${absorbedSlug} after 3 extra passes; not hidden, not counted as merged`);
  }
  const after = await loadCats(ctx.sb);
  if (after.some((c) => c.parent_id === A.id && plans.some((p) => p.ok && p.child.id === c.id))) {
    throw new Error(`movable children remain under absorbed ${absorbedSlug}; not hidden`);
  }

  // 3. aliases: absorbed -> survivor, re-point aliases that pointed at the absorbed node
  if (!aliasOk) {
    await upsertRows(ctx, 'category_aliases', { old_slug: A.slug, category_id: S.id }, 'old_slug', `alias ${A.slug}`);
  }
  if (repoint.length) {
    await updateRows(ctx, 'category_aliases', { category_id: S.id }, { category_id: A.id }, `re-point aliases of ${A.slug}`);
  }

  // 4. hide LAST: a crash before this line leaves work for the re-run to find
  if (!(A.hidden_at && A.hidden_reason === 'merged')) {
    await updateRows(
      ctx,
      'categories',
      { hidden_at: new Date().toISOString(), hidden_reason: 'merged' },
      { id: A.id },
      `hide ${A.slug}`,
    );
  }
  return 'done';
}

async function hideOne(ctx: Ctx, slug: string): Promise<Outcome> {
  const cats = await loadCats(ctx.sb);
  const aliases = await loadAliases(ctx.sb);
  const n = resolveSlug(cats, aliases, slug);
  if (!n) throw new Error(`unknown slug ${slug}`);
  if (isGkOrUnder(cats, n.id)) throw new Error(GK_REFUSAL);
  if (n.parent_id === null) throw new Error(`root category cannot be hidden: ${slug}`);
  if (n.hidden_at) return 'skipped';
  if (isProtectedOrUnder(cats, n.id)) throw new Error(`protected category ${slug}`);
  if (ctx.dry) return 'done';
  const payload = { slug: n.slug, reason: 'trimmed' };
  const existing = await findChange(ctx, 'hide', (p) => p.slug === n.slug);
  if (!existing) {
    await newChange(ctx, 'hide', payload, { id: n.id, hidden_at: n.hidden_at, hidden_reason: n.hidden_reason });
  }
  await updateRows(ctx, 'categories', { hidden_at: new Date().toISOString(), hidden_reason: 'trimmed' }, { id: n.id }, `hide ${slug}`);
  return 'done';
}

async function createOne(ctx: Ctx, c: TaxPlan['creates'][number]): Promise<Outcome> {
  const cats = await loadCats(ctx.sb);
  const aliases = await loadAliases(ctx.sb);
  if (bySlug(cats).has(c.slug)) return 'skipped';
  if (aliases.some((a) => a.old_slug === c.slug)) throw new Error(`slug ${c.slug} is an alias`);
  if (ctx.dry && ctx.dryCreated.has(c.parent)) {
    ctx.dryCreated.add(c.slug);
    return 'done';
  }
  const parent = resolveLiveTarget(cats, aliases, c.parent);
  if (isGkOrUnder(cats, parent.id)) throw new Error(GK_REFUSAL);
  if (parent.depth >= MAX_DEPTH) throw new Error(`parent ${c.parent} is at max depth ${MAX_DEPTH}`);
  if (ctx.dry) {
    ctx.dryCreated.add(c.slug);
    return 'done';
  }
  const existing = await findChange(ctx, 'create', (p) => p.slug === c.slug);
  const id = (existing?.payload.id as string | undefined) ?? randomUUID();
  if (!existing) await newChange(ctx, 'create', { slug: c.slug, name: c.name, parent: parent.slug, id }, null);
  await insertRows(
    ctx,
    'categories',
    { id, slug: c.slug, name: c.name, parent_id: parent.id, depth: parent.depth + 1, created_by: 'stage2', hidden_at: null },
    `create ${c.slug}`,
  );
  return 'done';
}

async function rehomeOne(ctx: Ctx, r: TaxPlan['rehomes'][number]): Promise<Outcome> {
  const cats = await loadCats(ctx.sb);
  const aliases = await loadAliases(ctx.sb);
  const F = resolveSlug(cats, aliases, r.from);
  if (!F) throw new Error(`unknown from ${r.from}`);
  if (isGkOrUnder(cats, F.id)) throw new Error(GK_REFUSAL);
  if (isProtectedOrUnder(cats, F.id)) throw new Error(`protected category ${r.from}`);
  let T: Cat;
  if (ctx.dry && ctx.dryCreated.has(r.to)) {
    T = F; // placeholder: the dry run never reads it
  } else {
    T = resolveLiveTarget(cats, aliases, r.to);
    if (isGkOrUnder(cats, T.id)) throw new Error(GK_REFUSAL);
  }
  if (!ctx.dry && T.id === F.id) throw new Error('from and to resolve to the same category');

  const qlinks = await linksOfQuestions(ctx.sb, [r.questionId]);
  const fromLink = qlinks.find((l) => l.category_id === F.id);
  const toLink = qlinks.find((l) => l.category_id === T.id);
  const existing = ctx.dry
    ? null
    : await findChange(ctx, 'rehome', (p) => p.questionId === r.questionId && p.from === r.from && p.to === r.to);
  // NOTE: with a logged row and the link already at the target we still run moveQuestion: a crash right after the
  // link move leaves the chain repair undone, and that repair is what the resume must finish. moveQuestion drops
  // leaves merged away since the snapshot, so a stale snapshot cannot re-link a merged category.
  if (!fromLink && !existing) {
    if (toLink && !ctx.dry) return 'skipped';
    throw new Error(`question ${r.questionId} is not linked to ${r.from}`);
  }
  // A logged rehome whose question is now linked to neither end has since been moved elsewhere (a later run):
  // replaying the stale snapshot would re-link `to` (and call the calibrator), so it is complete as is.
  if (existing && !fromLink && !toLink) return 'skipped';
  if (ctx.dry) return 'done';

  const gk = gkIdOf(cats);
  let row = existing;
  if (!row) {
    const snaps = await snapshotQuestions(ctx, cats, [r.questionId], gk);
    row = await newChange(
      ctx,
      'rehome',
      { questionId: r.questionId, from: r.from, to: r.to, fromId: F.id, toId: T.id },
      { questions: snaps },
    );
  }
  const snap = (row.prior as unknown as { questions: Record<string, QSnap> }).questions[r.questionId];
  const before = ctx.writes;
  await moveQuestion(ctx, r.questionId, snap, F.id, T.id, cats, new Set(), gk);
  return ctx.writes > before ? 'done' : 'skipped';
}

async function flagOne(ctx: Ctx, d: TaxPlan['duplicates'][number]): Promise<Outcome> {
  const existing = ctx.dry ? null : await findChange(ctx, 'flag_duplicate', (p) => p.keep === d.keep && p.flag === d.flag);
  if (existing) return 'skipped';
  if (!ctx.dry) await newChange(ctx, 'flag_duplicate', { keep: d.keep, flag: d.flag, why: d.why }, null);
  return 'done';
}

export async function applyPlan(
  supabase: TypedSupabaseClient,
  _tree: TaxTree,
  plan: TaxPlan,
  opts: ApplyOpts,
): Promise<ApplySummary> {
  const summary: ApplySummary = {
    merged: 0,
    hidden: 0,
    created: [],
    rehomed: 0,
    flagged: 0,
    skippedAlreadyDone: 0,
    errors: [],
  };
  const ctx: Ctx = {
    sb: loose(supabase),
    raw: supabase,
    runId: opts.runId,
    call: opts.call,
    config: opts.config,
    dry: opts.dryRun,
    summary,
    writes: 0,
    dryCreated: new Set(),
  };

  const run = async (label: string, fn: () => Promise<Outcome>, onDone: () => void): Promise<void> => {
    try {
      const o = await fn();
      if (o === 'skipped') summary.skippedAlreadyDone++;
      else onDone();
    } catch (err) {
      // Usage stops must end the whole run, not become one more per-action error.
      if (err instanceof Error && err.name === 'UsageStopError') throw err;
      const msg = `${label}: ${err instanceof Error ? err.message : String(err)}`;
      addError(summary, msg);
      log('warn', 'taxonomy apply action failed', { label, error: msg });
    }
  };

  for (const mg of plan.merges) {
    for (const absorbed of mg.absorbed) {
      await run(`merge ${absorbed} -> ${mg.survivor}`, () => mergeOne(ctx, mg.survivor, absorbed, mg.why), () => summary.merged++);
    }
  }
  for (const h of plan.hides) {
    await run(`hide ${h.slug}`, () => hideOne(ctx, h.slug), () => summary.hidden++);
  }
  for (const c of plan.creates) {
    await run(`create ${c.slug}`, () => createOne(ctx, c), () => summary.created.push(c.slug));
  }
  for (const r of plan.rehomes) {
    await run(`rehome ${r.questionId} ${r.from} -> ${r.to}`, () => rehomeOne(ctx, r), () => summary.rehomed++);
  }
  for (const d of plan.duplicates) {
    await run(`flag ${d.keep}/${d.flag}`, () => flagOne(ctx, d), () => summary.flagged++);
  }
  return summary;
}

// ---- manual controls ----

export async function setHidden(
  supabase: TypedSupabaseClient,
  slug: string,
  reason: 'trimmed' | 'veto' | null,
  runId: string,
): Promise<void> {
  const sb = loose(supabase);
  const ctx = { sb, runId, writes: 0 } as unknown as Ctx;
  const cats = await loadCats(sb);
  const n = bySlug(cats).get(slug);
  if (!n) throw new Error(`unknown slug ${slug}`);
  // Unhiding GK stays allowed (it is the repair); hiding it would stop all question generation.
  if (reason && isGkOrUnder(cats, n.id)) throw new Error(`${GK_REFUSAL}; refusing to hide ${slug}`);
  await newChange(ctx, reason ? 'hide' : 'unhide', { slug, reason }, { id: n.id, hidden_at: n.hidden_at, hidden_reason: n.hidden_reason });
  await updateRows(
    ctx,
    'categories',
    reason ? { hidden_at: new Date().toISOString(), hidden_reason: reason } : { hidden_at: null, hidden_reason: null },
    { id: n.id },
    `set hidden ${slug}`,
  );
}

export async function setProtected(supabase: TypedSupabaseClient, slug: string, on: boolean, runId: string): Promise<void> {
  const sb = loose(supabase);
  const ctx = { sb, runId, writes: 0 } as unknown as Ctx;
  const cats = await loadCats(sb);
  const n = bySlug(cats).get(slug);
  if (!n) throw new Error(`unknown slug ${slug}`);
  await newChange(ctx, 'protect', { slug, on }, { id: n.id, protected: n.protected });
  await updateRows(ctx, 'categories', { protected: on }, { id: n.id }, `set protected ${slug}`);
}

// ---- undo ----

async function restoreQuestion(ctx: Ctx, qid: string, snap: QSnap): Promise<void> {
  const snapIds = new Set(snap.links.map((l) => l.category_id));
  const cur = await linksOfQuestions(ctx.sb, [qid]);
  // Delete extras first so the restored set never exceeds the per-question cap.
  for (const l of cur) {
    if (!snapIds.has(l.category_id)) {
      await deleteRows(ctx, 'question_categories', { question_id: qid, category_id: l.category_id }, `undo delete ${qid}`);
    }
  }
  if (snap.links.length) {
    await upsertRows(ctx, 'question_categories', snap.links, 'question_id,category_id', `undo restore ${qid}`);
  }
}

async function undoOne(ctx: Ctx, action: Action, payload: Record<string, unknown>, prior: Record<string, unknown> | null): Promise<boolean> {
  switch (action) {
    case 'flag_duplicate':
      return true;
    case 'hide':
    case 'unhide': {
      const p = prior as { id: string; hidden_at: string | null; hidden_reason: string | null };
      await updateRows(ctx, 'categories', { hidden_at: p.hidden_at, hidden_reason: p.hidden_reason }, { id: p.id }, 'undo hide');
      return true;
    }
    case 'protect': {
      const p = prior as { id: string; protected: boolean };
      await updateRows(ctx, 'categories', { protected: p.protected }, { id: p.id }, 'undo protect');
      return true;
    }
    case 'create': {
      const id = payload.id as string;
      const cats = await loadCats(ctx.sb);
      const node = byId(cats).get(id);
      if (!node) return true; // never created, or already gone
      const hasKids = cats.some((c) => c.parent_id === id);
      const hasLinks = (await linksOfCategory(ctx.sb, id)).length > 0;
      if (hasKids || hasLinks) {
        log('warn', 'taxonomy undo: created category still in use, left in place', { slug: node.slug });
        return false;
      }
      await deleteRows(ctx, 'category_aliases', { category_id: id }, 'undo create aliases');
      await deleteRows(ctx, 'categories', { id }, `undo create ${node.slug}`);
      return true;
    }
    case 'rehome': {
      const qs = (prior as { questions: Record<string, QSnap> }).questions;
      for (const [qid, snap] of Object.entries(qs)) await restoreQuestion(ctx, qid, snap);
      return true;
    }
    case 'merge': {
      const p = prior as unknown as {
        survivorId: string;
        category: { id: string; hidden_at: string | null; hidden_reason: string | null };
        children: { id: string; parent_id: string | null; depth: number; subtree: { id: string; depth: number }[] }[];
        aliasForAbsorbed: AliasRow | null;
        repointed: AliasRow[];
        questions: Record<string, QSnap>;
      };
      for (const [qid, snap] of Object.entries(p.questions)) await restoreQuestion(ctx, qid, snap);
      for (const c of p.children) {
        await updateRows(ctx, 'categories', { parent_id: c.parent_id, depth: c.depth }, { id: c.id }, 'undo reparent');
        for (const n of c.subtree) {
          if (n.id !== c.id) await updateRows(ctx, 'categories', { depth: n.depth }, { id: n.id }, 'undo re-depth');
        }
      }
      const slug = payload.absorbed as string;
      await deleteRows(ctx, 'category_aliases', { old_slug: slug }, 'undo alias');
      if (p.aliasForAbsorbed) {
        await upsertRows(ctx, 'category_aliases', p.aliasForAbsorbed, 'old_slug', 'undo alias restore');
      }
      for (const a of p.repointed) {
        await updateRows(ctx, 'category_aliases', { category_id: a.category_id }, { old_slug: a.old_slug }, 'undo repoint');
      }
      await updateRows(
        ctx,
        'categories',
        { hidden_at: p.category.hidden_at, hidden_reason: p.category.hidden_reason },
        { id: p.category.id },
        'undo hide absorbed',
      );
      return true;
    }
  }
}

/**
 * Undo every not-yet-undone change of a run, newest first. Each row is marked `undone_at` only after
 * its effects are reverted, so an interrupted undo re-runs safely and a second undo is a no-op.
 */
export async function undoRun(supabase: TypedSupabaseClient, runId: string): Promise<{ undone: number; blocked: number }> {
  const sb = loose(supabase);
  const ctx = { sb, runId, writes: 0 } as unknown as Ctx;
  const rows = await pageAll<{ id: number; action: Action; payload: Record<string, unknown>; prior: Record<string, unknown> | null }>(
    (f, t) =>
      sb
        .from('category_changes')
        .select('id, action, payload, prior')
        .eq('run_id', runId)
        .is('undone_at', null)
        .order('id', { ascending: false })
        .range(f, t),
    'load changes',
  );
  let undone = 0;
  let blocked = 0;
  for (const r of rows) {
    const ok = await undoOne(ctx, r.action, r.payload ?? {}, r.prior);
    if (!ok) {
      blocked++;
      continue;
    }
    await updateRows(ctx, 'category_changes', { undone_at: new Date().toISOString() }, { id: r.id }, 'mark undone');
    undone++;
  }
  return { undone, blocked };
}
