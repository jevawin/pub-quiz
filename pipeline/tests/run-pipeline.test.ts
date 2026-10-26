// Task 5: looping, usage-paced run. All collaborators are injected fakes: no real time,
// no network, no spawning.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/lib/logger.js', () => ({ log: vi.fn() }));

import { runPipeline, main, yieldFromCommand, writeSummary, type RunDeps } from '../src/run-pipeline.js';
import { UsageStopError, type RateLimitInfo } from '../src/lib/usage.js';
import type { PipelineConfig } from '../src/lib/config.js';

const NOW = new Date(2026, 0, 10, 23, 0, 0); // 23:00 local; deadline 06:30 is 7.5 h away
const nowFn = () => NOW;

function makeConfig(over: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    supabaseUrl: 'https://test.supabase.co',
    supabaseServiceRoleKey: 'k',
    categoryBatchSize: 5,
    knowledgeBatchSize: 10,
    questionsBatchSize: 20,
    claudeModelGeneration: 'g',
    claudeModelVerification: 'v',
    claudeModelAudit: 'a',
    wikipediaUserAgent: 'T',
    wikipediaMaxContentLength: 3000,
    relevanceThreshold: 0.6,
    enableCategoryAgent: false,
    staleRunMs: 7 * 3600 * 1000,
    ...over,
  } as PipelineConfig;
}

function info(util = 0.2, fiveHour = 0.1): RateLimitInfo {
  return {
    status: 'allowed',
    fiveHour: { utilization: fiveHour, resetsAt: null },
    weekly: { seven_day: { utilization: util, resetsAt: Math.floor(NOW.getTime() / 1000) + 3 * 86400 } },
    overageStatus: null,
    isUsingOverage: false,
  };
}

function makeSupabase(runningRows: Array<{ id: string; started_at: string }> = [], guardError?: string) {
  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null }) }),
  });
  const update = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
    in: vi.fn().mockResolvedValue({ error: null }),
  });
  const select = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: guardError ? null : runningRows, error: guardError ? { message: guardError } : null }) }));
  const sb = { from: vi.fn(() => ({ select, insert, update })) };
  return { sb: sb as unknown as RunDeps['supabase'], insert, update };
}

function makeAgents(opts: { questions?: () => Promise<{ processed: number; failed: number }> } = {}) {
  const order: string[] = [];
  const agents = {
    category: vi.fn(async () => (order.push('category'), { processed: 5, failed: 0 })),
    questions: vi.fn(async () => (order.push('questions'), opts.questions ? opts.questions() : { processed: 20, failed: 0 })),
    factCheck: vi.fn(async () => (order.push('fact-check'), { processed: 15, failed: 2 })),
    qa: vi.fn(async () => (order.push('qa'), { processed: 12, failed: 1, rewritten: 3 })),
    enrichment: vi.fn(async () => (order.push('enrichment'), { enriched: 10, skipped: 1, failed: 1 })),
    calibrator: vi.fn(async () => (order.push('calibrator'), { processed: 4, recalibrated: 1, failed: 0 })),
  };
  return { agents: agents as unknown as RunDeps['agents'], raw: agents, order };
}

function deps(over: RunDeps = {}): RunDeps {
  return {
    config: makeConfig(),
    probe: async () => info(),
    now: nowFn,
    env: { RUN_DEADLINE_LOCAL: '06:30' },
    ...over,
  };
}

describe('runPipeline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips when budget < 1 point (no agents, still returns an outcome)', async () => {
    const { sb, insert } = makeSupabase();
    const { agents, raw } = makeAgents();
    // 94.5% used: 0.7*(95-94.5)/3 = 0.12 points
    const o = await runPipeline(deps({ supabase: sb, agents, probe: async () => info(0.945) }));
    expect(o.status).toBe('skipped');
    expect(o.stopReason).toBe('budget under 1 point');
    expect(raw.questions).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(o.budgetPoints).toBeLessThan(1);
  });

  it('skips with the governor reason when it is already stopped at construction', async () => {
    const { sb } = makeSupabase();
    const { agents, raw } = makeAgents();
    const o = await runPipeline(deps({ supabase: sb, agents, probe: async () => info(0.2, 0.9) }));
    expect(o.status).toBe('skipped');
    expect(o.stopReason).toBe('five-hour window');
    expect(raw.questions).not.toHaveBeenCalled();
  });

  it('probe without a frame -> stopped / usage unreadable', async () => {
    const { sb } = makeSupabase();
    const { agents, raw } = makeAgents();
    const o = await runPipeline(deps({ supabase: sb, agents, probe: async () => null }));
    expect(o.status).toBe('stopped');
    expect(o.stopReason).toBe('usage unreadable');
    expect(raw.questions).not.toHaveBeenCalled();
  });

  it('loops until the governor stops, summing counts', async () => {
    const { sb, update } = makeSupabase();
    let n = 0;
    const { agents, order } = makeAgents({
      questions: async () => {
        if (++n === 3) throw new UsageStopError('budget');
        return { processed: 20, failed: 0 };
      },
    });
    const o = await runPipeline(deps({ supabase: sb, agents }));
    expect(o.status).toBe('stopped');
    expect(o.stopReason).toBe('budget');
    expect(o.cycles).toBe(3);
    expect(o.questionsGenerated).toBe(40);
    expect(o.questionsVerified).toBe(30);
    expect(o.questionsRejected).toBe(4);
    expect(o.qaPassed).toBe(24);
    expect(o.qaRejected).toBe(2);
    expect(o.qaRewritten).toBe(6);
    expect(o.enriched).toBe(20);
    expect(o.calibrated).toBe(8);
    expect(order.slice(0, 6)).toEqual(['questions', 'fact-check', 'qa', 'enrichment', 'calibrator', 'questions']);
    // row updated after every cycle (2) and finally (1), with usage in config
    expect(update.mock.calls.length).toBeGreaterThanOrEqual(3);
    const last = update.mock.calls.at(-1)![0];
    expect(last.status).toBe('success');
    expect(last.config).toEqual(expect.objectContaining({ budgetPoints: expect.any(Number), weeklyStart: 20, note: expect.stringContaining('notional') }));
  });

  it('ends with reason "no questions generated" when a cycle generates 0', async () => {
    const { sb } = makeSupabase();
    const { agents } = makeAgents({ questions: async () => ({ processed: 0, failed: 20 }) });
    const o = await runPipeline(deps({ supabase: sb, agents }));
    expect(o.status).toBe('success');
    expect(o.stopReason).toBe('no questions generated');
    expect(o.cycles).toBe(1);
  });

  it('usage stop is status stopped (exit code 0 in the entry block)', async () => {
    const { sb } = makeSupabase();
    const { agents } = makeAgents({ questions: async () => { throw new UsageStopError('weekly ceiling'); } });
    const o = await runPipeline(deps({ supabase: sb, agents }));
    expect(o.status).toBe('stopped');
    expect(o.stopReason).toBe('weekly ceiling');
  });

  it('a non-usage error is status failed with the message and partial work kept', async () => {
    const { sb, update } = makeSupabase();
    const { agents, raw } = makeAgents();
    raw.qa.mockRejectedValueOnce(new Error('QA exploded'));
    const o = await runPipeline(deps({ supabase: sb, agents }));
    expect(o.status).toBe('failed');
    expect(o.questionsGenerated).toBe(20);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error_message: 'QA exploded', questions_generated: 20 }));
  });

  it('never calls process.exit (stubbed to throw) on any path', async () => {
    const spy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit called'); }) as never);
    try {
      const { sb } = makeSupabase();
      const { agents, raw } = makeAgents();
      raw.questions.mockRejectedValueOnce(new Error('boom'));
      const failed = await runPipeline(deps({ supabase: sb, agents }));
      const live = await runPipeline(deps({ supabase: makeSupabase([{ id: 'x', started_at: new Date(NOW.getTime() - 60_000).toISOString() }]).sb, agents }));
      const unreadable = await runPipeline(deps({ supabase: sb, agents, probe: async () => null }));
      const usage = makeAgents({ questions: async () => { throw new UsageStopError('budget'); } });
      const stopped = await runPipeline(deps({ supabase: sb, agents: usage.agents }));
      const zero = makeAgents({ questions: async () => ({ processed: 0, failed: 0 }) });
      const success = await runPipeline(deps({ supabase: sb, agents: zero.agents }));
      const budget = await runPipeline(deps({ supabase: sb, agents, probe: async () => info(0.945) }));
      const cfgThrow = await runPipeline(deps({ config: undefined, loadConfigFn: () => { throw new Error('bad env'); } }));
      expect(failed.status).toBe('failed');
      expect(live.status).toBe('skipped');
      expect(unreadable.status).toBe('stopped');
      expect(stopped.status).toBe('stopped');
      expect(success.status).toBe('success');
      expect(budget.status).toBe('skipped');
      expect(cfgThrow.status).toBe('failed');
      expect(cfgThrow.stopReason).toBe('bad env');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('category agent not run when disabled, run once when enabled', async () => {
    const a1 = makeAgents({ questions: async () => ({ processed: 0, failed: 0 }) });
    await runPipeline(deps({ supabase: makeSupabase().sb, agents: a1.agents }));
    expect(a1.raw.category).not.toHaveBeenCalled();

    const a2 = makeAgents();
    let n = 0;
    a2.raw.questions.mockImplementation((async () => {
      if (++n === 3) throw new UsageStopError('budget');
      return { processed: 20, failed: 0 };
    }) as never);
    await runPipeline(deps({ config: makeConfig({ enableCategoryAgent: true }), supabase: makeSupabase().sb, agents: a2.agents }));
    expect(a2.raw.category).toHaveBeenCalledTimes(1);
    expect(a2.order[0]).toBe('category');
  });

  it('stale running row older than staleRunMs is reclaimed, younger one skips', async () => {
    const stale = new Date(NOW.getTime() - 8 * 3600_000).toISOString(); // > 7 h
    const young = new Date(NOW.getTime() - 6 * 3600_000).toISOString(); // < 7 h (would be stale under old 40 min)

    const s = makeSupabase([{ id: 'old', started_at: stale }]);
    const a = makeAgents({ questions: async () => ({ processed: 0, failed: 0 }) });
    const o1 = await runPipeline(deps({ config: makeConfig({ staleRunMs: 7 * 3600_000 }), supabase: s.sb, agents: a.agents }));
    expect(s.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error_message: expect.stringContaining('stale') }));
    expect(o1.status).toBe('success');

    const y = makeSupabase([{ id: 'young', started_at: young }]);
    const b = makeAgents({ questions: async () => ({ processed: 0, failed: 0 }) });
    const o2 = await runPipeline(deps({ config: makeConfig({ staleRunMs: 7 * 3600_000 }), supabase: y.sb, agents: b.agents }));
    expect(o2.status).toBe('skipped');
    expect(o2.stopReason).toBe('another run in progress');
    expect(b.raw.questions).not.toHaveBeenCalled();
  });

  it('staleRunMs is honoured: the same 6 h row is stale under 1 h and live under 7 h', async () => {
    const row = { id: 'r', started_at: new Date(NOW.getTime() - 6 * 3600_000).toISOString() };
    const s1 = makeSupabase([row]);
    const o1 = await runPipeline(deps({ config: makeConfig({ staleRunMs: 3600_000 }), supabase: s1.sb, agents: makeAgents({ questions: async () => ({ processed: 0, failed: 0 }) }).agents }));
    expect(o1.status).toBe('success');
    expect(s1.update).toHaveBeenCalledWith(expect.objectContaining({ error_message: expect.stringContaining('stale') }));
    const o2 = await runPipeline(deps({ config: makeConfig({ staleRunMs: 7 * 3600_000 }), supabase: makeSupabase([row]).sb, agents: makeAgents({ questions: async () => ({ processed: 0, failed: 0 }) }).agents }));
    expect(o2.status).toBe('skipped');
  });

  it('a guard-select error fails closed: skipped, no agents', async () => {
    const { agents, raw } = makeAgents({ questions: async () => ({ processed: 0, failed: 0 }) });
    const o = await runPipeline(deps({ supabase: makeSupabase([], 'db down').sb, agents }));
    expect(o.status).toBe('skipped');
    expect(o.stopReason).toBe('could not check for running pipeline');
    expect(raw.questions).not.toHaveBeenCalled();
  });

  it('weeklyEnd / fiveHourEnd / consumedPoints come from the last observed frame', async () => {
    const { sb, update } = makeSupabase();
    let n = 0;
    const { agents, raw } = makeAgents();
    raw.questions.mockImplementation((async (_c: unknown, _a: unknown, gov: { observe: (i: RateLimitInfo) => void }) => {
      gov.observe(info(0.25, 0.3));
      if (++n === 2) throw new UsageStopError('budget');
      return { processed: 20, failed: 0 };
    }) as never);
    const o = await runPipeline(deps({ supabase: sb, agents }));
    expect(o.weeklyStart).toBe(20);
    expect(o.weeklyEnd).toBe(25);
    expect(o.fiveHourEnd).toBe(30);
    expect(o.consumedPoints).toBe(5);
    const last = update.mock.calls.at(-1)![0];
    expect(last.config).toEqual(expect.objectContaining({ weeklyEnd: 25, consumedPoints: 5 }));
  });

  it('a failing final pipeline_runs update does not relabel a clean success as failed', async () => {
    const { sb, update } = makeSupabase();
    let calls = 0;
    update.mockImplementation(() => ({
      eq: vi.fn(async () => {
        if (++calls >= 2) throw new Error('db write failed');
        return { error: null };
      }),
      in: vi.fn().mockResolvedValue({ error: null }),
    }));
    const a = makeAgents({ questions: async () => ({ processed: 0, failed: 0 }) });
    const o = await runPipeline(deps({ supabase: sb, agents: a.agents }));
    expect(o.status).toBe('success');
  });

  it('agents receive (config, accumulator, governor) and the yield hook is consulted by the governor', async () => {
    const { sb } = makeSupabase();
    const a = makeAgents({ questions: async () => ({ processed: 0, failed: 0 }) });
    const yieldFn = vi.fn(async () => 'go' as const);
    await runPipeline(deps({ supabase: sb, agents: a.agents, yieldFn }));
    const [cfg, acc, gov] = (a.raw.questions as Mock).mock.calls[0];
    expect(cfg.questionsBatchSize).toBe(20);
    expect(acc).toEqual(expect.objectContaining({ input_tokens: 0 }));
    await gov.beforeCall();
    expect(yieldFn).toHaveBeenCalled();
  });

  it('MAX_CYCLES backstop ends the loop stopped with reason "max cycles" (default 30)', async () => {
    const { sb } = makeSupabase();
    const a = makeAgents();
    const o = await runPipeline(deps({ supabase: sb, agents: a.agents, env: { RUN_DEADLINE_LOCAL: '06:30', MAX_CYCLES: '3' } }));
    expect(o.status).toBe('stopped');
    expect(o.stopReason).toBe('max cycles');
    expect(o.cycles).toBe(3);
    expect(a.raw.questions).toHaveBeenCalledTimes(3);
    const b = makeAgents();
    const d = await runPipeline(deps({ supabase: sb, agents: b.agents }));
    expect(d.stopReason).toBe('max cycles');
    expect(d.cycles).toBe(30);
  });

  it('invalid RUN_DEADLINE_LOCAL fails the run with a clear error', async () => {
    const o = await runPipeline(deps({ supabase: makeSupabase().sb, agents: makeAgents().agents, env: { RUN_DEADLINE_LOCAL: '6.30' } }));
    expect(o.status).toBe('failed');
    expect(o.stopReason).toMatch(/RUN_DEADLINE_LOCAL must be HH:MM/);
  });

  it('records fiveHourStart next to fiveHourEnd, in the outcome and in pipeline_runs.config', async () => {
    const { sb, update } = makeSupabase();
    const { agents } = makeAgents({ questions: async () => ({ processed: 0, failed: 0 }) });
    const o = await runPipeline(deps({ supabase: sb, agents }));
    expect(o.fiveHourStart).toBe(10);
    expect(update.mock.calls.at(-1)![0].config).toEqual(expect.objectContaining({ fiveHourStart: 10, fiveHourEnd: 10 }));
  });

  it('outcome reports start points and resets', async () => {
    const o = await runPipeline(deps({ supabase: makeSupabase().sb, agents: makeAgents({ questions: async () => ({ processed: 0, failed: 0 }) }).agents }));
    expect(o.weeklyStart).toBe(20);
    expect(o.fiveHourEnd).toBe(10);
    expect(o.weeklyResetsAt).toBe(Math.floor(NOW.getTime() / 1000) + 3 * 86400);
    expect(o.runId).toBe('run-1');
  });
});

describe('writeSummary', () => {
  it('writes JSON to the given path and is a no-op without one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rs-'));
    try {
    const f = join(dir, 's.json');
    const o = await runPipeline(deps({ supabase: makeSupabase().sb, probe: async () => null }));
    writeSummary(o, f);
    expect(JSON.parse(readFileSync(f, 'utf8')).stopReason).toBe('usage unreadable');
    expect(() => writeSummary(o, undefined)).not.toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('main (entry block body)', () => {
  const savedCode = process.exitCode;
  const savedEnv = process.env.RUN_SUMMARY_FILE;
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'main-'));
    file = join(dir, 'summary.json');
    process.env.RUN_SUMMARY_FILE = file;
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = savedCode;
    if (savedEnv === undefined) delete process.env.RUN_SUMMARY_FILE;
    else process.env.RUN_SUMMARY_FILE = savedEnv;
    rmSync(dir, { recursive: true, force: true });
  });
  const summary = () => JSON.parse(readFileSync(file, 'utf8'));

  it('stopped -> exitCode 0, summary written', async () => {
    const a = makeAgents({ questions: async () => { throw new UsageStopError('budget'); } });
    await main(deps({ supabase: makeSupabase().sb, agents: a.agents }));
    expect(process.exitCode).toBe(0);
    expect(summary().status).toBe('stopped');
  });

  it('failed -> exitCode 1, summary written', async () => {
    const a = makeAgents({ questions: async () => { throw new Error('boom'); } });
    await main(deps({ supabase: makeSupabase().sb, agents: a.agents }));
    expect(process.exitCode).toBe(1);
    expect(summary().status).toBe('failed');
  });

  it('skipped -> exitCode 0, summary written', async () => {
    await main(deps({ supabase: makeSupabase().sb, agents: makeAgents().agents, probe: async () => info(0.945) }));
    expect(process.exitCode).toBe(0);
    expect(summary().status).toBe('skipped');
  });

  it('an unexpected rejection still writes a minimal failed summary and exits 1', async () => {
    await main({}, async () => { throw new Error('kaboom'); });
    expect(process.exitCode).toBe(1);
    expect(existsSync(file)).toBe(true);
    expect(summary()).toEqual(expect.objectContaining({ status: 'failed', stopReason: 'kaboom' }));
  });
});

describe('yieldFromCommand', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yc-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  async function script(code: number | string) {
    const { writeFileSync, chmodSync } = await import('node:fs');
    const p = join(dir, `s${code}.sh`);
    writeFileSync(p, `#!/bin/sh\nexit ${code}\n`);
    chmodSync(p, 0o755);
    return p;
  }

  it('maps exit 0/1/2/other to go/wait/stop/wait', async () => {
    expect(await yieldFromCommand(await script(0))()).toBe('go');
    expect(await yieldFromCommand(await script(1))()).toBe('wait');
    expect(await yieldFromCommand(await script(2))()).toBe('stop');
    expect(await yieldFromCommand(await script(7))()).toBe('wait');
  });

  it('a command exceeding the timeout maps to wait', async () => {
    const { writeFileSync, chmodSync } = await import('node:fs');
    const p = join(dir, 'slow.sh');
    writeFileSync(p, '#!/bin/sh\nexec sleep 5\n');
    chmodSync(p, 0o755);
    const t0 = Date.now();
    expect(await yieldFromCommand(p, 100)()).toBe('wait');
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('spawn failure (ENOENT) maps to stop with an error log, not a silent wait', async () => {
    const { log } = await import('../src/lib/logger.js');
    vi.mocked(log).mockClear();
    expect(await yieldFromCommand(join(dir, 'missing'))()).toBe('stop');
    expect(vi.mocked(log)).toHaveBeenCalledWith('error', 'yield hook unusable: ENOENT');
  });

  it('a non-executable hook (EACCES) maps to stop', async () => {
    const { writeFileSync } = await import('node:fs');
    const p = join(dir, 'noexec.sh');
    writeFileSync(p, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
    expect(await yieldFromCommand(p)()).toBe('stop');
  });

  it('an unusable hook ends the run as paused via the governor', async () => {
    const { sb } = makeSupabase();
    const { agents, raw } = makeAgents();
    raw.questions.mockImplementation((async (_c: unknown, _a: unknown, gov: { beforeCall: () => Promise<void> }) => {
      await gov.beforeCall();
      return { processed: 1, failed: 0 };
    }) as never);
    const o = await runPipeline(deps({
      supabase: sb, agents,
      env: { RUN_DEADLINE_LOCAL: '06:30', PIPELINE_YIELD_CMD: join(dir, 'missing') },
    }));
    expect(o.status).toBe('stopped');
    expect(o.stopReason).toBe('paused');
  });
});
