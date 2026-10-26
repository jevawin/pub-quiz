import 'dotenv/config';
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { loadConfig, type PipelineConfig } from './lib/config.js';
import { createSupabaseClient } from './lib/supabase.js';
import { createTokenAccumulator, type TokenAccumulator } from './lib/claude.js';
import { callClaude, ClaudeCallError } from './lib/claude-cli.js';
import {
  UsageGovernor,
  UsageStopError,
  governorConfigFromEnv,
  type RateLimitInfo,
  type YieldResult,
} from './lib/usage.js';
import { log } from './lib/logger.js';
import { runCategoryAgent } from './agents/category.js';
import { runQuestionsAgent } from './agents/questions.js';
import { runFactCheckAgent } from './agents/fact-check.js';
import { runQaAgent } from './agents/qa.js';
import { runEnrichmentAgent } from './agents/enrichment.js';
import { runCalibratorAgent } from './agents/calibrator.js';

export interface RunOutcome {
  runId: string | null;
  startedAt: string;
  endedAt: string;
  status: 'success' | 'stopped' | 'failed' | 'skipped';
  stopReason: string | null;
  cycles: number;
  budgetPoints: number;
  consumedPoints: number;
  weeklyStart: number | null;
  weeklyEnd: number | null;
  fiveHourStart: number | null;
  fiveHourEnd: number | null;
  weeklyResetsAt: number | null;
  questionsGenerated: number;
  questionsVerified: number;
  questionsRejected: number;
  qaPassed: number;
  qaRewritten: number;
  qaRejected: number;
  enriched: number;
  calibrated: number;
  notionalCostUsd: number;
}

export interface RunDeps {
  config?: PipelineConfig;
  loadConfigFn?: () => PipelineConfig;
  supabase?: ReturnType<typeof createSupabaseClient>;
  /** Reads the start RateLimitInfo (one tiny Claude call). */
  probe?: () => Promise<RateLimitInfo | null>;
  agents?: Partial<{
    category: typeof runCategoryAgent;
    questions: typeof runQuestionsAgent;
    factCheck: typeof runFactCheckAgent;
    qa: typeof runQaAgent;
    enrichment: typeof runEnrichmentAgent;
    calibrator: typeof runCalibratorAgent;
  }>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  yieldFn?: () => Promise<YieldResult>;
  env?: Record<string, string | undefined>;
}

const YIELD_TIMEOUT_MS = 30_000;

/** Runs the yield command (no shell, no args). Exit 0 go, 1 wait, 2 stop, anything else wait. */
export function yieldFromCommand(cmd: string, timeoutMs = YIELD_TIMEOUT_MS): () => Promise<YieldResult> {
  return () =>
    new Promise<YieldResult>((resolve) => {
      try {
        execFile(cmd, [], { timeout: timeoutMs, shell: false }, (err) => {
          if (!err) return resolve('go');
          const raw = (err as { code?: unknown }).code;
          const code = Number(raw);
          if (code === 1) return resolve('wait');
          if (code === 2) return resolve('stop');
          // A non-numeric code (ENOENT, EACCES, ...) means the hook itself is unusable: stop
          // rather than idle silently until the deadline.
          if (typeof raw === 'string' && Number.isNaN(code)) {
            log('error', `yield hook unusable: ${raw}`);
            return resolve('stop');
          }
          resolve('wait');
        });
      } catch (e) {
        const c = (e as { code?: unknown }).code;
        log('error', `yield hook unusable: ${typeof c === 'string' ? c : 'spawn error'}`);
        resolve('stop');
      }
    });
}

export function writeSummary(o: RunOutcome, path = process.env.RUN_SUMMARY_FILE): void {
  if (!path) return;
  try {
    writeFileSync(path, JSON.stringify(o, null, 2));
  } catch (e) {
    log('error', 'Failed to write run summary', { error: e instanceof Error ? e.message : String(e) });
  }
}

async function defaultProbe(): Promise<RateLimitInfo | null> {
  try {
    const r = await callClaude({ model: 'haiku', system: 'Reply with the single word ok.', prompt: 'ok' });
    return r.rateLimit;
  } catch (e) {
    return e instanceof ClaudeCallError ? e.rateLimit : null;
  }
}

const pts = (u: number | undefined): number | null =>
  u === undefined ? null : Math.round(u * 100 * 100) / 100;

export async function runPipeline(deps: RunDeps = {}): Promise<RunOutcome> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const acc: TokenAccumulator = createTokenAccumulator();
  const out: RunOutcome = {
    runId: null, startedAt, endedAt: startedAt, status: 'failed', stopReason: null, cycles: 0,
    budgetPoints: 0, consumedPoints: 0, weeklyStart: null, weeklyEnd: null, fiveHourStart: null, fiveHourEnd: null,
    weeklyResetsAt: null, questionsGenerated: 0, questionsVerified: 0, questionsRejected: 0,
    qaPassed: 0, qaRewritten: 0, qaRejected: 0, enriched: 0, calibrated: 0, notionalCostUsd: 0,
  };
  let supabase: ReturnType<typeof createSupabaseClient> | undefined;
  let config: PipelineConfig | undefined;
  let gov: UsageGovernor | undefined;
  let startInfo: RateLimitInfo | null = null;
  let errorMessage: string | null = null;

  const applyEnd = (li: RateLimitInfo | null): void => {
    if (!li) return;
    out.weeklyEnd = pts(li.weekly.seven_day?.utilization);
    out.fiveHourEnd = pts(li.fiveHour?.utilization);
    out.weeklyResetsAt = li.weekly.seven_day?.resetsAt ?? null;
  };

  const finish = (): RunOutcome => {
    out.endedAt = now().toISOString();
    out.notionalCostUsd = acc.estimated_cost_usd;
    if (gov) {
      out.budgetPoints = gov.budgetPoints;
      out.consumedPoints = gov.consumedPoints;
      applyEnd(gov.lastInfo);
    }
    return out;
  };

  const rowFields = (done: boolean) => ({
    ...(done
      ? {
          status: out.status === 'stopped' ? 'success' : out.status,
          completed_at: out.endedAt,
          error_message: errorMessage ?? (out.status === 'stopped' ? `Stopped: ${out.stopReason}` : null),
        }
      : {}),
    questions_generated: out.questionsGenerated,
    questions_verified: out.questionsVerified,
    questions_rejected: out.questionsRejected,
    questions_qa_passed: out.qaPassed,
    questions_qa_rewritten: out.qaRewritten,
    questions_qa_rejected: out.qaRejected,
    questions_enriched: out.enriched,
    questions_calibrated: out.calibrated,
    total_input_tokens: acc.input_tokens,
    total_output_tokens: acc.output_tokens,
    estimated_cost_usd: acc.estimated_cost_usd,
    config: runConfig(),
  });

  const runConfig = () => ({
    categoryBatchSize: config?.categoryBatchSize,
    knowledgeBatchSize: config?.knowledgeBatchSize,
    questionsBatchSize: config?.questionsBatchSize,
    claudeModelGeneration: config?.claudeModelGeneration,
    claudeModelVerification: config?.claudeModelVerification,
    claudeModelAudit: config?.claudeModelAudit,
    cycles: out.cycles,
    stopReason: out.stopReason,
    budgetPoints: gov?.budgetPoints ?? 0,
    consumedPoints: gov?.consumedPoints ?? 0,
    weeklyStart: out.weeklyStart,
    weeklyEnd: out.weeklyEnd,
    fiveHourStart: out.fiveHourStart,
    fiveHourEnd: out.fiveHourEnd,
    note: 'total_input_tokens includes cache tokens; estimated_cost_usd is the CLI API-equivalent notional cost, not real spend; the probe call cost is not included in notionalCostUsd',
  });

  try {
    config = deps.config ?? (deps.loadConfigFn ?? loadConfig)();
    const cfg = config;
    log('info', 'Pipeline starting');
    supabase = deps.supabase ?? createSupabaseClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey);
    const sb = supabase;
    const env = deps.env ?? process.env;

    // Concurrent run guard: 'running' rows older than staleRunMs are dead; reclaim them.
    const staleCutoffMs = now().getTime() - cfg.staleRunMs;
    const { data: running, error: guardError } = await sb
      .from('pipeline_runs')
      .select('id, started_at')
      .eq('status', 'running');
    if (guardError) {
      log('error', 'Could not check for running pipelines', { error: guardError.message });
      out.status = 'skipped';
      out.stopReason = 'could not check for running pipeline';
      return finish();
    }
    const rows = running ?? [];
    const live = rows.filter((r) => Date.parse(r.started_at) >= staleCutoffMs);
    const stale = rows.filter((r) => Date.parse(r.started_at) < staleCutoffMs);
    if (stale.length > 0) {
      log('warn', 'Reclaiming stale pipeline run(s)', { staleIds: stale.map((r) => r.id) });
      const { error: reclaimError } = await sb
        .from('pipeline_runs')
        .update({
          status: 'failed',
          completed_at: now().toISOString(),
          error_message: 'Reclaimed stale lock: run exceeded staleness threshold without completing',
        })
        .in('id', stale.map((r) => r.id));
      if (reclaimError) log('error', 'Failed to reclaim stale runs', { error: reclaimError.message });
    }
    if (live.length > 0) {
      log('warn', 'Another pipeline run is already in progress, skipping this run', {
        existing_run_id: live[0].id,
        started_at: live[0].started_at,
      });
      out.status = 'skipped';
      out.stopReason = 'another run in progress';
      return finish();
    }

    // Probe the live rate-limit state.
    startInfo = await (deps.probe ?? defaultProbe)();
    if (!startInfo) {
      out.status = 'stopped';
      out.stopReason = 'usage unreadable';
      return finish();
    }
    const yieldFn =
      deps.yieldFn ?? (env.PIPELINE_YIELD_CMD ? yieldFromCommand(env.PIPELINE_YIELD_CMD) : undefined);
    gov = new UsageGovernor(startInfo, governorConfigFromEnv(now(), env), {
      now,
      sleep: deps.sleep,
      yieldFn,
    });
    out.weeklyStart = pts(startInfo.weekly.seven_day?.utilization);
    out.weeklyEnd = out.weeklyStart;
    out.fiveHourStart = pts(startInfo.fiveHour?.utilization);
    out.fiveHourEnd = out.fiveHourStart;
    out.weeklyResetsAt = startInfo.weekly.seven_day?.resetsAt ?? null;

    if (gov.budgetPoints < 1) {
      out.status = 'skipped';
      out.stopReason = 'budget under 1 point';
      return finish();
    }
    const preStop = gov.stopReason();
    if (preStop) {
      out.status = 'skipped';
      out.stopReason = preStop;
      return finish();
    }

    const { data: run, error: insertError } = await sb
      .from('pipeline_runs')
      .insert({ status: 'running', config: runConfig() })
      .select('id')
      .single();
    if (insertError || !run) {
      throw new Error(`Failed to create pipeline_runs record: ${insertError?.message ?? 'No data returned'}`);
    }
    out.runId = run.id;
    log('info', 'Pipeline run created', { runId: run.id });

    const a = deps.agents ?? {};
    const category = a.category ?? runCategoryAgent;
    const questions = a.questions ?? runQuestionsAgent;
    const factCheck = a.factCheck ?? runFactCheckAgent;
    const qa = a.qa ?? runQaAgent;
    const enrichment = a.enrichment ?? runEnrichmentAgent;
    const calibrator = a.calibrator ?? runCalibratorAgent;
    const g = gov;

    const sync = async (done: boolean) => {
      out.consumedPoints = g.consumedPoints;
      applyEnd(g.lastInfo);
      out.endedAt = now().toISOString();
      const { error } = await sb.from('pipeline_runs').update(rowFields(done)).eq('id', run.id);
      if (error) log('error', 'pipeline_runs cycle update failed', { error: error.message });
    };

    try {
      if (cfg.enableCategoryAgent) {
        log('info', 'Starting Category Agent');
        const r = await category(cfg, acc, g);
        log('info', 'Category Agent complete', { processed: r.processed, failed: r.failed });
      }
      const maxCycles = Math.max(1, Math.floor(Number(env.MAX_CYCLES) || 30));
      for (;;) {
        if (out.cycles >= maxCycles) {
          out.status = 'stopped';
          out.stopReason = 'max cycles';
          break;
        }
        out.cycles++;
        let generated = 0;
        log('info', 'Starting Questions Agent', { cycle: out.cycles });
        const q = await questions(cfg, acc, g);
        generated = q.processed;
        out.questionsGenerated += q.processed;
        log('info', 'Questions Agent complete', { processed: q.processed, failed: q.failed });

        log('info', 'Starting Fact-Check Agent');
        const f = await factCheck(cfg, acc, g);
        out.questionsVerified += f.processed;
        out.questionsRejected += f.failed;

        log('info', 'Starting QA Agent');
        const r = await qa(cfg, acc, g);
        out.qaPassed += r.processed;
        out.qaRewritten += r.rewritten;
        out.qaRejected += r.failed;

        log('info', 'Starting Enrichment Agent');
        const e = await enrichment(cfg, acc, g);
        out.enriched += e.enriched;

        log('info', 'Starting Calibrator Agent');
        const c = await calibrator(cfg, acc, g);
        out.calibrated += c.processed;

        await sync(false);
        if (generated === 0) {
          out.status = 'success';
          out.stopReason = 'no questions generated';
          break;
        }
        const reason = g.stopReason();
        if (reason) {
          out.status = 'stopped';
          out.stopReason = reason;
          break;
        }
      }
    } catch (error) {
      if (error instanceof UsageStopError) {
        out.status = 'stopped';
        out.stopReason = error.reason;
      } else {
        out.status = 'failed';
        errorMessage = error instanceof Error ? error.message : String(error);
        out.stopReason = errorMessage;
        log('error', 'Pipeline failed', { error: errorMessage });
      }
    }
    finish();
    try {
      const { error } = await sb.from('pipeline_runs').update(rowFields(true)).eq('id', run.id);
      if (error) log('error', 'pipeline_runs final update failed', { error: error.message });
    } catch (e) {
      log('error', 'pipeline_runs final update threw', { error: e instanceof Error ? e.message : String(e) });
    }
    log('info', 'Pipeline complete', { status: out.status, cost_usd: acc.estimated_cost_usd.toFixed(4) });
    return out;
  } catch (error) {
    out.status = 'failed';
    errorMessage = error instanceof Error ? error.message : String(error);
    out.stopReason = errorMessage;
    log('error', 'Pipeline failed', { error: errorMessage });
    if (supabase && out.runId) {
      try {
        finish();
        await supabase.from('pipeline_runs').update(rowFields(true)).eq('id', out.runId);
      } catch {
        /* summary still written */
      }
    }
    return finish();
  }
}

/** Entry point: run, always write the summary, set the exit code. Never calls process.exit. */
export async function main(
  deps: RunDeps = {},
  run: (d: RunDeps) => Promise<RunOutcome> = runPipeline,
): Promise<void> {
  try {
    const o = await run(deps);
    writeSummary(o);
    process.exitCode = o.status === 'failed' ? 1 : 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log('error', 'Pipeline crashed', { error: msg });
    const t = new Date().toISOString();
    writeSummary({
      runId: null, startedAt: t, endedAt: t, status: 'failed', stopReason: msg, cycles: 0,
      budgetPoints: 0, consumedPoints: 0, weeklyStart: null, weeklyEnd: null, fiveHourStart: null, fiveHourEnd: null,
      weeklyResetsAt: null, questionsGenerated: 0, questionsVerified: 0, questionsRejected: 0,
      qaPassed: 0, qaRewritten: 0, qaRejected: 0, enriched: 0, calibrated: 0, notionalCostUsd: 0,
    });
    process.exitCode = 1;
  }
}

// Run when executed directly (not when imported as a module in tests)
const isDirectExecution =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('run-pipeline.ts') || process.argv[1].endsWith('run-pipeline.js'));

if (isDirectExecution) {
  void main();
}
