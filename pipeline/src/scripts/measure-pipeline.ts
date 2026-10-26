#!/usr/bin/env node
// Read-only measurement of pipeline runs, question statuses, and category balance.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx src/scripts/measure-pipeline.ts
import { createSupabaseClient } from '../lib/supabase.js';

const PAGE = 1000;
const n = (v: number | null | undefined): number => v ?? 0;
const pct = (a: number, b: number): string => (b > 0 ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');

async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const sb = createSupabaseClient(url, key);

  // 1. pipeline_runs
  const runs = await fetchAll((f, t) =>
    sb.from('pipeline_runs').select('*').order('started_at', { ascending: true }).order('id', { ascending: true }).range(f, t),
  );
  console.log(`== pipeline_runs (${runs.length} rows) ==`);
  console.log('date       status     gen  ver  rej  qaPass qaRew qaRej   inTok     outTok    cost$');
  const tot = { gen: 0, ver: 0, rej: 0, qp: 0, qw: 0, qr: 0, i: 0, o: 0, c: 0 };
  for (const r of runs) {
    const row = {
      gen: n(r.questions_generated), ver: n(r.questions_verified), rej: n(r.questions_rejected),
      qp: n(r.questions_qa_passed), qw: n(r.questions_qa_rewritten), qr: n(r.questions_qa_rejected),
      i: n(r.total_input_tokens), o: n(r.total_output_tokens), c: n(r.estimated_cost_usd),
    };
    for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += row[k];
    console.log(
      `${r.started_at.slice(0, 10)} ${r.status.padEnd(10)} ${String(row.gen).padStart(4)} ${String(row.ver).padStart(4)} ${String(row.rej).padStart(4)} ` +
        `${String(row.qp).padStart(6)} ${String(row.qw).padStart(5)} ${String(row.qr).padStart(5)} ${String(row.i).padStart(9)} ${String(row.o).padStart(9)} ${row.c.toFixed(2).padStart(8)}`,
    );
  }
  console.log(
    `TOTAL                 ${String(tot.gen).padStart(4)} ${String(tot.ver).padStart(4)} ${String(tot.rej).padStart(4)} ` +
      `${String(tot.qp).padStart(6)} ${String(tot.qw).padStart(5)} ${String(tot.qr).padStart(5)} ${String(tot.i).padStart(9)} ${String(tot.o).padStart(9)} ${tot.c.toFixed(2).padStart(8)}`,
  );
  console.log(`runs by status: ${JSON.stringify(runs.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {}))}`);

  // 2. derived rates
  console.log('\n== derived rates (sums over all runs) ==');
  console.log(`fact-check reject rate  = rejected / generated   = ${tot.rej} / ${tot.gen} = ${pct(tot.rej, tot.gen)}`);
  console.log(`QA reject rate          = qa_rejected / verified = ${tot.qr} / ${tot.ver} = ${pct(tot.qr, tot.ver)}`);
  console.log(`QA rewrite rate         = qa_rewritten / verified = ${tot.qw} / ${tot.ver} = ${pct(tot.qw, tot.ver)}`);
  console.log(`QA pass rate            = qa_passed / verified   = ${tot.qp} / ${tot.ver} = ${pct(tot.qp, tot.ver)}`);

  // 3. questions by status
  console.log('\n== questions by status ==');
  const statuses = await fetchAll((f, t) => sb.from('questions').select('id, status').order('id', { ascending: true }).range(f, t));
  const byStatus: Record<string, number> = {};
  for (const q of statuses) byStatus[q.status] = (byStatus[q.status] ?? 0) + 1;
  for (const [s, c] of Object.entries(byStatus).sort()) console.log(`${s.padEnd(20)} ${c}`);
  console.log(`${'total'.padEnd(20)} ${statuses.length}`);

  // 4. question_categories count distribution across depth>=1 categories
  const cats = await fetchAll((f, t) => sb.from('categories').select('id, depth').gte('depth', 1).order('id', { ascending: true }).range(f, t));
  const qc = await fetchAll((f, t) => sb.from('question_categories').select('category_id, question_id').order('category_id', { ascending: true }).order('question_id', { ascending: true }).range(f, t));
  const perCat = new Map<string, number>(cats.map((c) => [c.id, 0]));
  for (const row of qc) if (perCat.has(row.category_id)) perCat.set(row.category_id, perCat.get(row.category_id)! + 1);
  const counts = [...perCat.values()].sort((a, b) => a - b);
  const mid = Math.floor(counts.length / 2);
  const median = counts.length === 0 ? 0 : counts.length % 2 ? counts[mid] : (counts[mid - 1] + counts[mid]) / 2;
  console.log(`\n== question_categories per category (depth >= 1; ${counts.length} categories, ${qc.length} link rows total) ==`);
  console.log(`min ${counts[0] ?? 0} / median ${median} / max ${counts[counts.length - 1] ?? 0}`);
  console.log(`categories at 0: ${counts.filter((c) => c === 0).length}`);
}

void main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
