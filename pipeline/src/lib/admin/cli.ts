import { loadConfig, type PipelineConfig } from '../config.js';
import { createSupabaseClient, type TypedSupabaseClient } from '../supabase.js';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { callGoverned, createTokenAccumulator, type ClaudeCaller } from '../claude.js';
import { defaultProbe, governorEnv, inGeneratorWindow } from '../taxonomy/cli.js';
import { governorConfigFromEnv, nightBudgetPoints, UsageGovernor, type RateLimitInfo } from '../usage.js';
import { processQueue } from './queue.js';
import { applyDueDrops, cancelDeadSweeps, claimSweepRequests, sendDueNotices, stepSweeps } from './sweep.js';

export interface TickDeps {
  now: () => Date;
  probe: () => Promise<RateLimitInfo | null>;
  env: NodeJS.ProcessEnv;
  config: PipelineConfig;
  /** Telegram fetch (tests). */
  fetch?: typeof fetch;
  /** The raw model call under the governor (tests). Default: the tool-isolated claude CLI. */
  rawCall?: ClaudeCaller;
}

/** One back-off for every admin probe (sweeps and merges): a refusal means the account is busy either way. */
const BACKOFF_FILE = 'admin-probe-after';
const BACKOFF_DEFAULT_S = 30 * 60;

/** Epoch seconds before which the admin usage probe is skipped; 0 if unset/unreadable (or no ADMIN_STATE_DIR). */
function readBackoff(env: NodeJS.ProcessEnv): number {
  if (!env.ADMIN_STATE_DIR) return 0;
  try {
    const n = Number(readFileSync(join(env.ADMIN_STATE_DIR, BACKOFF_FILE), 'utf8').trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeBackoff(env: NodeJS.ProcessEnv, info: RateLimitInfo | null, now: Date): void {
  if (!env.ADMIN_STATE_DIR) return;
  const nowS = Math.floor(now.getTime() / 1000);
  const reset = info?.fiveHour?.resetsAt;
  const until = reset != null && reset > nowS ? Math.floor(reset) : nowS + BACKOFF_DEFAULT_S;
  const path = join(env.ADMIN_STATE_DIR, BACKOFF_FILE);
  try {
    writeFileSync(`${path}.tmp`, `${until}\n`);
    renameSync(`${path}.tmp`, path);
  } catch (e) {
    process.stderr.write(`admin: could not write probe back-off: ${(e as Error).message}\n`);
  }
}

/** Wall-clock budget for starting sweep batches in one tick (ticks run every 5 minutes under a flock). */
const SWEEP_TICK_MS = 4 * 60_000;

export interface TickResult {
  done: number;
  failed: number;
  sweeps: { started: number; calls: number; judged: number; stopped?: string; noticesSent: number; noticesFailed: number; applied: number; hidden: number };
}

export async function runTick(sb: TypedSupabaseClient, deps: TickDeps): Promise<TickResult> {
  const { now, env } = deps;
  const t0 = now();
  // 1. Sweep requests: start sweeps (no model calls).
  const claimed = await claimSweepRequests(sb, now);
  // Sweeps whose rule was deleted or set inactive are cancelled first, so they never cause a probe.
  await cancelDeadSweeps(sb, ['judging', 'noticed']);

  // 2. Does anything need the model? A queued merge (ancestor calibration) or a sweep still judging.
  //    The probe is itself a model call, so it is made only then, and never inside the generator window.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loose = sb as any;
  const { data, error } = await loose.from('admin_requests').select('id').eq('action', 'merge').in('status', ['queued', 'running']).range(0, 0);
  if (error) throw new Error(`check merge queue: ${error.message}`);
  const mergeWaiting = !!(data && data.length > 0);
  const { data: sw, error: sErr } = await loose.from('sweep_runs').select('id, total, judged').eq('status', 'judging').range(0, 99);
  if (sErr) throw new Error(`check sweeps: ${sErr.message}`);
  const sweepReady = ((sw ?? []) as { total: number | null; judged: number }[]).some((r) => r.total !== null && r.judged === r.total);
  const sweepWaiting = ((sw ?? []) as { total: number | null; judged: number }[]).some((r) => r.total !== null && r.judged < r.total);

  // Sweeps and merges share one back-off after a refusal (state file), so a stuck merge does not probe every tick.
  const backoffOver = Math.floor(t0.getTime() / 1000) >= readBackoff(env);
  const sweepProbe = sweepWaiting && backoffOver;
  const mergeProbe = mergeWaiting && backoffOver;
  let call: ClaudeCaller | undefined;
  let gov: UsageGovernor | undefined;
  let probed = false;
  let info: RateLimitInfo | null = null;
  if ((mergeProbe || sweepProbe) && !inGeneratorWindow(t0)) {
    probed = true;
    info = await deps.probe();
    if (info) {
      const govCfg = governorConfigFromEnv(t0, governorEnv('apply', env));
      const budget = nightBudgetPoints(info, t0, govCfg);
      const g = new UsageGovernor(info, govCfg, {
        now,
        budgetPoints: budget,
        yieldFn: async () => (inGeneratorWindow(now()) ? 'stop' : 'go'),
      });
      if (budget >= 1 && !g.stopReason()) {
        const acc = createTokenAccumulator();
        gov = g;
        call = deps.rawCall ? (o) => callGoverned(o, acc, g, deps.rawCall) : (o) => callGoverned(o, acc, g);
      }
    }
  }
  if (probed && !call) writeBackoff(env, info, t0);

  const q = await processQueue(sb, { now, maxRequests: 20, call, config: deps.config, deferMerges: !call });

  // 3. Judge (only with a usable governor), 4. notices, 5. due drops.
  let step: { calls: number; judged: number; stopped?: string } = { calls: 0, judged: 0 };
  if (sweepWaiting && call && gov) {
    const r = await stepSweeps(sb, { call, gov, now, deadlineMs: t0.getTime() + SWEEP_TICK_MS, model: deps.config.claudeModelSweep });
    if (r.usageStop) writeBackoff(env, gov.lastInfo, now());
    step = r;
  }
  const token = env.TG_BOT_TOKEN;
  const chatId = env.TG_CHAT_ID;
  const siteUrl = env.ADMIN_SITE_URL;
  const tg = token && chatId && siteUrl ? { token, chatId, siteUrl, now, fetch: deps.fetch } : undefined;
  let notices = { sent: 0, failed: 0 };
  if (tg) notices = await sendDueNotices(sb, tg);
  else if (sweepReady || step.judged > 0) process.stderr.write('admin: TG_BOT_TOKEN/TG_CHAT_ID/ADMIN_SITE_URL not all set; sweep notices skipped\n');
  const drops = await applyDueDrops(sb, now(), tg);

  return {
    done: q.done + claimed.done,
    failed: q.failed + claimed.failed,
    sweeps: { started: claimed.done, ...step, noticesSent: notices.sent, noticesFailed: notices.failed, ...drops },
  };
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (argv[0] !== 'tick') {
    process.stderr.write('usage: admin tick\n');
    return 2;
  }
  if (env.ENABLE_ADMIN !== '1') {
    process.stderr.write('admin: refusing to run without ENABLE_ADMIN=1\n');
    return 3;
  }
  const cfg = loadConfig();
  const sb = createSupabaseClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey);
  const r = await runTick(sb, { now: () => new Date(), probe: defaultProbe, env, config: cfg });
  process.stdout.write(JSON.stringify({ ok: true, ...r }) + '\n');
  return 0;
}

if (process.argv[1] && /admin[\\/]cli\.[tj]s$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e) => {
      process.stderr.write(`admin: crashed: ${(e as Error).message}\n`);
      process.exit(1);
    },
  );
}
