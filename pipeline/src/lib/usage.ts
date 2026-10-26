/**
 * Usage governor: paces how much weekly Claude usage a nightly run may spend.
 * Reads the `rate_limit_event` frames emitted by
 * `claude -p --output-format stream-json --verbose`. Utilisation is a 0-1 fraction.
 *
 * Fails CLOSED: the weekly `seven_day` window is always required (missing => unreadable,
 * budget 0); a missing `five_hour` window counts as 0 but a present-and-invalid window makes
 * the whole frame unreadable; a run whose deadline is further away than `maxRunHours` is
 * outside its window and stops immediately.
 */

export interface UsageWindow {
  utilization: number;
  resetsAt: number | null;
}

export interface RateLimitInfo {
  status: string;
  fiveHour: UsageWindow | null;
  /** Every unifiedWindows key starting "seven_day". */
  weekly: Record<string, UsageWindow>;
  overageStatus: string | null;
  isUsingOverage: boolean;
}

export interface GovernorConfig {
  weeklyCeiling: number;
  share: number;
  fiveHourCeiling: number;
  fiveHourCeilingLate: number;
  deadline: Date;
  lateCutoff: Date;
  /** A run starting when the next deadline is more than this many hours away is outside its window. */
  maxRunHours: number;
  /**
   * Optional stuck-meter guard (USAGE_STUCK_USD). When > 0 and the notional API-equivalent
   * cost accumulated since `seven_day` utilisation last CHANGED exceeds it, stopReason() returns
   * 'usage not moving' (a meter that never moves would otherwise disable the budget stop).
   * Default 0 = OFF: the right value needs calibrating against real runs (Task 9).
   */
  stuckMeterUsd?: number;
}

export type YieldResult = 'go' | 'wait' | 'stop';

const OK_STATUSES = new Set(['allowed', 'allowed_warning']);
const DAY_MS = 86_400_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Strict: utilisation must be a finite 0-1 number, resetsAt finite or absent/null. Invalid => undefined. */
function parseWindow(v: unknown): UsageWindow | undefined {
  if (!isRecord(v)) return undefined;
  const u = v.utilization;
  if (typeof u !== 'number' || !Number.isFinite(u) || u < 0 || u > 1) return undefined;
  const r = v.resetsAt;
  if (r === undefined || r === null) return { utilization: u, resetsAt: null };
  if (typeof r !== 'number' || !Number.isFinite(r)) return undefined;
  return { utilization: u, resetsAt: r };
}

export function parseRateLimitEvent(frame: unknown): RateLimitInfo | null {
  if (!isRecord(frame) || frame.type !== 'rate_limit_event') return null;
  const rli = frame.rate_limit_info;
  if (!isRecord(rli) || typeof rli.status !== 'string') return null;
  const windows = isRecord(rli.unifiedWindows) ? rli.unifiedWindows : {};
  const weekly: Record<string, UsageWindow> = {};
  for (const [key, value] of Object.entries(windows)) {
    if (!key.startsWith('seven_day')) continue;
    const w = parseWindow(value);
    if (!w) return null;
    weekly[key] = w;
  }
  let fiveHour: UsageWindow | null = null;
  if (windows.five_hour !== undefined) {
    const f = parseWindow(windows.five_hour);
    if (!f) return null;
    fiveHour = f;
  }
  return {
    status: rli.status,
    fiveHour,
    weekly,
    overageStatus: typeof rli.overageStatus === 'string' ? rli.overageStatus : null,
    isUsingOverage: rli.isUsingOverage === true,
  };
}

/** Next occurrence strictly after `now` of a local "HH:MM" time. */
function nextLocalTime(now: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

/** Strict "HH:MM" (00:00-23:59). Throws a clear error rather than yielding an Invalid Date. */
function parseHhmm(name: string, raw: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    throw new Error(`${name} must be HH:MM (00:00-23:59), got "${raw}"`);
  }
  return raw;
}

function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function governorConfigFromEnv(
  now: Date,
  env: Record<string, string | undefined> = process.env,
): GovernorConfig {
  const deadline = nextLocalTime(now, parseHhmm('RUN_DEADLINE_LOCAL', env.RUN_DEADLINE_LOCAL || '06:30'));
  return {
    weeklyCeiling: num(env.USAGE_WEEKLY_CEILING, 95),
    share: num(env.USAGE_SHARE, 0.7),
    fiveHourCeiling: num(env.USAGE_FIVE_HOUR_CEILING, 50),
    fiveHourCeilingLate: num(env.USAGE_FIVE_HOUR_CEILING_LATE, 30),
    deadline,
    // First late-cutoff time after the deadline's own morning, so the two never straddle.
    lateCutoff: nextLocalTime(new Date(deadline.getTime() - 1), parseHhmm('RUN_LATE_CUTOFF_LOCAL', env.RUN_LATE_CUTOFF_LOCAL || '07:00')),
    maxRunHours: num(env.RUN_MAX_HOURS, 10),
    stuckMeterUsd: num(env.USAGE_STUCK_USD, 0),
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function nightBudgetPoints(start: RateLimitInfo, now: Date, cfg: GovernorConfig): number {
  // Fail closed: no weekly window, or no usable future reset time => no budget tonight.
  const w = start.weekly.seven_day;
  if (!w || w.resetsAt == null || w.resetsAt * 1000 <= now.getTime()) return 0;
  const n = Math.max(1, Math.ceil((w.resetsAt * 1000 - now.getTime()) / DAY_MS));
  const points = (cfg.share * (cfg.weeklyCeiling - 100 * w.utilization)) / n;
  return round2(Math.max(0, points));
}

export class UsageStopError extends Error {
  constructor(public reason: string) {
    super(`usage stop: ${reason}`);
    this.name = 'UsageStopError';
  }
}

interface GovernorOpts {
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  yieldFn?: () => Promise<YieldResult>;
  budgetPoints?: number;
}

export class UsageGovernor {
  private _budgetPoints: number;
  private _consumedPoints = 0;
  private last: RateLimitInfo | null;
  private lastSevenDay: number | null;
  private costSinceMove = 0;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly yieldFn: () => Promise<YieldResult>;

  constructor(
    private readonly start: RateLimitInfo,
    private readonly cfg: GovernorConfig,
    opts: GovernorOpts = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.yieldFn = opts.yieldFn ?? (async () => 'go');
    this._budgetPoints = opts.budgetPoints ?? nightBudgetPoints(start, this.now(), cfg);
    this.last = start;
    this.lastSevenDay = start.weekly.seven_day?.utilization ?? null;
  }

  /** Feed the notional cost of a completed call (call BEFORE observe(), so a call that moves the meter resets the counter). */
  noteCost(usd: number): void {
    if (Number.isFinite(usd) && usd > 0) this.costSinceMove += usd;
  }

  get budgetPoints(): number {
    return this._budgetPoints;
  }

  get consumedPoints(): number {
    return this._consumedPoints;
  }

  /** The most recently observed rate-limit frame (the start frame until observe() is called). */
  get lastInfo(): RateLimitInfo | null {
    return this.last;
  }

  observe(info: RateLimitInfo | null): void {
    this.last = info;
    const s = this.start.weekly.seven_day;
    const n = info?.weekly.seven_day;
    if (!s || !n) return; // unreadable: stopReason() reports it
    if (n.utilization !== this.lastSevenDay) {
      this.lastSevenDay = n.utilization;
      this.costSinceMove = 0;
    }
    this._consumedPoints = round2(100 * (n.utilization - s.utilization));
  }

  stopReason(): string | null {
    const info = this.last;
    const sw = this.start.weekly.seven_day;
    const nw = info?.weekly.seven_day;
    if (!info || !sw || !nw) return 'usage unreadable';
    const windowMs = this.cfg.maxRunHours * 3_600_000;
    if (this.cfg.deadline.getTime() - this.now().getTime() > windowMs) return 'outside run window';
    if (!OK_STATUSES.has(info.status)) return `rate limited (${info.status})`;
    if (info.isUsingOverage || info.overageStatus === 'allowed') return 'overage';

    if ((nw.resetsAt !== sw.resetsAt || nw.utilization < sw.utilization)) {
      return 'weekly reset';
    }
    const ceil = this.cfg.weeklyCeiling / 100;
    if (Object.values(info.weekly).some((w) => w.utilization >= ceil)) return 'weekly ceiling';
    if (this._consumedPoints >= this._budgetPoints) return 'budget';
    const stuck = this.cfg.stuckMeterUsd ?? 0;
    if (stuck > 0 && this.costSinceMove > stuck) return 'usage not moving';

    const fh = info.fiveHour;
    const late = fh?.resetsAt != null && fh.resetsAt * 1000 > this.cfg.lateCutoff.getTime();
    const fhCeil = (late ? this.cfg.fiveHourCeilingLate : this.cfg.fiveHourCeiling) / 100;
    if ((fh?.utilization ?? 0) >= fhCeil) return 'five-hour window';

    if (this.now().getTime() >= this.cfg.deadline.getTime()) return 'deadline';
    return null;
  }

  async beforeCall(): Promise<void> {
    for (;;) {
      const reason = this.stopReason();
      if (reason) throw new UsageStopError(reason);
      let y: YieldResult;
      try {
        y = await this.yieldFn();
      } catch (e) {
        throw new UsageStopError(`yield error: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (y === 'go') return;
      if (y !== 'wait') throw new UsageStopError('paused'); // 'stop' or anything unrecognised
      await this.sleep(60_000);
      if (this.now().getTime() >= this.cfg.deadline.getTime()) {
        throw new UsageStopError('yield: deadline');
      }
    }
  }
}
