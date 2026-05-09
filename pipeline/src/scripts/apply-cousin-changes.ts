#!/usr/bin/env node
/**
 * Phase 999.23 Wave 1 — apply cousin/cat audit changes from a decisions JSON.
 *
 * Mirrors apply-chain-rows.ts shape (stdin JSON, service-role client) but
 * supports three op types per locked decision D2: delete | insert | set_primary.
 *
 * Per question_id: ALL deletes run BEFORE inserts BEFORE set_primary so the
 * cap-5 trigger (enforce_question_categories_rules from migration 00034) is
 * satisfied for the row count even when an insert would briefly breach it.
 *
 * Each successful DB write appends one JSONL line to `data/audit-changes.jsonl`
 * (relative to process.cwd()) per locked decision D5. Inserts of slugs that are
 * NOT chain ancestors require a non-empty `cousin_reason`.
 *
 * Usage:
 *   echo '{"batch_id":"smoke-001","ops":[...]}' | \
 *     npx tsx pipeline/src/scripts/apply-cousin-changes.ts [--dry-run]
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createSupabaseClient, TypedSupabaseClient } from '../lib/supabase.js';

// ---- Discriminated union of accepted ops (D2) -------------------------------

interface DeleteOp {
  op: 'delete';
  question_id: string;
  slug: string;
  reason: string;
}

interface InsertOp {
  op: 'insert';
  question_id: string;
  slug: string;
  estimate_score: number;
  cousin_reason?: string;
  chain_ancestor?: boolean;
}

interface SetPrimaryOp {
  op: 'set_primary';
  question_id: string;
  new_category_slug: string;
  reason: string;
}

type ChangeOp = DeleteOp | InsertOp | SetPrimaryOp;

interface BatchPayload {
  batch_id: string;
  ops: ChangeOp[];
}

// ---- IO helpers --------------------------------------------------------------

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const AUDIT_LOG_PATH = path.resolve(process.cwd(), 'data', 'audit-changes.jsonl');

interface AuditLine {
  ts: string;
  batch_id: string;
  question_id: string;
  op: 'delete' | 'insert' | 'set_primary';
  slug: string;
  prev_score: number | null;
  new_score: number | null;
  reason: string;
  cousin_reason: string | null;
  chain_ancestor: boolean;
}

function appendAudit(line: AuditLine): void {
  // Synchronous so ordering matches the order of successful DB writes.
  fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(line) + '\n', { encoding: 'utf8' });
}

// ---- Validation --------------------------------------------------------------

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function validatePayload(raw: unknown): BatchPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Input must be an object { batch_id, ops }');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.batch_id !== 'string' || r.batch_id.length === 0) {
    throw new Error('batch_id must be a non-empty string');
  }
  if (!Array.isArray(r.ops) || r.ops.length === 0) {
    throw new Error('ops must be a non-empty array');
  }
  const ops: ChangeOp[] = [];
  for (let i = 0; i < r.ops.length; i++) {
    const o = r.ops[i] as Record<string, unknown>;
    if (!o || typeof o.op !== 'string') {
      throw new Error(`ops[${i}]: missing or invalid 'op' field`);
    }
    if (typeof o.question_id !== 'string' || !UUID_RE.test(o.question_id)) {
      throw new Error(`ops[${i}]: 'question_id' must be a uuid`);
    }
    if (o.op === 'delete') {
      if (typeof o.slug !== 'string' || o.slug.length === 0) {
        throw new Error(`ops[${i}] delete: 'slug' required`);
      }
      if (typeof o.reason !== 'string' || o.reason.length === 0) {
        throw new Error(`ops[${i}] delete: 'reason' required`);
      }
      ops.push({
        op: 'delete',
        question_id: o.question_id,
        slug: o.slug,
        reason: o.reason,
      });
    } else if (o.op === 'insert') {
      if (typeof o.slug !== 'string' || o.slug.length === 0) {
        throw new Error(`ops[${i}] insert: 'slug' required`);
      }
      if (typeof o.estimate_score !== 'number' || o.estimate_score < 0 || o.estimate_score > 100) {
        throw new Error(`ops[${i}] insert: 'estimate_score' must be number in [0,100]`);
      }
      const chainAnc = o.chain_ancestor === true;
      const cousinReason =
        typeof o.cousin_reason === 'string' && o.cousin_reason.length > 0 ? o.cousin_reason : undefined;
      // D5: non-chain inserts MUST carry a non-empty cousin_reason.
      if (!chainAnc && !cousinReason) {
        throw new Error(
          `ops[${i}] insert (qid=${o.question_id}, slug=${o.slug}): cousin_reason is required when chain_ancestor !== true`
        );
      }
      ops.push({
        op: 'insert',
        question_id: o.question_id,
        slug: o.slug,
        estimate_score: o.estimate_score,
        cousin_reason: cousinReason,
        chain_ancestor: chainAnc,
      });
    } else if (o.op === 'set_primary') {
      if (typeof o.new_category_slug !== 'string' || o.new_category_slug.length === 0) {
        throw new Error(`ops[${i}] set_primary: 'new_category_slug' required`);
      }
      if (typeof o.reason !== 'string' || o.reason.length === 0) {
        throw new Error(`ops[${i}] set_primary: 'reason' required`);
      }
      ops.push({
        op: 'set_primary',
        question_id: o.question_id,
        new_category_slug: o.new_category_slug,
        reason: o.reason,
      });
    } else {
      throw new Error(`ops[${i}]: unknown op '${String(o.op)}'`);
    }
  }
  return { batch_id: r.batch_id, ops };
}

// ---- Slug resolution ---------------------------------------------------------

function collectSlugs(ops: ChangeOp[]): string[] {
  const set = new Set<string>();
  for (const o of ops) {
    if (o.op === 'delete' || o.op === 'insert') set.add(o.slug);
    else set.add(o.new_category_slug);
  }
  return [...set];
}

async function resolveSlugs(sb: TypedSupabaseClient, slugs: string[]): Promise<Map<string, string>> {
  const { data, error } = await sb.from('categories').select('id, slug').in('slug', slugs);
  if (error) throw new Error(`categories fetch error: ${error.message}`);
  const map = new Map<string, string>(((data ?? []) as Array<{ id: string; slug: string }>).map((c) => [c.slug, c.id]));
  const missing = slugs.filter((s) => !map.has(s));
  if (missing.length > 0) {
    throw new Error(`Slugs not found in categories table: ${missing.join(', ')}`);
  }
  return map;
}

// ---- Grouping ----------------------------------------------------------------

interface GroupedOps {
  question_id: string;
  deletes: DeleteOp[];
  inserts: InsertOp[];
  primaries: SetPrimaryOp[];
}

function groupByQuestion(ops: ChangeOp[]): GroupedOps[] {
  const map = new Map<string, GroupedOps>();
  for (const o of ops) {
    let g = map.get(o.question_id);
    if (!g) {
      g = { question_id: o.question_id, deletes: [], inserts: [], primaries: [] };
      map.set(o.question_id, g);
    }
    if (o.op === 'delete') g.deletes.push(o);
    else if (o.op === 'insert') g.inserts.push(o);
    else g.primaries.push(o);
  }
  return [...map.values()];
}

// ---- Apply -------------------------------------------------------------------

interface ApplyCounters {
  deleted: number;
  inserted: number;
  primary_moved: number;
}

async function applyGroup(
  sb: TypedSupabaseClient,
  batchId: string,
  group: GroupedOps,
  slugToId: Map<string, string>,
  counters: ApplyCounters
): Promise<void> {
  // For deletes: fetch prev_score per slug in one query so the audit log captures it.
  const prevScoreByCatId = new Map<string, number | null>();
  if (group.deletes.length > 0) {
    const catIds = group.deletes.map((d) => slugToId.get(d.slug)!);
    const { data, error } = await sb
      .from('question_categories')
      .select('category_id, estimate_score')
      .eq('question_id', group.question_id)
      .in('category_id', catIds);
    if (error) throw new Error(`prev_score fetch failed for ${group.question_id}: ${error.message}`);
    for (const row of (data ?? []) as Array<{ category_id: string; estimate_score: number | null }>) {
      prevScoreByCatId.set(row.category_id, row.estimate_score);
    }
  }

  // 1. Deletes (cap-5 trigger ordering: deletes BEFORE inserts).
  for (const d of group.deletes) {
    const catId = slugToId.get(d.slug)!;
    const ret = await sb
      .from('question_categories')
      .delete()
      .eq('question_id', group.question_id)
      .eq('category_id', catId);
    if ((ret as { error: { message: string } | null }).error) {
      throw new Error(
        `delete failed (qid=${group.question_id}, slug=${d.slug}): ${(ret as { error: { message: string } }).error.message}`
      );
    }
    counters.deleted += 1;
    appendAudit({
      ts: new Date().toISOString(),
      batch_id: batchId,
      question_id: group.question_id,
      op: 'delete',
      slug: d.slug,
      prev_score: prevScoreByCatId.get(catId) ?? null,
      new_score: null,
      reason: d.reason,
      cousin_reason: null,
      chain_ancestor: false,
    });
  }

  // 2. Inserts (idempotent via upsert + ignoreDuplicates).
  for (const ins of group.inserts) {
    const catId = slugToId.get(ins.slug)!;
    const row = {
      question_id: group.question_id,
      category_id: catId,
      estimate_score: ins.estimate_score,
      observed_n: 0,
    };
    const ret = await (sb.from('question_categories').upsert(row as never, {
      onConflict: 'question_id,category_id',
      ignoreDuplicates: true,
    }) as unknown as Promise<{ data: unknown; error: { message: string } | null }>);
    if (ret.error) {
      throw new Error(
        `insert (upsert) failed (qid=${group.question_id}, slug=${ins.slug}): ${ret.error.message}`
      );
    }
    counters.inserted += 1;
    appendAudit({
      ts: new Date().toISOString(),
      batch_id: batchId,
      question_id: group.question_id,
      op: 'insert',
      slug: ins.slug,
      prev_score: null,
      new_score: ins.estimate_score,
      reason: ins.chain_ancestor ? 'chain ancestor backfill' : (ins.cousin_reason ?? ''),
      cousin_reason: ins.cousin_reason ?? null,
      chain_ancestor: ins.chain_ancestor === true,
    });
  }

  // 3. set_primary (questions.category_id update).
  for (const sp of group.primaries) {
    const catId = slugToId.get(sp.new_category_slug)!;
    const ret = await sb.from('questions').update({ category_id: catId }).eq('id', group.question_id);
    if ((ret as { error: { message: string } | null }).error) {
      throw new Error(
        `set_primary failed (qid=${group.question_id}, slug=${sp.new_category_slug}): ${(ret as { error: { message: string } }).error.message}`
      );
    }
    counters.primary_moved += 1;
    appendAudit({
      ts: new Date().toISOString(),
      batch_id: batchId,
      question_id: group.question_id,
      op: 'set_primary',
      slug: sp.new_category_slug,
      prev_score: null,
      new_score: null,
      reason: sp.reason,
      cousin_reason: null,
      chain_ancestor: false,
    });
  }
}

// ---- Dry run -----------------------------------------------------------------

interface DryRunPlan {
  question_id: string;
  ordered_ops: Array<{ op: 'delete' | 'insert' | 'set_primary'; slug: string; estimate_score?: number }>;
}

function buildDryRunPlan(groups: GroupedOps[]): DryRunPlan[] {
  return groups.map((g) => ({
    question_id: g.question_id,
    ordered_ops: [
      ...g.deletes.map((d) => ({ op: 'delete' as const, slug: d.slug })),
      ...g.inserts.map((i) => ({ op: 'insert' as const, slug: i.slug, estimate_score: i.estimate_score })),
      ...g.primaries.map((p) => ({ op: 'set_primary' as const, slug: p.new_category_slug })),
    ],
  }));
}

// ---- main --------------------------------------------------------------------

export async function run(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const raw = await readStdin();
  if (!raw.trim()) {
    console.error('No input on stdin');
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('Invalid JSON input:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  let payload: BatchPayload;
  try {
    payload = validatePayload(parsed);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const sb = createSupabaseClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const slugs = collectSlugs(payload.ops);
  let slugToId: Map<string, string>;
  try {
    slugToId = await resolveSlugs(sb, slugs);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const groups = groupByQuestion(payload.ops);
  const counters: ApplyCounters = { deleted: 0, inserted: 0, primary_moved: 0 };

  if (dryRun) {
    const plan = buildDryRunPlan(groups);
    const summary = {
      batch_id: payload.batch_id,
      dry_run: true,
      unique_questions: groups.length,
      planned: {
        deletes: groups.reduce((acc, g) => acc + g.deletes.length, 0),
        inserts: groups.reduce((acc, g) => acc + g.inserts.length, 0),
        primary_moves: groups.reduce((acc, g) => acc + g.primaries.length, 0),
      },
      plan,
    };
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // Ensure audit-log directory exists before any DB write so a successful write
  // never lacks its trail line (T-99923-03).
  fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });

  for (const g of groups) {
    await applyGroup(sb, payload.batch_id, g, slugToId, counters);
  }

  const summary = {
    batch_id: payload.batch_id,
    dry_run: false,
    deleted: counters.deleted,
    inserted: counters.inserted,
    primary_moved: counters.primary_moved,
    unique_questions: groups.length,
  };
  console.log(JSON.stringify(summary, null, 2));
}

// Allow tests to import { run } without auto-executing main.
const isDirectRun = (() => {
  try {
    const argv1 = process.argv[1] ?? '';
    return argv1.includes('apply-cousin-changes');
  } catch {
    return false;
  }
})();

if (isDirectRun && process.env.VITEST !== 'true') {
  void run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
