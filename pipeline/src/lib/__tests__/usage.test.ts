import { describe, it, expect } from 'vitest';
import {
  parseRateLimitEvent,
  governorConfigFromEnv,
  nightBudgetPoints,
  UsageGovernor,
  UsageStopError,
  type RateLimitInfo,
  type GovernorConfig,
} from '../usage.js';

const MEASURED_FRAME = {
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    resetsAt: 1792966200,
    rateLimitType: 'five_hour',
    overageStatus: 'rejected',
    overageDisabledReason: 'out_of_credits',
    isUsingOverage: false,
    unifiedWindows: {
      five_hour: { utilization: 0.06, resetsAt: 1792966200 },
      seven_day: { utilization: 0.02, resetsAt: 1793379600 },
    },
  },
  uuid: 'e53c4d7b-98d0-42c0-9979-1ac3e7cba86f',
  session_id: 'ac80a19b-f6bc-4c30-a3af-16ea29025b7b',
};

const NOW = new Date('2026-10-26T22:00:00Z');
const DEADLINE = new Date('2026-10-27T06:30:00Z');
const LATE_CUTOFF = new Date('2026-10-27T07:00:00Z');
const WEEK_RESET = Math.floor(NOW.getTime() / 1000) + 3 * 86_400;
const EARLY_RESET = Math.floor(NOW.getTime() / 1000) + 3600; // before the late cutoff

const CFG: GovernorConfig = {
  weeklyCeiling: 95,
  share: 0.7,
  fiveHourCeiling: 50,
  fiveHourCeilingLate: 30,
  deadline: DEADLINE,
  lateCutoff: LATE_CUTOFF,
  maxRunHours: 10,
};

function info(over: {
  status?: string;
  week?: number;
  weekReset?: number;
  five?: number | null;
  fiveReset?: number;
  extra?: Record<string, { utilization: number; resetsAt: number | null }>;
  overageStatus?: string | null;
  isUsingOverage?: boolean;
} = {}): RateLimitInfo {
  return {
    status: over.status ?? 'allowed',
    fiveHour:
      over.five === null
        ? null
        : { utilization: over.five ?? 0.05, resetsAt: over.fiveReset ?? EARLY_RESET },
    weekly: {
      seven_day: { utilization: over.week ?? 0.1, resetsAt: over.weekReset ?? WEEK_RESET },
      ...(over.extra ?? {}),
    },
    overageStatus: over.overageStatus ?? 'rejected',
    isUsingOverage: over.isUsingOverage ?? false,
  };
}

function gov(
  start: RateLimitInfo,
  opts: ConstructorParameters<typeof UsageGovernor>[2] = {},
  cfg: GovernorConfig = CFG,
) {
  return new UsageGovernor(start, cfg, { now: () => NOW, budgetPoints: 1000, ...opts });
}

describe('parseRateLimitEvent', () => {
  it('parses the measured frame', () => {
    const r = parseRateLimitEvent(MEASURED_FRAME)!;
    expect(r.status).toBe('allowed');
    expect(r.fiveHour).toEqual({ utilization: 0.06, resetsAt: 1792966200 });
    expect(r.weekly).toEqual({ seven_day: { utilization: 0.02, resetsAt: 1793379600 } });
    expect(r.overageStatus).toBe('rejected');
    expect(r.isUsingOverage).toBe(false);
  });

  it('collects every seven_day* window', () => {
    const frame = structuredClone(MEASURED_FRAME);
    (frame.rate_limit_info.unifiedWindows as Record<string, unknown>).seven_day_opus = {
      utilization: 0.4,
      resetsAt: 1793379600,
    };
    const r = parseRateLimitEvent(frame)!;
    expect(Object.keys(r.weekly).sort()).toEqual(['seven_day', 'seven_day_opus']);
    expect(r.weekly.seven_day_opus.utilization).toBe(0.4);
  });

  it('returns null for non rate-limit frames', () => {
    expect(parseRateLimitEvent({ type: 'assistant', message: {} })).toBeNull();
    expect(parseRateLimitEvent(null)).toBeNull();
    expect(parseRateLimitEvent('x')).toBeNull();
  });
});

describe('governorConfigFromEnv', () => {
  it('uses defaults and the next occurrence of the local times', () => {
    const now = new Date(2026, 9, 26, 22, 0, 0); // local
    const cfg = governorConfigFromEnv(now, {});
    expect(cfg.weeklyCeiling).toBe(95);
    expect(cfg.share).toBe(0.7);
    expect(cfg.fiveHourCeiling).toBe(50);
    expect(cfg.fiveHourCeilingLate).toBe(30);
    expect(cfg.deadline).toEqual(new Date(2026, 9, 27, 6, 30, 0));
    expect(cfg.lateCutoff).toEqual(new Date(2026, 9, 27, 7, 0, 0));
  });

  it('reads overrides from env', () => {
    const now = new Date(2026, 9, 26, 1, 0, 0);
    const cfg = governorConfigFromEnv(now, {
      USAGE_SHARE: '0.5',
      USAGE_WEEKLY_CEILING: '90',
      RUN_DEADLINE_LOCAL: '05:15',
    });
    expect(cfg.share).toBe(0.5);
    expect(cfg.weeklyCeiling).toBe(90);
    expect(cfg.deadline).toEqual(new Date(2026, 9, 26, 5, 15, 0));
  });
});

describe('fail-closed parsing', () => {
  const frameWith = (windows: unknown) => ({
    type: 'rate_limit_event',
    rate_limit_info: { status: 'allowed', unifiedWindows: windows },
  });
  const ok = { utilization: 0.1, resetsAt: 1 };
  it.each([
    ['string utilisation', 'abc'],
    ['negative', -0.1],
    ['above 1', 1.5],
    ['Infinity', Infinity],
    ['NaN', NaN],
  ])('invalid seven_day (%s) is unreadable', (_n, u) => {
    expect(parseRateLimitEvent(frameWith({ seven_day: { utilization: u, resetsAt: 1 } }))).toBeNull();
  });
  it('invalid five_hour makes the frame unreadable', () => {
    expect(parseRateLimitEvent(frameWith({ five_hour: { utilization: 2, resetsAt: 1 }, seven_day: ok }))).toBeNull();
  });
  it('non-finite resetsAt is unreadable', () => {
    expect(parseRateLimitEvent(frameWith({ seven_day: { utilization: 0.1, resetsAt: Infinity } }))).toBeNull();
  });
  it('missing five_hour is allowed', () => {
    expect(parseRateLimitEvent(frameWith({ seven_day: ok }))!.fiveHour).toBeNull();
  });
});

describe('weekly window required', () => {
  const noWeek = (): RateLimitInfo => ({ ...info(), weekly: {} });
  it('missing at start: budget 0 and start stops', () => {
    expect(nightBudgetPoints(noWeek(), NOW, CFG)).toBe(0);
    expect(new UsageGovernor(noWeek(), CFG, { now: () => NOW }).stopReason()).toBe('usage unreadable');
  });
  it('present at start then missing: unreadable, consumed never negative', () => {
    const g = gov(info({ week: 0.4 }));
    g.observe(noWeek());
    expect(g.stopReason()).toBe('usage unreadable');
    expect(g.consumedPoints).toBe(0);
  });
});

describe('nightBudgetPoints fail-closed reset', () => {
  it('null resetsAt gives 0', () => {
    const s = info({ week: 0.1 });
    s.weekly.seven_day.resetsAt = null;
    expect(nightBudgetPoints(s, NOW, CFG)).toBe(0);
  });
  it('past or equal resetsAt gives 0', () => {
    const t = Math.floor(NOW.getTime() / 1000);
    expect(nightBudgetPoints(info({ weekReset: t - 10 }), NOW, CFG)).toBe(0);
    expect(nightBudgetPoints(info({ weekReset: t }), NOW, CFG)).toBe(0);
  });
  it('N boundary: exactly 3d is 3, 3d+1s is 4', () => {
    const t = Math.floor(NOW.getTime() / 1000);
    const c = { ...CFG, share: 1.0 };
    expect(nightBudgetPoints(info({ week: 0.65, weekReset: t + 3 * 86_400 }), NOW, c)).toBe(10);
    expect(nightBudgetPoints(info({ week: 0.65, weekReset: t + 3 * 86_400 + 1 }), NOW, c)).toBe(7.5);
  });
});

describe('run window', () => {
  const at = (h: number, m: number) => new Date(2026, 9, 26, h, m, 0);
  const govAt = (now: Date) => {
    const cfg = governorConfigFromEnv(now, {});
    return { cfg, g: new UsageGovernor(info(), cfg, { now: () => now, budgetPoints: 1000 }) };
  };
  it('06:45 is outside', () => expect(govAt(at(6, 45)).g.stopReason()).toBe('outside run window'));
  it('00:40 is fine', () => expect(govAt(at(0, 40)).g.stopReason()).toBeNull());
  it('19:00 is outside', () => expect(govAt(at(19, 0)).g.stopReason()).toBe('outside run window'));
  it('20:30 (exactly 10h) is allowed; 20:29 is outside', () => {
    expect(govAt(at(20, 30)).g.stopReason()).toBeNull();
    expect(govAt(at(20, 29)).g.stopReason()).toBe('outside run window');
  });
  it('deadline and lateCutoff are the same morning', () => {
    for (const [h, m] of [[6, 45], [6, 29], [6, 30], [7, 0], [7, 1], [0, 0], [23, 59]]) {
      const { cfg } = govAt(at(h, m));
      expect(cfg.lateCutoff.getTime() - cfg.deadline.getTime()).toBe(30 * 60_000);
    }
  });
  it('RUN_MAX_HOURS overrides', () => {
    expect(governorConfigFromEnv(at(0, 0), { RUN_MAX_HOURS: '4' }).maxRunHours).toBe(4);
  });
});

describe('computed budget (no budgetPoints option)', () => {
  it('computes 7 and stops on it', () => {
    const start = info({ week: 0.65 });
    const g = new UsageGovernor(start, CFG, { now: () => NOW });
    expect(g.budgetPoints).toBe(7);
    g.observe(info({ week: 0.71 }));
    expect(g.stopReason()).toBeNull();
    g.observe(info({ week: 0.72 }));
    expect(g.consumedPoints).toBe(7);
    expect(g.stopReason()).toBe('budget');
  });
});

describe('nightBudgetPoints', () => {
  it("jamie's worked example", () => {
    const start = info({ week: 0.65 });
    expect(nightBudgetPoints(start, NOW, { ...CFG, share: 1.0 })).toBe(10);
    expect(nightBudgetPoints(start, NOW, CFG)).toBe(7);
  });

  it('last night N=1', () => {
    const start = info({ week: 0.65, weekReset: Math.floor(NOW.getTime() / 1000) + 3600 });
    expect(nightBudgetPoints(start, NOW, { ...CFG, share: 1.0 })).toBe(30);
  });

  it('over ceiling gives 0', () => {
    expect(nightBudgetPoints(info({ week: 0.97 }), NOW, CFG)).toBe(0);
  });
});

describe('UsageGovernor stopReason', () => {
  it('is null when healthy', () => {
    expect(gov(info()).stopReason()).toBeNull();
  });

  it('budget stop', () => {
    const g = gov(info({ week: 0.1 }), { budgetPoints: 5 });
    g.observe(info({ week: 0.14 }));
    expect(g.stopReason()).toBeNull();
    g.observe(info({ week: 0.15 }));
    expect(g.consumedPoints).toBe(5);
    expect(g.stopReason()).toBe('budget');
  });

  it('weekly ceiling', () => {
    const g = gov(info({ week: 0.1 }));
    g.observe(info({ week: 0.95 }));
    expect(g.stopReason()).toBe('weekly ceiling');
  });

  it('weekly ceiling via seven_day_opus', () => {
    const g = gov(info({ week: 0.1 }));
    g.observe(info({ week: 0.1, extra: { seven_day_opus: { utilization: 0.96, resetsAt: WEEK_RESET } } }));
    expect(g.stopReason()).toBe('weekly ceiling');
  });

  it('five-hour 50', () => {
    const g = gov(info());
    g.observe(info({ five: 0.49 }));
    expect(g.stopReason()).toBeNull();
    g.observe(info({ five: 0.5 }));
    expect(g.stopReason()).toBe('five-hour window');
  });

  it('late ceiling 30', () => {
    const late = LATE_CUTOFF.getTime() / 1000 + 60;
    const g = gov(info());
    g.observe(info({ five: 0.35, fiveReset: EARLY_RESET }));
    expect(g.stopReason()).toBeNull();
    g.observe(info({ five: 0.35, fiveReset: late }));
    expect(g.stopReason()).toBe('five-hour window');
  });

  it('null five-hour window counts as 0', () => {
    const g = gov(info());
    g.observe(info({ five: null }));
    expect(g.stopReason()).toBeNull();
  });

  it('deadline', () => {
    let t = NOW;
    const g = gov(info(), { now: () => t });
    expect(g.stopReason()).toBeNull();
    t = DEADLINE;
    expect(g.stopReason()).toBe('deadline');
  });

  it('usage unreadable', () => {
    const g = gov(info());
    g.observe(null);
    expect(g.stopReason()).toBe('usage unreadable');
  });

  it('weekly reset', () => {
    const g = gov(info({ week: 0.4 }));
    g.observe(info({ week: 0.41, weekReset: WEEK_RESET + 604_800 }));
    expect(g.stopReason()).toBe('weekly reset');
    const h = gov(info({ week: 0.4 }));
    h.observe(info({ week: 0.01 }));
    expect(h.stopReason()).toBe('weekly reset');
  });

  it('allowed_warning continues', () => {
    const g = gov(info());
    g.observe(info({ status: 'allowed_warning' }));
    expect(g.stopReason()).toBeNull();
  });

  it('rejected stops', () => {
    const g = gov(info());
    g.observe(info({ status: 'rejected' }));
    expect(g.stopReason()).toBe('rate limited (rejected)');
  });

  it('overage allowed stops', () => {
    const g = gov(info());
    g.observe(info({ overageStatus: 'allowed' }));
    expect(g.stopReason()).toBe('overage');
    const h = gov(info());
    h.observe(info({ isUsingOverage: true }));
    expect(h.stopReason()).toBe('overage');
  });

  it('start already over five-hour ceiling stops before any call', async () => {
    const g = gov(info({ five: 0.6 }));
    expect(g.stopReason()).toBe('five-hour window');
    await expect(g.beforeCall()).rejects.toThrow(UsageStopError);
  });
});

describe('UsageGovernor beforeCall', () => {
  it('wait twice then go', async () => {
    const answers = ['wait', 'wait', 'go'] as const;
    let i = 0;
    let sleeps = 0;
    const g = gov(info(), {
      yieldFn: async () => answers[i++],
      sleep: async (ms) => {
        expect(ms).toBe(60_000);
        sleeps++;
      },
    });
    await g.beforeCall();
    expect(sleeps).toBe(2);
  });

  it('stop gives paused', async () => {
    const g = gov(info(), { yieldFn: async () => 'stop' });
    await expect(g.beforeCall()).rejects.toMatchObject({ reason: 'paused' });
  });

  it('throwing yieldFn becomes a stop error', async () => {
    const g = gov(info(), { yieldFn: async () => { throw new Error('boom'); } });
    await expect(g.beforeCall()).rejects.toMatchObject({ reason: 'yield error: boom' });
  });

  it('unrecognised yield result is treated as stop', async () => {
    const g = gov(info(), { yieldFn: async () => 'maybe' as never });
    await expect(g.beforeCall()).rejects.toMatchObject({ reason: 'paused' });
  });

  it('wait past deadline gives yield: deadline', async () => {
    let t = new Date(DEADLINE.getTime() - 90_000);
    const g = gov(info(), {
      now: () => t,
      yieldFn: async () => 'wait',
      sleep: async (ms) => {
        t = new Date(t.getTime() + ms);
      },
    });
    const err = await g.beforeCall().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageStopError);
    expect((err as UsageStopError).reason).toBe('yield: deadline');
  });
});

describe('UsageGovernor.lastInfo', () => {
  it('is the start frame until observe() replaces it', () => {
    const mk = (u: number): RateLimitInfo => ({
      status: 'allowed',
      fiveHour: null,
      weekly: { seven_day: { utilization: u, resetsAt: 1793379600 } },
      overageStatus: null,
      isUsingOverage: false,
    });
    const cfg: GovernorConfig = {
      weeklyCeiling: 95, share: 0.7, fiveHourCeiling: 50, fiveHourCeilingLate: 30,
      deadline: new Date(NOW.getTime() + 3_600_000), lateCutoff: new Date(NOW.getTime() + 7_200_000), maxRunHours: 10,
    };
    const start = mk(0.1);
    const g = new UsageGovernor(start, cfg, { now: () => NOW });
    expect(g.lastInfo).toBe(start);
    const next = mk(0.15);
    g.observe(next);
    expect(g.lastInfo).toBe(next);
    g.observe(null);
    expect(g.lastInfo).toBeNull();
  });
});

describe('governorConfigFromEnv time validation', () => {
  const now = new Date(2026, 9, 26, 22, 0, 0);
  it('rejects invalid HH:MM instead of yielding an Invalid Date', () => {
    for (const bad of ['6.30', '25:00', '06:60', 'abc', '6:5', '24:00']) {
      expect(() => governorConfigFromEnv(now, { RUN_DEADLINE_LOCAL: bad })).toThrow(/RUN_DEADLINE_LOCAL/);
      expect(() => governorConfigFromEnv(now, { RUN_LATE_CUTOFF_LOCAL: bad })).toThrow(/RUN_LATE_CUTOFF_LOCAL/);
    }
  });
  it('accepts valid edge values', () => {
    expect(governorConfigFromEnv(now, { RUN_DEADLINE_LOCAL: '00:00' }).deadline).toEqual(new Date(2026, 9, 27, 0, 0, 0));
    expect(governorConfigFromEnv(now, { RUN_DEADLINE_LOCAL: '6:30' }).deadline).toEqual(new Date(2026, 9, 27, 6, 30, 0));
    expect(governorConfigFromEnv(now, { RUN_DEADLINE_LOCAL: '23:59' }).deadline).toEqual(new Date(2026, 9, 26, 23, 59, 0));
  });
});

describe('UsageGovernor stuck-meter guard (USAGE_STUCK_USD)', () => {
  const stuckCfg = (usd?: number): GovernorConfig => ({ ...CFG, ...(usd === undefined ? {} : { stuckMeterUsd: usd }) });
  it('is off by default (unset and 0 from env)', () => {
    expect(governorConfigFromEnv(NOW, {}).stuckMeterUsd).toBe(0);
    const g = gov(info(), {}, stuckCfg());
    g.noteCost(1000);
    g.observe(info());
    expect(g.stopReason()).toBeNull();
    const h = gov(info(), {}, stuckCfg(0));
    h.noteCost(1000);
    expect(h.stopReason()).toBeNull();
  });
  it('reads USAGE_STUCK_USD from env', () => {
    expect(governorConfigFromEnv(NOW, { USAGE_STUCK_USD: '3.5' }).stuckMeterUsd).toBe(3.5);
  });
  it('stops with "usage not moving" once cost since the last move exceeds the limit', () => {
    const g = gov(info({ week: 0.1 }), {}, stuckCfg(2));
    g.noteCost(1.5);
    g.observe(info({ week: 0.1 }));
    expect(g.stopReason()).toBeNull();
    g.noteCost(1);
    g.observe(info({ week: 0.1 }));
    expect(g.stopReason()).toBe('usage not moving');
  });
  it('a change in seven_day utilisation resets the counter', () => {
    const g = gov(info({ week: 0.1 }), {}, stuckCfg(2));
    g.noteCost(1.9);
    g.observe(info({ week: 0.1 }));
    g.noteCost(1.9); // would be 3.8 without a move
    g.observe(info({ week: 0.11 }));
    expect(g.stopReason()).toBeNull();
    g.noteCost(1.9);
    g.observe(info({ week: 0.11 }));
    expect(g.stopReason()).toBeNull();
    g.noteCost(0.2);
    g.observe(info({ week: 0.11 }));
    expect(g.stopReason()).toBe('usage not moving');
  });
});
