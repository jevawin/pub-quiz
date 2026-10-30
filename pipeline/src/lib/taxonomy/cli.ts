import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type PipelineConfig } from '../config.js';
import { callClaude, ClaudeCallError } from '../claude-cli.js';
import { callGoverned, createTokenAccumulator, type ClaudeCaller } from '../claude.js';
import { log } from '../logger.js';
import { createSupabaseClient, type TypedSupabaseClient } from '../supabase.js';
import {
  governorConfigFromEnv,
  nightBudgetPoints,
  UsageGovernor,
  UsageStopError,
  type RateLimitInfo,
} from '../usage.js';
import { applyPlan, setHidden, setProtected, undoRun, type ApplySummary } from './apply.js';
import { assessSubtree, chunkQuestions, classifyQuestions } from './assess.js';
import { buildReport, REPORT_MAX_CHARS, stripControl } from './report.js';
import { GENERAL_KNOWLEDGE_SLUG } from '../general-knowledge-guard.js';
import { confineToSubtree, isGeneralKnowledgeOrUnder, validatePlan } from './rules.js';
import { directCounts, leafQuestionIds, pickRehomeCategories, pickWeeklyRoots, type LinkRow } from './select.js';
import { loadState, saveState, type TaxState } from './state.js';
import { loadTree, subtreeSlugs } from './tree.js';
import { addFlag, removeFlags, removeVetoFlags, VETO_NOTE_PREFIX } from './flags.js';
import { MIN_VISIBLE_QUESTIONS, TaxPlanSchema } from './types.js';
import type { Rejection, TaxNode, TaxPlan, TaxTree } from './types.js';

// ---- exit codes ----
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_REFUSED = 2; // bad usage, or the kill switch is off
export const EXIT_WINDOW = 3; // inside the nightly generator's window (or a Monday for weekly)

export type Mode = 'plan' | 'apply' | 'weekly' | 'undo' | 'hide' | 'unhide' | 'protect' | 'flag' | 'unflag';
const WRITING_MODES: ReadonlySet<Mode> = new Set(['apply', 'weekly', 'undo', 'hide', 'unhide', 'protect', 'flag', 'unflag']);
const ALL_MODES: readonly Mode[] = ['plan', 'apply', 'weekly', 'undo', 'hide', 'unhide', 'protect', 'flag', 'unflag'];

const VALUE_FLAGS: Record<Mode, string[]> = {
  plan: ['out', 'md', 'roots'],
  apply: ['plan', 'backup-dir', 'report', 'run-id'],
  weekly: ['report', 'run-id'],
  undo: ['run'],
  hide: ['slug', 'reason'],
  unhide: ['slug'],
  protect: ['slug'],
  flag: ['name', 'slug', 'note'],
  unflag: ['name', 'slug'],
};
const BOOL_FLAGS: Record<Mode, string[]> = { plan: [], apply: ['dry-run'], weekly: [], undo: [], hide: [], unhide: [], protect: ['off'], flag: [], unflag: [] };

export interface ParsedArgs {
  mode: Mode;
  flags: Record<string, string | true>;
}

export function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  const [m, ...rest] = argv;
  if (!m || !(ALL_MODES as readonly string[]).includes(m)) {
    return { error: `usage: taxonomy <${ALL_MODES.join('|')}> [flags]` };
  }
  const mode = m as Mode;
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) return { error: `unexpected argument: ${a}` };
    const name = a.slice(2);
    if (BOOL_FLAGS[mode].includes(name)) flags[name] = true;
    else if (VALUE_FLAGS[mode].includes(name)) {
      const v = rest[++i];
      if (v === undefined || v.startsWith('--')) return { error: `--${name} needs a value` };
      flags[name] = v;
    } else return { error: `unknown flag for ${mode}: ${a}` };
  }
  const need: Partial<Record<Mode, string[]>> = {
    plan: ['out'],
    apply: flags['dry-run'] === true ? ['plan'] : ['plan', 'backup-dir'],
    undo: ['run'],
    hide: ['slug'],
    unhide: ['slug'],
    protect: ['slug'],
  };
  for (const f of need[mode] ?? []) if (flags[f] === undefined) return { error: `${mode} requires --${f}` };
  if ((mode === 'flag' || mode === 'unflag') && flags.name === undefined && flags.slug === undefined) {
    return { error: `${mode} requires --name or --slug` };
  }
  const rid = flags['run-id'];
  if (rid !== undefined && !/^[A-Za-z0-9._-]{1,80}$/.test(String(rid))) return { error: '--run-id must be 1-80 chars of A-Z a-z 0-9 . _ -' };
  if (flags.reason !== undefined && flags.reason !== 'veto' && flags.reason !== 'trimmed') {
    return { error: '--reason must be veto or trimmed' };
  }
  return { mode, flags };
}

// ---- time gates ----
function londonParts(d: Date): { weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return { weekday: get('weekday'), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** The nightly generator's window, 00:40 to 06:40 Europe/London (start inclusive, end exclusive). */
export function inGeneratorWindow(d: Date): boolean {
  const { minutes } = londonParts(d);
  return minutes >= 40 && minutes < 6 * 60 + 40;
}

export interface Refusal {
  code: number;
  message: string;
}

export function checkGates(
  mode: Mode,
  env: Record<string, string | undefined>,
  now: Date,
  opts: { dryRun?: boolean } = {},
): Refusal | null {
  // `apply --dry-run` performs no DB write, no backup write and no model call, so neither the kill switch nor the
  // generator window applies to it.
  if (mode === 'apply' && opts.dryRun) return null;
  if (WRITING_MODES.has(mode) && env.ENABLE_TAXONOMY !== '1') {
    return { code: EXIT_REFUSED, message: `refusing '${mode}': it writes to the database and ENABLE_TAXONOMY=1 is not set` };
  }
  if (mode === 'weekly' && !env.TAXONOMY_STATE_FILE) {
    return { code: EXIT_REFUSED, message: "refusing 'weekly': TAXONOMY_STATE_FILE must name the rotation state file (outside the repo checkout)" };
  }
  if ((mode === 'apply' || mode === 'weekly' || mode === 'undo') && env.TAXONOMY_ALLOW_WINDOW !== '1') {
    if (inGeneratorWindow(now)) {
      return {
        code: EXIT_WINDOW,
        message: `refusing '${mode}': 00:40-06:40 Europe/London is the nightly generator's window (set TAXONOMY_ALLOW_WINDOW=1 to override deliberately)`,
      };
    }
    if (mode === 'weekly' && londonParts(now).weekday === 'Monday') {
      return {
        code: EXIT_WINDOW,
        message: "refusing 'weekly' on a Monday (set TAXONOMY_ALLOW_WINDOW=1 to override deliberately)",
      };
    }
  }
  return null;
}

// ---- plan file (untrusted on disk) ----
const PLAN_FILE_MAX_BYTES = 5_000_000;
const PLAN_KEYS = ['merges', 'hides', 'creates', 'rehomes', 'duplicates'];

export function readPlanFile(path: string): TaxPlan {
  const st = statSync(path);
  if (!st.isFile() || st.size > PLAN_FILE_MAX_BYTES) throw new Error('plan file is not a regular file under 5 MB');
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`plan file is not valid JSON: ${(e as Error).message.slice(0, 120)}`);
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error('plan file must be a JSON object');
  const keys = Object.keys(json);
  const extra = keys.filter((k) => !PLAN_KEYS.includes(k));
  if (extra.length || keys.length === 0) throw new Error(`plan file must hold only the plan keys (${PLAN_KEYS.join(', ')})`);
  const parsed = TaxPlanSchema.safeParse(json);
  if (!parsed.success) throw new Error(`plan file failed validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  return parsed.data;
}

// ---- backup ----
const PAGE = 1000;
const BACKUP_TABLES: { table: string; order: string[] }[] = [
  { table: 'categories', order: ['id'] },
  { table: 'question_categories', order: ['question_id', 'category_id'] },
  { table: 'category_aliases', order: ['old_slug'] },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = { from: (table: string) => any };
const loose = (s: TypedSupabaseClient): Loose => s as unknown as Loose;

// PAGE = 1000 = the live PostgREST max-rows (MEASURED 2026-10-27, see apply.ts pageAll); a lower max-rows would silently truncate.
async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`${what}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

/** Exports the three taxonomy tables (paged, stable order), checks each against an exact DB count, writes the file, re-reads it and checks again. Throws on any mismatch, before any taxonomy write. */
export async function exportBackup(
  supabase: TypedSupabaseClient,
  dir: string,
  runId: string,
  now: Date,
): Promise<{ file: string; counts: Record<string, number>; bytes: number }> {
  const sb = loose(supabase);
  const tables: Record<string, unknown[]> = {};
  for (const { table, order } of BACKUP_TABLES) {
    tables[table] = await pageAll<unknown>((f, t) => {
      let q = sb.from(table).select('*');
      for (const o of order) q = q.order(o, { ascending: true });
      return q.range(f, t);
    }, `backup ${table}`);
    const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true });
    if (error) throw new Error(`backup count ${table}: ${error.message}`);
    if (typeof count !== 'number' || count !== tables[table].length) {
      throw new Error(`backup export of ${table} read ${tables[table].length} rows but the database reports ${String(count)}; refusing to continue`);
    }
  }
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  if (!counts.categories) throw new Error('backup export read zero categories; refusing to continue');
  const body = JSON.stringify({ runId, exportedAt: now.toISOString(), counts, tables });
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
  const file = join(resolve(dir), `taxonomy-backup-${runId}-${stamp}.json`);
  writeFileSync(file, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  const bytes = statSync(file).size;
  if (bytes === 0 || bytes !== Buffer.byteLength(body)) throw new Error('backup file size mismatch after write');
  const back = JSON.parse(readFileSync(file, 'utf8')) as { tables?: Record<string, unknown[]> };
  for (const [k, n] of Object.entries(counts)) {
    if (back.tables?.[k]?.length !== n) throw new Error(`backup verification failed for ${k}`);
  }
  return { file, counts, bytes };
}

/** Hash of the plan file's raw bytes: the deterministic part of an apply run id. */
export function planFileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 10);
}

/** ISO year-week run id for the weekly review, e.g. weekly-2026-W44. */
export function weeklyRunId(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3); // Thursday of this ISO week
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - first.getTime()) / 86_400_000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `weekly-${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Resolve symlinks through the nearest EXISTING parent, so a not-yet-created path under a symlinked dir is judged by where it really lands. */
function realish(p: string): string {
  let cur = resolve(p);
  const tail: string[] = [];
  while (!existsSync(cur) && dirname(cur) !== cur) {
    tail.unshift(basename(cur));
    cur = dirname(cur);
  }
  let real = cur;
  try {
    real = realpathSync(cur);
  } catch {
    /* keep the lexical path */
  }
  return join(real, ...tail);
}

export function insideRepo(p: string, root: string = REPO_ROOT): boolean {
  const rel = relative(realish(root), realish(p));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Weekly review budget in points: share x a night's budget, but never below 3 (a 10% slice of a modest night is
 * too small to finish one assessment) and never above one whole night. The job only skips when the NIGHT budget
 * itself is under 3 points.
 */
export const WEEKLY_MIN_NIGHT_POINTS = 3;
export function weeklyBudgetPoints(nightPoints: number, share: number): number {
  const slice = Math.round(nightPoints * share * 100) / 100;
  return Math.min(nightPoints, Math.max(slice, WEEKLY_MIN_NIGHT_POINTS));
}

/**
 * Governor environment. apply/weekly must never reach the generator's 00:40 window, so the deadline is
 * 00:35 (unless deliberately overridden). Manual runs may start at any hour, so RUN_MAX_HOURS defaults to 24.
 */
export function governorEnv(mode: Mode, env: Record<string, string | undefined>): Record<string, string | undefined> {
  const g = { ...env };
  if (!g.RUN_MAX_HOURS) g.RUN_MAX_HOURS = '24';
  if ((mode === 'apply' || mode === 'weekly') && env.TAXONOMY_ALLOW_WINDOW !== '1') g.RUN_DEADLINE_LOCAL = '00:35';
  return g;
}

// ---- helpers ----
export interface CliDeps {
  now?: () => Date;
  out?: (line: string) => void;
  err?: (line: string) => void;
  createSupabase?: (url: string, key: string) => TypedSupabaseClient;
  probe?: () => Promise<RateLimitInfo | null>;
  writeFile?: (path: string, text: string) => void;
}

async function defaultProbe(): Promise<RateLimitInfo | null> {
  try {
    return (await callClaude({ model: 'haiku', system: 'Reply with the single word ok.', prompt: 'ok' })).rateLimit;
  } catch (e) {
    return e instanceof ClaudeCallError ? e.rateLimit : null;
  }
}

const visibleSet = (tree: TaxTree): Set<string> =>
  new Set([...tree.byId.values()].filter((n) => !n.hidden && n.distinctPublished >= MIN_VISIBLE_QUESTIONS).map((n) => n.id));

const emptySummary = (): ApplySummary => ({ merged: 0, hidden: 0, created: [], rehomed: 0, flagged: 0, skippedAlreadyDone: 0, errors: [] });

const isOverrideNote = (r: Rejection): boolean => r.reason.startsWith('survivor overridden');

export interface RunRow {
  id: number;
  action: string;
  payload: Record<string, unknown>;
}

/** Every not-yet-undone change row logged under a run id. */
async function loadRunRows(supabase: TypedSupabaseClient, runId: string): Promise<RunRow[]> {
  const rows = await pageAll<{ id: number; action: string; payload: Record<string, unknown> | null }>(
    (f, t) =>
      loose(supabase).from('category_changes').select('id, action, payload').eq('run_id', runId).is('undone_at', null).order('id', { ascending: true }).range(f, t),
    'load run log',
  );
  return rows.map((r) => ({ id: r.id, action: r.action, payload: r.payload ?? {} }));
}

/**
 * Slugs that Jamie manually unhid AFTER this run hid them (a hide row, or a merge row whose absorbed node was hidden):
 * a later `unhide` row, under ANY run id, wins. A replay must not undo that.
 */
async function manuallyUnhidden(supabase: TypedSupabaseClient, rows: RunRow[]): Promise<Set<string>> {
  const unhides = await pageAll<{ id: number; payload: Record<string, unknown> | null }>(
    (f, t) =>
      loose(supabase).from('category_changes').select('id, payload').eq('action', 'unhide').is('undone_at', null).order('id', { ascending: true }).range(f, t),
    'load unhide log',
  );
  const out = new Set<string>();
  for (const r of rows) {
    const slug = r.action === 'hide' ? r.payload.slug : r.action === 'merge' ? r.payload.absorbed : undefined;
    if (typeof slug !== 'string') continue;
    if (unhides.some((u) => u.id > r.id && u.payload?.slug === slug)) out.add(slug);
  }
  return out;
}

const STRUCTURE_ACTIONS = new Set(['merge', 'hide', 'create', 'rehome', 'flag_duplicate']);

interface LoggedRun {
  summary: ApplySummary;
  completeMerges: number;
  partialMerges: number;
}

/**
 * The whole run as the change log sees it (so a resumed run reports everything done under its id).
 * A merge counts as merged only when its absorbed node is hidden as 'merged'; otherwise it is partial.
 */
async function summaryFromLog(supabase: TypedSupabaseClient, runId: string, errors: string[]): Promise<LoggedRun> {
  const rows = await loadRunRows(supabase, runId);
  const skip = await manuallyUnhidden(supabase, rows);
  const tree = await loadTree(supabase);
  // A change row is written BEFORE its effect, so a row alone does not prove the action happened: each action is
  // counted only when its effect is present in the live DB; the rest are reported as logged-but-not-applied.
  const rehomeQids = [...new Set(rows.filter((r) => r.action === 'rehome' && typeof r.payload.questionId === 'string').map((r) => String(r.payload.questionId)))];
  const qLinks = new Set<string>();
  for (let i = 0; i < rehomeQids.length; i += 100) {
    const chunk = rehomeQids.slice(i, i + 100);
    const ls = await pageAll<LinkRow>(
      (f, t) => loose(supabase).from('question_categories').select('question_id, category_id').in('question_id', chunk).order('question_id', { ascending: true }).order('category_id', { ascending: true }).range(f, t),
      'load re-homed question links',
    );
    for (const l of ls) qLinks.add(`${l.question_id}|${l.category_id}`);
  }
  const s = emptySummary();
  s.errors = [...errors];
  const na = { hidden: 0, created: 0, rehomed: 0 };
  let partial = 0;
  for (const r of rows) {
    if ((r.action === 'hide' && skip.has(String(r.payload.slug))) || (r.action === 'merge' && skip.has(String(r.payload.absorbed)))) continue;
    if (r.action === 'merge') {
      const a = typeof r.payload.absorbed === 'string' ? tree.bySlug.get(r.payload.absorbed) : undefined;
      if (a?.hidden && a.hiddenReason === 'merged') s.merged++;
      else partial++;
    } else if (r.action === 'hide') {
      const n = typeof r.payload.slug === 'string' ? tree.bySlug.get(r.payload.slug) : undefined;
      if (n?.hidden) s.hidden++;
      else na.hidden++;
    } else if (r.action === 'create' && typeof r.payload.slug === 'string') {
      const present = typeof r.payload.id === 'string' ? tree.byId.has(r.payload.id) : tree.bySlug.has(r.payload.slug);
      if (present) s.created.push(r.payload.slug);
      else na.created++;
    } else if (r.action === 'rehome') {
      const q = String(r.payload.questionId);
      const toId = typeof r.payload.toId === 'string' ? r.payload.toId : undefined;
      const fromId = typeof r.payload.fromId === 'string' ? r.payload.fromId : undefined;
      const to = toId ? tree.byId.get(toId) : undefined;
      // Present: the question sits in `to`; or `to` has since been merged away and the question has left `from`.
      const present = !toId || qLinks.has(`${q}|${toId}`) || (!!to?.hidden && to.hiddenReason === 'merged' && !!fromId && !qLinks.has(`${q}|${fromId}`));
      if (present) s.rehomed++;
      else na.rehomed++;
    } else if (r.action === 'flag_duplicate') s.flagged++;
  }
  if (na.hidden + na.created + na.rehomed) s.notApplied = na;
  return { summary: s, completeMerges: s.merged, partialMerges: partial };
}

/**
 * Everything logged under the run id, as plans in LOG ORDER (consecutive rows of one kind share a batch, since
 * order cannot matter inside a kind). Unvalidated: it passed validation when first logged. `skip` slugs (manually
 * unhidden since) are left out.
 */
export function replayBatches(rows: RunRow[], skip: Set<string>): TaxPlan[] {
  const out: TaxPlan[] = [];
  let lastAction = '';
  const str = (v: unknown): v is string => typeof v === 'string';
  for (const { action, payload: p } of rows) {
    const plan: TaxPlan = { merges: [], hides: [], creates: [], rehomes: [], duplicates: [] };
    if (action === 'merge' && str(p.survivor) && str(p.absorbed) && !skip.has(p.absorbed)) plan.merges.push({ survivor: p.survivor, absorbed: [p.absorbed], why: str(p.why) ? p.why : '' });
    else if (action === 'hide' && str(p.slug) && !skip.has(p.slug)) plan.hides.push({ slug: p.slug, why: '' });
    else if (action === 'create' && str(p.slug) && str(p.name) && str(p.parent)) plan.creates.push({ slug: p.slug, name: p.name, parent: p.parent, why: '' });
    else if (action === 'rehome' && str(p.questionId) && str(p.from) && str(p.to)) plan.rehomes.push({ questionId: p.questionId, from: p.from, to: p.to });
    else if (action === 'flag_duplicate' && str(p.keep) && str(p.flag)) plan.duplicates.push({ keep: p.keep, flag: p.flag, why: str(p.why) ? p.why : '' });
    else continue;
    const prev = out[out.length - 1];
    if (prev && lastAction === action) {
      prev.merges.push(...plan.merges);
      prev.hides.push(...plan.hides);
      prev.creates.push(...plan.creates);
      prev.rehomes.push(...plan.rehomes);
      prev.duplicates.push(...plan.duplicates);
    } else out.push(plan);
    lastAction = action;
  }
  return out;
}

/**
 * Merges already logged under this run id are PINNED to the logged survivor (a partial merge changes the counts
 * the survivor rule reads, so re-validating could flip it and double-apply). A plan merge touching a logged pair
 * is replaced by the pinned form; the rest go through validation.
 */
function pinMerges(rows: RunRow[], merges: TaxPlan['merges'], tree: TaxTree): { pinned: TaxPlan['merges']; rest: TaxPlan['merges'] } {
  const logged = rows
    .filter((r) => r.action === 'merge')
    .map((r) => r.payload)
    .filter((p) => typeof p.survivor === 'string' && typeof p.absorbed === 'string') as { survivor: string; absorbed: string }[];
  if (!logged.length) return { pinned: [], rest: merges };
  const pinned: TaxPlan['merges'] = [];
  const rest: TaxPlan['merges'] = [];
  for (const m of merges) {
    const slugs = [m.survivor, ...m.absorbed];
    const hit = logged.find((l) => slugs.includes(l.survivor) || slugs.includes(l.absorbed));
    if (!hit) {
      rest.push(m);
      continue;
    }
    const absorbed = [...new Set(slugs.filter((s) => s !== hit.survivor && tree.bySlug.has(s)))];
    if (tree.bySlug.has(hit.survivor) && absorbed.length) pinned.push({ survivor: hit.survivor, absorbed, why: m.why });
  }
  return { pinned, rest };
}

const newRunId = (mode: string, now: Date): string => `${mode}-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8)}`;

const mdEscape = (s: string): string => stripControl(s).replace(/[|`]/g, ' ').slice(0, 300);

function planMarkdown(plan: TaxPlan, rejected: Rejection[], notes: string[]): string {
  const L: string[] = ['# Taxonomy plan', ''];
  for (const n of notes) L.push(`> ${mdEscape(n)}`);
  const overrides = rejected.filter(isOverrideNote);
  const real = rejected.filter((r) => !isOverrideNote(r));
  L.push('', '## Accepted', '');
  for (const m of plan.merges) L.push(`- MERGE ${mdEscape(m.absorbed.join(', '))} into ${mdEscape(m.survivor)}: ${mdEscape(m.why)}`);
  for (const h of plan.hides) L.push(`- HIDE ${mdEscape(h.slug)}: ${mdEscape(h.why)}`);
  for (const c of plan.creates) L.push(`- CREATE ${mdEscape(c.name)} (${mdEscape(c.slug)}) under ${mdEscape(c.parent)}: ${mdEscape(c.why)}`);
  if (overrides.length) {
    L.push('', '## Notes', '');
    for (const r of overrides) L.push(`- ${mdEscape(r.reason)}`);
  }
  L.push('', `## Rejected (${real.length})`, '');
  for (const r of real) L.push(`- ${r.kind}: ${mdEscape(JSON.stringify(r.item))} (${mdEscape(r.reason)})`);
  return L.join('\n') + '\n';
}

const CANDIDATE_CAP = 150;

/** Candidates for a re-home: the category's children plus the category itself (non-hidden). */
function candidatesFor(tree: TaxTree, slug: string): TaxNode[] {
  const node = tree.bySlug.get(slug);
  if (!node || isGeneralKnowledgeOrUnder(tree, slug)) return [];
  const kids = node.childIds.map((id) => tree.byId.get(id)).filter((k): k is TaxNode => !!k && !k.hidden && !isGeneralKnowledgeOrUnder(tree, k.slug));
  return [node, ...kids]
    .sort((a, b) => b.distinctPublished - a.distinctPublished || (a.slug < b.slug ? -1 : 1))
    .slice(0, CANDIDATE_CAP);
}

/** All links of PUBLISHED questions (two plain queries, intersected in memory). */
async function loadPublishedLinks(supabase: TypedSupabaseClient): Promise<LinkRow[]> {
  const sb = loose(supabase);
  const links = await pageAll<LinkRow>(
    (f, t) => sb.from('question_categories').select('question_id, category_id').order('question_id', { ascending: true }).order('category_id', { ascending: true }).range(f, t),
    'load question links',
  );
  const pub = await pageAll<{ id: string }>(
    (f, t) => sb.from('questions').select('id').eq('status', 'published').order('id', { ascending: true }).range(f, t),
    'load published question ids',
  );
  const ok = new Set(pub.map((p) => p.id));
  return links.filter((l) => ok.has(l.question_id));
}

interface QRow {
  id: string;
  text: string;
  answer: string;
  currentSlug: string;
}

async function loadQuestionRows(supabase: TypedSupabaseClient, ids: string[], currentSlug: string): Promise<QRow[]> {
  const sb = loose(supabase);
  const out: QRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from('questions').select('id, question_text, correct_answer').in('id', ids.slice(i, i + 100));
    if (error) throw new Error(`load questions of ${currentSlug}: ${error.message}`);
    for (const q of (data ?? []) as { id: string; question_text: string; correct_answer: string }[]) {
      out.push({ id: q.id, text: q.question_text, answer: q.correct_answer, currentSlug });
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

interface CatResult {
  slug: string;
  rehomeIds: Set<string>;
  flagIds: Set<string>;
}
interface Classified {
  rehomes: TaxPlan['rehomes'];
  duplicates: TaxPlan['duplicates'];
  allowed: Set<string>;
  /** Categories whose classification ran to the end (not cut short by the action cap). */
  done: CatResult[];
  /** Every category classified (done or capped), in order: used to apply and attribute errors per category. */
  all: (CatResult & { capped: boolean })[];
}

/**
 * Classify the questions whose LEAF is each category (currentSlug = that category). Stops, without listing the
 * category as done, once the proposed actions reach `capLeft`. Throws UsageStopError on a budget stop.
 */
async function classifyCategories(
  supabase: TypedSupabaseClient,
  tree: TaxTree,
  slugs: string[],
  links: LinkRow[],
  call: ClaudeCaller,
  model: string,
  capLeft: number,
): Promise<Classified> {
  const res: Classified = { rehomes: [], duplicates: [], allowed: new Set(), done: [], all: [] };
  let used = 0;
  for (const slug of slugs) {
    if (used >= capLeft) break;
    const node = tree.bySlug.get(slug);
    if (!node) continue;
    const qs = await loadQuestionRows(supabase, leafQuestionIds(tree, node.id, links), slug);
    const cands = candidatesFor(tree, slug);
    for (const q of qs) res.allowed.add(q.id);
    const mine: CatResult = { slug, rehomeIds: new Set(), flagIds: new Set() };
    let capped = false;
    for (const batch of chunkQuestions(qs)) {
      const r = await classifyQuestions(cands, batch, { call, model });
      res.rehomes.push(...r.rehomes);
      res.duplicates.push(...r.duplicates);
      r.rehomes.forEach((x) => mine.rehomeIds.add(x.questionId));
      r.duplicates.forEach((x) => mine.flagIds.add(x.flag));
      used += r.rehomes.length + r.duplicates.length;
      for (const d of r.dropped) log('info', 'taxonomy classify dropped item', { kind: d.kind, reason: d.reason });
      if (used >= capLeft) {
        capped = true;
        break;
      }
    }
    if (!capped) res.done.push(mine);
    res.all.push({ ...mine, capped });
  }
  return res;
}

// ---- main ----
type Status = 'ok' | 'stopped' | 'skipped' | 'refused' | 'failed' | 'error';
type Finish = (status: Status, report: string, code: number) => number;

export async function runCli(argv: string[], env: Record<string, string | undefined>, deps: CliDeps = {}): Promise<number> {
  const now = deps.now ?? ((): Date => new Date());
  const out = deps.out ?? ((l: string): void => void process.stdout.write(l + '\n'));
  const err = deps.err ?? ((l: string): void => void process.stderr.write(l + '\n'));
  const writeFile = deps.writeFile ?? ((p: string, t: string): void => writeFileSync(p, t, { encoding: 'utf8', mode: 0o600 }));

  let mode: string = argv[0] ?? '';
  let runId: string | null = null;
  const finish: Finish = (status, report, code) => {
    out(JSON.stringify({ runId, mode, status, report: report.slice(0, REPORT_MAX_CHARS) }));
    return code;
  };

  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    err(parsed.error);
    return finish('error', parsed.error, EXIT_REFUSED);
  }
  mode = parsed.mode;
  const flags = parsed.flags;
  const t0 = now();
  const dryRun = parsed.mode === 'apply' && flags['dry-run'] === true;
  const refusal = checkGates(parsed.mode, env, t0, { dryRun });
  if (refusal) {
    err(refusal.message);
    return finish('refused', refusal.message, refusal.code);
  }
  const refuse = (msg: string): number => {
    err(msg);
    return finish('refused', msg, EXIT_REFUSED);
  };
  if (typeof flags['backup-dir'] === 'string' && insideRepo(flags['backup-dir'])) {
    return refuse('refusing --backup-dir: it is inside the repository checkout; backups must live outside it');
  }
  if (env.TAXONOMY_STATE_FILE && insideRepo(env.TAXONOMY_STATE_FILE)) {
    return refuse('refusing TAXONOMY_STATE_FILE: it is inside the repository checkout');
  }

  try {
    const cfg = loadConfig();
    const sb = (deps.createSupabase ?? createSupabaseClient)(cfg.supabaseUrl, cfg.supabaseServiceRoleKey);
    const str = (k: string): string => String(flags[k]);

    // Manual controls: no model, no governor.
    if (parsed.mode === 'undo') {
      runId = str('run');
      const r = await undoRun(sb, runId);
      // A veto hide's flag is not a category_changes row, so undo removes it here (matched by run id).
      const unflagged = await removeVetoFlags(sb, { runId });
      return finish('ok', `Undid ${r.undone} change(s) from run ${stripControl(runId)}${unflagged ? `, removed ${unflagged} veto flag(s)` : ''}${r.blocked ? `; ${r.blocked} could not be undone (state changed since)` : ''}.`, EXIT_OK);
    }
    if (parsed.mode === 'flag' || parsed.mode === 'unflag') {
      const cat = flags.slug !== undefined ? await categoryBySlug(sb, str('slug')) : null;
      if (flags.slug !== undefined && !cat) return refuse(`unknown slug ${stripControl(str('slug'))}`);
      const name = flags.name !== undefined ? str('name') : cat!.name;
      if (parsed.mode === 'flag') {
        const norm = await addFlag(sb, name, cat?.id ?? null, flags.note !== undefined ? str('note') : null);
        return finish('ok', `Flagged ${stripControl(name)} (${norm}): the weekly review will not create it.`, EXIT_OK);
      }
      const n = await removeFlags(sb, { name, categoryId: cat?.id });
      return finish('ok', n ? `Removed ${n} flag(s) for ${stripControl(name)}.` : `No flag found for ${stripControl(name)}.`, EXIT_OK);
    }
    if (parsed.mode === 'hide' || parsed.mode === 'unhide' || parsed.mode === 'protect') {
      runId = newRunId(parsed.mode, t0);
      const slug = str('slug');
      if (parsed.mode === 'hide') {
        const reason = (flags.reason as 'veto' | 'trimmed' | undefined) ?? 'veto';
        await setHidden(sb, slug, reason, runId);
        // An owner veto also flags the category, so the weekly review never recreates it under another slug.
        if (reason === 'veto') {
          const cat = await categoryBySlug(sb, slug);
          try {
            if (cat) await addFlag(sb, cat.name, cat.id, VETO_NOTE_PREFIX + runId);
          } catch (e) {
            throw new Error(`hid ${slug} but flagging it failed (${(e as Error).message}); run: taxonomy flag --slug ${slug}`);
          }
        }
        return finish('ok', `Hid ${stripControl(slug)} (${reason}${reason === 'veto' ? ', flagged' : ''}).`, EXIT_OK);
      }
      if (parsed.mode === 'unhide') {
        await setHidden(sb, slug, null, runId);
        const cat = await categoryBySlug(sb, slug);
        const unflagged = cat ? await removeVetoFlags(sb, { categoryId: cat.id }) : 0;
        return finish('ok', `Unhid ${stripControl(slug)}${unflagged ? ' (flag removed)' : ''}.`, EXIT_OK);
      }
      const on = flags.off !== true;
      await setProtected(sb, slug, on, runId);
      return finish('ok', `${stripControl(slug)} is now ${on ? 'protected' : 'unprotected'}.`, EXIT_OK);
    }

    // Deterministic run ids make a re-run RESUME (every change row and findChange match on the id).
    if (parsed.mode === 'apply') runId = typeof flags['run-id'] === 'string' ? flags['run-id'] : `apply-${planFileHash(str('plan'))}`;
    else if (parsed.mode === 'weekly') runId = typeof flags['run-id'] === 'string' ? flags['run-id'] : weeklyRunId(t0);
    else runId = newRunId('plan', t0);
    if (parsed.mode === 'apply' || parsed.mode === 'weekly') {
      const prior = await pageAll<{ id: number; undone_at: string | null }>(
        (f, t) => loose(sb).from('category_changes').select('id, undone_at').eq('run_id', runId).order('id', { ascending: true }).range(f, t),
        'check run history',
      );
      if (prior.some((r) => r.undone_at)) {
        return refuse(`refusing run id ${stripControl(runId)}: some of its changes were already undone, so re-running it would re-apply onto undone rows. Pass a new --run-id.`);
      }
    }

    // Dry run: read-only preview, BEFORE the probe (the probe is a model call) and before any backup or state write.
    if (dryRun) return await runApplyDry(sb, cfg, str('plan'), runId, finish);

    // Model-using modes run under the usage governor.
    const startInfo = await (deps.probe ?? defaultProbe)();
    if (!startInfo) return finish('stopped', 'Stopped: usage unreadable. Nothing changed.', EXIT_OK);
    const genv = governorEnv(parsed.mode, env);
    const govCfg = governorConfigFromEnv(t0, genv);
    const nightPts = nightBudgetPoints(startInfo, t0, govCfg);
    const budget = parsed.mode === 'weekly' ? weeklyBudgetPoints(nightPts, cfg.taxonomyWeeklyBudgetShare) : nightPts;
    // apply/weekly must also never run into the generator window even if the clock moves on mid-run.
    const guarded = (parsed.mode === 'apply' || parsed.mode === 'weekly') && env.TAXONOMY_ALLOW_WINDOW !== '1';
    const gov = new UsageGovernor(startInfo, govCfg, {
      now,
      budgetPoints: budget,
      yieldFn: guarded ? async () => (inGeneratorWindow(now()) ? 'stop' : 'go') : undefined,
    });
    if (parsed.mode === 'weekly' ? nightPts < WEEKLY_MIN_NIGHT_POINTS : budget < 1) {
      const msg =
        parsed.mode === 'weekly'
          ? `Skipped: tonight's usage budget is ${nightPts} points, under the ${WEEKLY_MIN_NIGHT_POINTS} the weekly review needs. Nothing changed.`
          : 'Skipped: budget under 1 point. Nothing changed.';
      return finish('skipped', msg, EXIT_OK);
    }
    const pre = gov.stopReason();
    if (pre) return finish('stopped', `Stopped: ${pre}. Nothing changed.`, EXIT_OK);
    const acc = createTokenAccumulator();
    const call: ClaudeCaller = (o) => callGoverned(o, acc, gov);
    const notesText = env.TAXONOMY_NOTES_FILE ? readFileSync(env.TAXONOMY_NOTES_FILE, 'utf8').slice(0, 12_000) : '';
    const stateFile = env.TAXONOMY_STATE_FILE;
    const state = loadState(stateFile, (m) => err(m));
    const problems: string[] = [];
    const persist = (): void => {
      try {
        if (stateFile) saveState(stateFile, state);
      } catch (e) {
        problems.push(`state file write failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    if (parsed.mode === 'plan') {
      return await runPlan(sb, cfg, call, str('out'), flags.md as string | undefined, flags.roots as string | undefined, notesText, writeFile, finish, gov, err);
    }
    if (parsed.mode === 'apply') {
      return await runApply(sb, cfg, call, str('plan'), str('backup-dir'), flags.report as string | undefined, writeFile, finish, runId, t0, err, state, persist, now, problems);
    }
    return await runWeekly(sb, cfg, call, flags.report as string | undefined, notesText, writeFile, finish, runId, t0, err, now, state, persist, problems);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`taxonomy ${mode} failed: ${msg}`);
    return finish('failed', `Failed: ${stripControl(msg).slice(0, 500)}`, EXIT_ERROR);
  }
}

async function runPlan(
  sb: TypedSupabaseClient, cfg: PipelineConfig, call: ClaudeCaller, outFile: string, mdFile: string | undefined,
  rootsArg: string | undefined, notes: string, writeFile: (p: string, t: string) => void, finish: Finish,
  gov: UsageGovernor, err: (l: string) => void,
): Promise<number> {
  const tree = await loadTree(sb);
  // General Knowledge is never assessed (out of scope for the taxonomy job, see rules.ts).
  const all = [...tree.byId.values()].filter((n) => n.parentId === null && !n.hidden && n.slug !== GENERAL_KNOWLEDGE_SLUG).map((n) => n.slug).sort();
  const roots = rootsArg ? rootsArg.split(',').map((s) => s.trim()).filter(Boolean) : all;
  const merged: TaxPlan = { merges: [], hides: [], creates: [], rehomes: [], duplicates: [] };
  const notesOut: string[] = [];
  const confinedOut: Rejection[] = [];
  let stopped: string | null = null;
  for (const root of roots) {
    const pre = gov.stopReason();
    if (pre) { stopped = pre; break; }
    if (!tree.bySlug.has(root)) { notesOut.push(`unknown root ${root}: skipped`); continue; }
    if (isGeneralKnowledgeOrUnder(tree, root)) { notesOut.push(`${root}: out of scope (${GENERAL_KNOWLEDGE_SLUG}), skipped`); continue; }
    try {
      const raw = (await assessSubtree(tree, root, notes, { call, model: cfg.taxonomyAssessModel })).plan;
      // Each assessor saw only its own subtree: confine its plan to that subtree BEFORE plans are combined.
      const { plan, rejected: outside } = confineToSubtree(tree, root, raw);
      confinedOut.push(...outside);
      merged.merges.push(...plan.merges);
      merged.hides.push(...plan.hides);
      merged.creates.push(...plan.creates);
    } catch (e) {
      if (e instanceof UsageStopError) { stopped = e.reason; break; }
      const m = e instanceof Error ? e.message : String(e);
      err(`assess ${root} failed: ${m}`);
      notesOut.push(`assess of ${root} failed: ${m.slice(0, 150)}`);
    }
  }
  if (stopped) notesOut.push(`stopped early (${stopped}); plan covers only the roots finished`);
  const v = validatePlan(tree, merged, { maxActions: cfg.taxonomyMaxActionsCleanup, allowedQuestionIds: new Set() });
  const plan = v.plan;
  const rejected = [...confinedOut, ...v.rejected];
  writeFile(outFile, JSON.stringify(plan, null, 2) + '\n');
  if (mdFile) writeFile(mdFile, planMarkdown(plan, rejected, notesOut));
  const real = rejected.filter((r) => !isOverrideNote(r)).length;
  const report = `Plan written: ${plan.merges.length} merge(s), ${plan.hides.length} hide(s), ${plan.creates.length} create(s); ${real} rejected. No database changes.${stopped ? ` Stopped early: ${stopped}.` : ''}`;
  return finish(stopped ? 'stopped' : 'ok', report, EXIT_OK);
}


// ---- apply / weekly orchestration ----

interface RunCtx {
  sb: TypedSupabaseClient;
  cfg: PipelineConfig;
  call: ClaudeCaller;
  runId: string;
  err: (l: string) => void;
  /** Errors from applyPlan calls (the log-derived summary adds them). */
  liveErrors: string[];
  /** Things that went wrong outside the model/DB work itself (state file write, log read); they turn the status to 'failed'. */
  problems: string[];
  rejected: number;
  overrides: number;
  /** 'model's -> code's' survivor for every merge whose survivor the code overrode at apply time (goes in the report). */
  overrideLines: string[];
  alreadyDone: number;
  /** Slugs left alone because Jamie unhid them after this run hid them. */
  skippedUnhidden: Set<string>;
  /** Re-home categories marked done after repeated errors in their own questions. */
  skippedAfterErrors: string[];
  /** Short descriptions of rejected / over-cap items (the dry-run preview lists them). */
  rejectedItems: string[];
  capDropped: string[];
}

interface ApplyOutcome {
  summary: ApplySummary;
  completeMerges: number;
  partialMerges: number;
  newlyVisible: string[];
  names: Record<string, string>;
  rejected: number;
  overrides: number;
  overrideLines: string[];
  alreadyDone: number;
  skippedUnhidden: string[];
  skippedAfterErrors: string[];
  stopped: string | null;
  problems: string[];
}

const newCtx = (sb: TypedSupabaseClient, cfg: PipelineConfig, call: ClaudeCaller, runId: string, err: (l: string) => void, problems: string[]): RunCtx => ({
  sb, cfg, call, runId, err, liveErrors: [], problems, rejected: 0, overrides: 0, overrideLines: [], alreadyDone: 0, skippedUnhidden: new Set(), skippedAfterErrors: [],
  rejectedItems: [], capDropped: [],
});

/** One short line per plan item, for report lists. */
function describeItem(r: Rejection): string {
  const i = r.item as Record<string, unknown>;
  if (r.kind === 'merges') return `merge ${(i.absorbed as string[] | undefined)?.join(',') ?? '?'} -> ${String(i.survivor)}`;
  if (r.kind === 'hides') return `hide ${String(i.slug)}`;
  if (r.kind === 'creates') return `create ${String(i.slug)} under ${String(i.parent)}`;
  if (r.kind === 'rehomes') return `rehome ${String(i.questionId)} ${String(i.from)} -> ${String(i.to)}`;
  return `flag ${String(i.keep)}/${String(i.flag)}`;
}

/** FIRST finish whatever is already logged under this run id (partial merges, unfinished creates/hides/rehomes). Idempotent. */
async function completeLogged(rc: RunCtx): Promise<void> {
  const rows = await loadRunRows(rc.sb, rc.runId);
  if (!rows.length) return;
  const skip = await manuallyUnhidden(rc.sb, rows);
  skip.forEach((x) => rc.skippedUnhidden.add(x));
  for (const plan of replayBatches(rows, skip)) {
    const s = await applyPlan(rc.sb, {} as TaxTree, plan, { runId: rc.runId, dryRun: false, call: rc.call, config: rc.cfg });
    rc.liveErrors.push(...s.errors);
  }
}

/** Structure actions this run id may still take under the cap. */
async function remainingCap(rc: RunCtx, maxActions: number): Promise<number> {
  const rows = await loadRunRows(rc.sb, rc.runId);
  return Math.max(0, maxActions - rows.filter((r) => STRUCTURE_ACTIONS.has(r.action)).length);
}

/** Validate and apply a structure plan (merges/hides/creates), counting what this run id already logged toward the cap. */
async function applyStructure(
  rc: RunCtx, input: TaxPlan, maxActions: number, root?: string, dryRun = false,
): Promise<{ errors: string[]; applied: TaxPlan; capRejected: boolean; summary: ApplySummary }> {
  const before = await loadTree(rc.sb);
  let plan = input;
  if (root !== undefined) {
    // Weekly: the assessor saw only this root's subtree, so its plan may only touch that subtree.
    const c = confineToSubtree(before, root, input);
    plan = c.plan;
    for (const r of c.rejected) {
      rc.rejected++;
      rc.rejectedItems.push(`${describeItem(r)} (${r.reason})`);
      rc.err(`rejected ${r.kind}: ${r.reason}`);
    }
  }
  const rows = await loadRunRows(rc.sb, rc.runId);
  const logged = rows.filter((r) => STRUCTURE_ACTIONS.has(r.action)).length;
  const loggedSlug = (action: string): Set<string> => new Set(rows.filter((r) => r.action === action).map((r) => String(r.payload.slug)));
  const doneCreates = loggedSlug('create');
  const doneHides = loggedSlug('hide');
  const skip = await manuallyUnhidden(rc.sb, rows);
  skip.forEach((x) => rc.skippedUnhidden.add(x));
  const pins = pinMerges(rows, plan.merges, before);
  const dropSkipped = (ms: TaxPlan['merges']): TaxPlan['merges'] =>
    ms.map((m) => ({ ...m, absorbed: m.absorbed.filter((a) => !skip.has(a)) })).filter((m) => m.absorbed.length);
  const pinned = dropSkipped(pins.pinned);
  const v1 = validatePlan(before, { ...plan, merges: dropSkipped(pins.rest) }, { maxActions: Math.max(0, maxActions - logged), allowedQuestionIds: new Set() });
  const applied: TaxPlan = { ...v1.plan, merges: [...pinned, ...v1.plan.merges], hides: v1.plan.hides.filter((h) => !skip.has(h.slug)) };
  const capRejected = v1.rejected.some((r) => r.reason === 'over action cap');
  for (const r of v1.rejected) {
    const slug = (r.item as { slug?: string } | null)?.slug ?? '';
    if (isOverrideNote(r)) {
      rc.overrides++;
      rc.overrideLines.push(r.reason.replace(/^survivor overridden:\s*/, ''));
      rc.err(`note ${r.kind}: ${r.reason}`);
    } else if ((r.kind === 'creates' && doneCreates.has(slug)) || (r.kind === 'hides' && doneHides.has(slug))) {
      rc.alreadyDone++;
    } else {
      rc.rejected++;
      if (r.reason === 'over action cap') rc.capDropped.push(describeItem(r));
      else rc.rejectedItems.push(`${describeItem(r)} (${r.reason})`);
      rc.err(`rejected ${r.kind}: ${r.reason}`);
    }
  }
  const s = await applyPlan(rc.sb, before, applied, { runId: rc.runId, dryRun, call: rc.call, config: rc.cfg });
  rc.liveErrors.push(...s.errors);
  return { errors: s.errors, applied, capRejected, summary: s };
}

export const REHOME_MAX_FAILED_RUNS = 2;

export interface Rotation {
  state: TaxState;
  persist: () => void;
  now: () => Date;
}

/**
 * Classify + apply re-homes, ONE CATEGORY AT A TIME, so an error is attributed to the category whose own question
 * failed. A category is marked done (state.rehome) once its actions applied without error. A category whose own
 * question errored stays unmarked and gets a failed attempt (state.rehomeAttempts, once per run id); after
 * REHOME_MAX_FAILED_RUNS failed runs it is marked done anyway and reported, so one bad question cannot freeze the
 * rotation. A usage stop throws (nothing more is marked); a category cut short by the cap stays unmarked.
 */
async function classifyPhase(
  rc: RunCtx, maxActions: number, pickClassify: (tree: TaxTree, links: LinkRow[]) => string[], rot: Rotation,
): Promise<void> {
  const mid = await loadTree(rc.sb);
  const links = await loadPublishedLinks(rc.sb);
  const slugs = pickClassify(mid, links).filter((s) => !isGeneralKnowledgeOrUnder(mid, s));
  if (!slugs.length) return;
  const capLeft = await remainingCap(rc, maxActions);
  const cls = await classifyCategories(rc.sb, mid, slugs, links, rc.call, rc.cfg.taxonomyClassifyModel, capLeft);
  const v2 = validatePlan(mid, { merges: [], hides: [], creates: [], rehomes: cls.rehomes, duplicates: cls.duplicates }, {
    maxActions: capLeft,
    allowedQuestionIds: cls.allowed,
  });
  rc.rejected += v2.rejected.length;
  for (const r of v2.rejected) rc.err(`rejected ${r.kind}: ${r.reason}`);
  const cut = v2.rejected.filter((r) => r.reason === 'over action cap').map((r) => r.item as { questionId?: string; flag?: string });
  const markDone = (slug: string): void => {
    rot.state.rehome[slug] = rot.now().toISOString();
    if (rot.state.rehomeAttempts) delete rot.state.rehomeAttempts[slug];
    rot.persist();
  };
  const used = new Set<object>();
  const applyGroup = async (plan: TaxPlan): Promise<string[]> => {
    if (!plan.rehomes.length && !plan.duplicates.length) return [];
    const s2 = await applyPlan(rc.sb, mid, plan, { runId: rc.runId, dryRun: false, call: rc.call, config: rc.cfg });
    rc.liveErrors.push(...s2.errors);
    return s2.errors;
  };
  for (const c of cls.all) {
    // validatePlan returns the same item objects, so items are matched back to the category that proposed them.
    const mine: TaxPlan = {
      merges: [], hides: [], creates: [],
      rehomes: v2.plan.rehomes.filter((r) => !used.has(r) && r.from === c.slug && c.rehomeIds.has(r.questionId)),
      duplicates: v2.plan.duplicates.filter((d) => !used.has(d) && c.flagIds.has(d.flag)),
    };
    mine.rehomes.forEach((x) => used.add(x));
    mine.duplicates.forEach((x) => used.add(x));
    const errors = await applyGroup(mine);
    if (c.capped) continue;
    const unfinished = cut.some((i) => (i.questionId && c.rehomeIds.has(i.questionId)) || (i.flag && c.flagIds.has(i.flag)));
    if (unfinished) continue;
    if (!errors.length) {
      markDone(c.slug);
      continue;
    }
    const att = (rot.state.rehomeAttempts ??= {});
    const prev = att[c.slug];
    const n = prev ? (prev.run === rc.runId ? prev.n : prev.n + 1) : 1;
    if (n >= REHOME_MAX_FAILED_RUNS) {
      rc.skippedAfterErrors.push(c.slug);
      markDone(c.slug);
    } else {
      att[c.slug] = { n, run: rc.runId };
      rot.persist();
    }
  }
  // Anything not matched to a category (should not happen) is still applied; its errors are reported as usual.
  await applyGroup({
    merges: [], hides: [], creates: [],
    rehomes: v2.plan.rehomes.filter((r) => !used.has(r)),
    duplicates: v2.plan.duplicates.filter((d) => !used.has(d)),
  });
}

/** Build the outcome from the change log; a failure here must not lose the report. */
async function finalizeRun(rc: RunCtx, visBefore: Set<string>, stopped: string | null): Promise<ApplyOutcome> {
  const errors = [...new Set(rc.liveErrors)];
  let logged: LoggedRun = { summary: { ...emptySummary(), errors }, completeMerges: 0, partialMerges: 0 };
  let newlyVisible: string[] = [];
  const names: Record<string, string> = {};
  try {
    logged = await summaryFromLog(rc.sb, rc.runId, errors);
  } catch (e) {
    rc.problems.push(`could not read the run log: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const after = await loadTree(rc.sb);
    newlyVisible = [...visibleSet(after)].filter((id) => !visBefore.has(id)).map((id) => after.byId.get(id)!.name).sort();
    for (const s of logged.summary.created) names[s] = after.bySlug.get(s)?.name ?? s;
  } catch (e) {
    rc.problems.push(`could not reload the tree: ${e instanceof Error ? e.message : String(e)}`);
  }
  return {
    ...logged, newlyVisible, names, rejected: rc.rejected, overrides: rc.overrides, overrideLines: [...rc.overrideLines],
    alreadyDone: rc.alreadyDone, skippedUnhidden: [...rc.skippedUnhidden].sort(), skippedAfterErrors: [...rc.skippedAfterErrors].sort(), stopped, problems: rc.problems,
  };
}

function outcomeNotes(r: ApplyOutcome, runId: string, extra: string[]): string[] {
  const n = [...extra, `Run id: ${runId}`];
  if (r.rejected) n.push(`Rejected: ${r.rejected}`);
  if (r.alreadyDone) n.push(`Already done (from an earlier attempt of this run): ${r.alreadyDone}`);
  if (r.skippedUnhidden.length) n.push(`Skipped (manually unhidden): ${r.skippedUnhidden.join(', ')}`);
  if (r.skippedAfterErrors.length) n.push(`Re-home skipped after repeated errors: ${r.skippedAfterErrors.join(', ')}`);
  if (r.stopped) {
    n.push(`Stopped early (${r.stopped}): ${r.completeMerges} merge(s) complete, ${r.partialMerges} partial.`);
    n.push(`To resume, re-run the same command (same plan/week) or pass --run-id ${runId}; finished work is kept and skipped.`);
  } else if (r.partialMerges) {
    n.push(`${r.partialMerges} merge(s) did not finish; re-run the same command to retry them.`);
  }
  for (const p of r.problems) n.push(`PROBLEM: ${p}`);
  return n;
}

const statusOf = (r: ApplyOutcome): Status => (r.problems.length ? 'failed' : r.stopped ? 'stopped' : 'ok');

async function runApply(
  sb: TypedSupabaseClient, cfg: PipelineConfig, call: ClaudeCaller, planFile: string, backupDir: string,
  reportFile: string | undefined, writeFile: (p: string, t: string) => void, finish: Finish, runId: string, t0: Date,
  err: (l: string) => void, state: TaxState, persist: () => void, now: () => Date, problems: string[],
): Promise<number> {
  const plan = readPlanFile(planFile);
  const backup = await exportBackup(sb, backupDir, runId, t0);
  log('info', 'taxonomy backup verified', { bytes: backup.bytes, counts: backup.counts });
  const rc = newCtx(sb, cfg, call, runId, err, problems);
  const visBefore = visibleSet(await loadTree(sb));
  let stopped: string | null = null;
  try {
    await completeLogged(rc);
    const { applied } = await applyStructure(rc, plan, cfg.taxonomyMaxActionsCleanup);
    await classifyPhase(
      rc, cfg.taxonomyMaxActionsCleanup,
      (tree) => [...new Set(applied.merges.map((m) => m.survivor))].filter((s) => tree.bySlug.has(s) && !tree.bySlug.get(s)!.hidden),
      { state, persist, now },
    );
  } catch (e) {
    if (!(e instanceof UsageStopError)) throw e;
    stopped = e.reason;
  }
  const r = await finalizeRun(rc, visBefore, stopped);
  const report = buildReport(r.summary, r.newlyVisible, null, 'cleanup', {
    names: r.names,
    overrides: r.overrideLines,
    notes: outcomeNotes(r, runId, [`Backup verified (${Object.entries(backup.counts).map(([k, v]) => `${k} ${v}`).join(', ')}).`]),
  });
  if (reportFile) writeFile(reportFile, report + '\n');
  const status = statusOf(r);
  return finish(status, report, status === 'failed' ? EXIT_ERROR : EXIT_OK);
}

/**
 * `apply --plan <f> --dry-run`: the same validation and engine path as a real apply (applyStructure with the engine in
 * dry-run mode), but NO backup, NO DB write, NO state write and NO model call (re-home classification needs the model,
 * so it is not previewed). Prints the would-be summary, children skipped for depth, cap drops and survivor overrides.
 */
async function runApplyDry(sb: TypedSupabaseClient, cfg: PipelineConfig, planFile: string, runId: string, finish: Finish): Promise<number> {
  const plan = readPlanFile(planFile);
  const noModel: ClaudeCaller = async () => {
    throw new Error('dry run must not call a model');
  };
  const quiet = (): void => {};
  const rc = newCtx(sb, cfg, noModel, runId, quiet, []);
  const logged = await loadRunRows(sb, runId);
  const { summary } = await applyStructure(rc, plan, cfg.taxonomyMaxActionsCleanup, undefined, true);
  const depth = summary.errors.filter((e) => e.includes('not re-parented'));
  const other = summary.errors.filter((e) => !e.includes('not re-parented'));
  const notes = [`Run id: ${runId}`, 'Re-home classification of merge survivors is not previewed (it needs the model).'];
  if (logged.length) notes.unshift(`${logged.length} change(s) already logged under this run id would be finished first (not previewed).`);
  if (rc.alreadyDone) notes.push(`Already done (from an earlier attempt of this run): ${rc.alreadyDone}`);
  if (rc.skippedUnhidden.size) notes.push(`Skipped (manually unhidden): ${[...rc.skippedUnhidden].sort().join(', ')}`);
  const report = buildReport({ ...summary, errors: other }, [], null, 'cleanup', {
    title: 'DRY RUN: category cleanup preview. Nothing was written (no backup, no database change, no model call).',
    overrides: rc.overrideLines,
    lists: [
      { label: 'Children that would NOT be re-parented (depth/cycle)', items: depth },
      { label: 'Dropped: over the action cap', items: rc.capDropped },
      { label: 'Rejected', items: rc.rejectedItems },
    ],
    notes,
  });
  return finish('ok', report, EXIT_OK);
}

async function runWeekly(
  sb: TypedSupabaseClient, cfg: PipelineConfig, call: ClaudeCaller, reportFile: string | undefined, notes: string,
  writeFile: (p: string, t: string) => void, finish: Finish, runId: string, t0: Date, err: (l: string) => void,
  now: () => Date, state: TaxState, persist: () => void, problems: string[],
): Promise<number> {
  const rc = newCtx(sb, cfg, call, runId, err, problems);
  const visBefore = visibleSet(await loadTree(sb));
  let stopped: string | null = null;
  let roots: string[] = [];
  try {
    // 1. finish what this run id already logged, BEFORE assessing anything new
    await completeLogged(rc);
    // 2. assess new roots; a root is marked assessed only after its plan applied cleanly
    const tree = await loadTree(sb);
    // General Knowledge is never assessed (out of scope for the taxonomy job, see rules.ts).
    const rootSlugs = [...tree.byId.values()].filter((n) => n.parentId === null && !n.hidden && !n.protected && n.slug !== GENERAL_KNOWLEDGE_SLUG).map((n) => n.slug);
    roots = pickWeeklyRoots(rootSlugs, state.roots, cfg.taxonomyWeeklyRoots);
    for (const root of roots) {
      if ((await remainingCap(rc, cfg.taxonomyMaxActionsWeekly)) <= 0) break; // cap spent: postponed roots stay unassessed
      const fresh = await loadTree(sb);
      let plan: TaxPlan;
      try {
        plan = (await assessSubtree(fresh, root, notes, { call, model: cfg.taxonomyAssessModel })).plan;
      } catch (e) {
        if (e instanceof UsageStopError) throw e;
        err(`assess ${root} failed: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const { errors, capRejected } = await applyStructure(rc, plan, cfg.taxonomyMaxActionsWeekly, root);
      if (!errors.length && !capRejected) {
        state.roots[root] = now().toISOString();
        persist();
      }
    }
    // 3. re-homes
    await classifyPhase(
      rc, cfg.taxonomyMaxActionsWeekly,
      (mid, links) => pickRehomeCategories(mid, directCounts(mid, links), state.rehome, cfg.taxonomyWeeklyRehomeCategories, t0),
      { state, persist, now },
    );
  } catch (e) {
    if (!(e instanceof UsageStopError)) throw e;
    stopped = e.reason;
  }
  let added: number | null = null;
  try {
    const since = new Date(now().getTime() - 7 * 86_400_000).toISOString();
    const { count, error } = await loose(sb).from('questions').select('id', { count: 'exact', head: true }).eq('status', 'published').gte('created_at', since);
    if (!error && typeof count === 'number') added = count;
  } catch {
    added = null;
  }
  const r = await finalizeRun(rc, visBefore, stopped);
  const report = buildReport(r.summary, r.newlyVisible, added, 'weekly', {
    names: r.names,
    overrides: r.overrideLines,
    notes: outcomeNotes(r, runId, [`Reviewed: ${roots.join(', ') || 'no roots'}`]),
  });
  if (reportFile) writeFile(reportFile, report + '\n');
  const status = statusOf(r);
  return finish(status, report, status === 'failed' ? EXIT_ERROR : EXIT_OK);
}

async function categoryBySlug(sb: TypedSupabaseClient, slug: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await sb.from('categories').select('id, name').eq('slug', slug);
  if (error) throw new Error(`category lookup failed: ${error.message}`);
  return data?.[0] ?? null;
}
