import type { TypedSupabaseClient } from '../supabase.js';
import { applyPlan, setHidden, undoRun, type ApplySummary } from '../taxonomy/apply.js';
import { removeVetoFlags } from '../taxonomy/flags.js';
import type { TaxPlan, TaxTree } from '../taxonomy/types.js';
import type { PipelineConfig } from '../config.js';
import type { ClaudeCaller } from '../claude.js';

// admin_requests is newer than some generated-type consumers; loose access keeps this file independent of them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = (sb: TypedSupabaseClient): any => sb;

export interface QueueOpts {
  now: () => Date;
  maxRequests: number;
  /** Model caller + config for merges (the engine's ancestor calibration). Default: a caller that refuses. */
  call?: ClaudeCaller;
  config?: PipelineConfig;
  /** Leave merge rows queued (they may call the model): usage unreadable, or inside the generator window. */
  deferMerges?: boolean;
}

/** Actions this worker owns. `sweep` is left queued for the sweep worker; anything else is failed. */
const HANDLED = new Set(['merge', 'drop', 'unhide', 'undo']);
const LEFT_QUEUED = new Set(['sweep']);

const noModel: ClaudeCaller = async () => {
  throw new Error('admin requests make no model calls');
};

interface CatRow {
  id: string;
  slug: string;
  parent_id: string | null;
  depth: number;
  hidden_reason: string | null;
}

function slugsOf(payload: unknown): string[] {
  const s = (payload as { slugs?: unknown } | null)?.slugs;
  if (!Array.isArray(s) || s.length === 0 || !s.every((x) => typeof x === 'string' && x)) {
    throw new Error('payload.slugs must be a non-empty list of slugs');
  }
  return [...new Set(s as string[])];
}

const clean = (s: string): string => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();

async function loadCats(sb: TypedSupabaseClient): Promise<CatRow[]> {
  const out: CatRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await loose(sb).from('categories').select('id, slug, parent_id, depth, hidden_reason').order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`load categories: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

function summarise(parts: string[], s: ApplySummary | null, errors: string[]): string {
  const bits = [...parts];
  if (s) bits.push(...(s.skippedAlreadyDone ? [`${s.skippedAlreadyDone} already done`] : []));
  if (errors.length) bits.push(`errors: ${errors.map(clean).join('; ')}`);
  return bits.join(', ').slice(0, 1000);
}

async function handle(sb: TypedSupabaseClient, action: string, payload: unknown, runId: string, o: QueueOpts): Promise<{ ok: boolean; result: string }> {
  const config = o.config ?? ({ claudeModelVerification: 'sonnet' } as PipelineConfig);
  const base = { runId, dryRun: false, call: o.call ?? noModel, config, allowRootSurvivor: true };
  const emptyTree = {} as TaxTree;

  if (action === 'undo') {
    const target = (payload as { runId?: unknown } | null)?.runId;
    if (typeof target !== 'string' || !target) throw new Error('payload.runId must be a run id');
    const r = await undoRun(sb, target);
    await removeVetoFlagsForRun(sb, target);
    return { ok: true, result: `undid ${r.undone} change(s) of ${clean(target)}${r.blocked ? `, ${r.blocked} blocked` : ''}` };
  }

  const slugs = slugsOf(payload);
  const cats = await loadCats(sb);
  const bySlug = new Map(cats.map((c) => [c.slug, c]));
  const byId = new Map(cats.map((c) => [c.id, c]));
  const errors: string[] = [];

  if (action === 'unhide') {
    let n = 0;
    for (const slug of slugs) {
      try {
        const c = bySlug.get(slug);
        // A drop/merge moved questions and children; clearing just the flag would leave them stranded
        // (drop) or resurrect an empty category the generator may use (merge). Only Undo restores those.
        if (c && (c.hidden_reason === 'dropped' || c.hidden_reason === 'merged')) {
          errors.push(`${slug}: use Undo on the ${c.hidden_reason === 'dropped' ? 'drop' : 'merge'} run`);
          continue;
        }
        await setHidden(sb, slug, null, runId);
        if (c) await removeVetoFlags(sb, { categoryId: c.id });
        n++;
      } catch (e) {
        errors.push(`${slug}: ${(e as Error).message}`);
      }
    }
    return { ok: n > 0, result: summarise([`unhid ${n}`], null, errors) };
  }

  // merge / drop: deepest first so a selected child goes before its selected parent.
  const known: CatRow[] = [];
  for (const slug of slugs) {
    const c = bySlug.get(slug);
    if (!c) errors.push(`${slug}: unknown slug`);
    else known.push(c);
  }
  known.sort((a, b) => b.depth - a.depth);

  const plan: TaxPlan = { merges: [], hides: [], creates: [], rehomes: [], duplicates: [], drops: [] };
  const why = `owner: admin ${runId}`;
  for (const c of known) {
    if (action === 'drop') {
      plan.drops!.push({ slug: c.slug, why });
      continue;
    }
    const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
    if (!parent) errors.push(`${c.slug}: top-level category has no parent to merge into`);
    else plan.merges.push({ survivor: parent.slug, absorbed: [c.slug], why });
  }
  const s = await applyPlan(sb, emptyTree, plan, base);
  errors.push(...s.errors);
  const n = action === 'drop' ? s.dropped : s.merged;
  return { ok: n > 0 || s.skippedAlreadyDone > 0, result: summarise([`${action === 'drop' ? 'dropped' : 'merged'} ${n}`], s, errors) };
}

// A veto hide's flag is not a category_changes row, so undoing that run must clear it (matches the taxonomy CLI).
async function removeVetoFlagsForRun(sb: TypedSupabaseClient, runId: string): Promise<void> {
  await removeVetoFlags(sb, { runId });
}

export async function processQueue(sb: TypedSupabaseClient, opts: QueueOpts): Promise<{ done: number; failed: number }> {
  // The wrapper's flock means no other tick is running now, so any `running` row is an orphan of a killed
  // tick. The engine is idempotent per run id (admin-<id>), so re-running it resumes.
  const { error: rErr } = await loose(sb).from('admin_requests').update({ status: 'queued' }).eq('status', 'running');
  if (rErr) throw new Error(`reset running admin_requests: ${rErr.message}`);
  const { data, error } = await loose(sb)
    .from('admin_requests')
    .select('id, action, payload')
    .eq('status', 'queued')
    .order('id', { ascending: true })
    .range(0, 99);
  if (error) throw new Error(`load admin_requests: ${error.message}`);
  let done = 0;
  let failed = 0;
  let claimed = 0;
  for (const row of (data ?? []) as { id: number; action: string; payload: unknown }[]) {
    if (claimed >= opts.maxRequests) break;
    if (LEFT_QUEUED.has(row.action)) continue;
    if (row.action === 'merge' && opts.deferMerges) continue;
    const { data: got, error: cErr } = await loose(sb).from('admin_requests').update({ status: 'running' }).eq('id', row.id).eq('status', 'queued').select('id');
    if (cErr) throw new Error(`claim ${row.id}: ${cErr.message}`);
    if (!got || got.length === 0) continue; // another tick has it
    claimed++;
    const runId = `admin-${row.id}`;
    let status: 'done' | 'failed' = 'failed';
    let result: string;
    try {
      if (!HANDLED.has(row.action)) throw new Error(`unknown action ${clean(String(row.action))}`);
      const r = await handle(sb, row.action, row.payload, runId, opts);
      status = r.ok ? 'done' : 'failed';
      result = r.result;
    } catch (e) {
      result = `failed: ${clean((e as Error).message)}`.slice(0, 1000);
    }
    const { error: wErr } = await loose(sb).from('admin_requests').update({ status, result, run_id: runId, done_at: opts.now().toISOString() }).eq('id', row.id);
    if (wErr) throw new Error(`record ${row.id}: ${wErr.message}`);
    if (status === 'done') done++;
    else failed++;
  }
  return { done, failed };
}
