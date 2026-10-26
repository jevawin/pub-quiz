import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../claude-cli.js', async () => {
  const actual = await vi.importActual<typeof import('../claude-cli.js')>('../claude-cli.js');
  return { ...actual, callClaude: vi.fn() };
});

import { callClaude, ClaudeCallError } from '../claude-cli.js';
import { callGoverned, createTokenAccumulator, directCaller } from '../claude.js';
import { UsageStopError } from '../usage.js';
import { log } from '../logger.js';
import type { RateLimitInfo } from '../usage.js';

vi.mock('../logger.js', () => ({ log: vi.fn() }));

const mocked = vi.mocked(callClaude);

function rl(util: number, status = 'allowed'): RateLimitInfo {
  return {
    status,
    fiveHour: null,
    weekly: { seven_day: { utilization: util, resetsAt: 2_000_000_000 } },
    overageStatus: null,
    isUsingOverage: false,
  };
}

function fakeGov(opts: { stop?: () => string | null; before?: () => Promise<void> } = {}) {
  return {
    beforeCall: vi.fn(opts.before ?? (async () => {})),
    observe: vi.fn(),
    noteCost: vi.fn(),
    consumedPoints: 1.5,
    budgetPoints: 10,
    stopReason: vi.fn(opts.stop ?? (() => null)),
  };
}

describe('callGoverned', () => {
  beforeEach(() => { mocked.mockReset(); vi.mocked(log).mockClear(); });

  it('logs one info line per successful call and feeds the cost to the governor before observe', async () => {
    mocked.mockResolvedValue({
      text: 'x',
      rateLimit: { ...rl(0.123), fiveHour: { utilization: 0.4, resetsAt: null } },
      inputTokens: 1, outputTokens: 1, costUsd: 0.5,
    });
    const gov = fakeGov();
    await callGoverned({ model: 'sonnet', prompt: 'p' }, createTokenAccumulator(), gov as never);
    expect(gov.noteCost).toHaveBeenCalledWith(0.5);
    expect(gov.noteCost.mock.invocationCallOrder[0]).toBeLessThan(gov.observe.mock.invocationCallOrder[0]);
    const calls = vi.mocked(log).mock.calls.filter((c) => c[1] === 'Claude call');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][2]).toEqual({
      model: 'sonnet', sevenDay: 12.3, fiveHour: 40, consumedPoints: 1.5, budgetPoints: 10, notionalCostUsd: 0.5,
    });
  });

  it('logs the reason when beforeCall stops the run', async () => {
    const gov = fakeGov({ before: async () => { throw new UsageStopError('budget'); } });
    await expect(callGoverned({ model: 'sonnet', prompt: 'p' }, createTokenAccumulator(), gov as never)).rejects.toThrow();
    expect(vi.mocked(log)).toHaveBeenCalledWith('info', 'Usage stop before call', { reason: 'budget' });
  });

  it('asks the governor first, accumulates tokens and cost, and observes the rate limit', async () => {
    const info = rl(0.5);
    mocked.mockResolvedValue({ text: 'hi', rateLimit: info, inputTokens: 10, outputTokens: 5, costUsd: 0.25 });
    const gov = fakeGov();
    const acc = createTokenAccumulator();
    const r = await callGoverned({ model: 'sonnet', prompt: 'p' }, acc, gov as never);
    expect(r.text).toBe('hi');
    expect(acc).toEqual({ input_tokens: 10, output_tokens: 5, estimated_cost_usd: 0.25 });
    expect(gov.observe).toHaveBeenCalledWith(info);
    expect(gov.beforeCall.mock.invocationCallOrder[0]).toBeLessThan(mocked.mock.invocationCallOrder[0]);
  });

  it('does not call Claude when beforeCall stops the run', async () => {
    const gov = fakeGov({ before: async () => { throw new UsageStopError('budget'); } });
    await expect(
      callGoverned({ model: 'sonnet', prompt: 'p' }, createTokenAccumulator(), gov as never),
    ).rejects.toBeInstanceOf(UsageStopError);
    expect(mocked).not.toHaveBeenCalled();
  });

  it('does not throw when a stop condition appears after a successful call', async () => {
    mocked.mockResolvedValue({ text: 'paid', rateLimit: rl(0.9), inputTokens: 1, outputTokens: 1, costUsd: 0.1 });
    const gov = fakeGov({ stop: () => 'budget' });
    const r = await callGoverned({ model: 'sonnet', prompt: 'p' }, createTokenAccumulator(), gov as never);
    expect(r.text).toBe('paid');
  });

  it('turns a ClaudeCallError carrying a rate limit into UsageStopError when the governor says stop', async () => {
    const info = rl(0.99, 'rejected');
    mocked.mockRejectedValue(new ClaudeCallError('exit 1', info));
    const gov = fakeGov({ stop: () => 'rate limited (rejected)' });
    await expect(
      callGoverned({ model: 'sonnet', prompt: 'p' }, createTokenAccumulator(), gov as never),
    ).rejects.toMatchObject({ name: 'UsageStopError', reason: 'rate limited (rejected)' });
    expect(gov.observe).toHaveBeenCalledWith(info);
  });

  it('rethrows the original ClaudeCallError when the governor sees no stop', async () => {
    const err = new ClaudeCallError('boom', rl(0.1));
    mocked.mockRejectedValue(err);
    await expect(
      callGoverned({ model: 'sonnet', prompt: 'p' }, createTokenAccumulator(), fakeGov() as never),
    ).rejects.toBe(err);
  });

  it('rethrows a ClaudeCallError with no rate limit without observing', async () => {
    const err = new ClaudeCallError('boom', null);
    mocked.mockRejectedValue(err);
    const gov = fakeGov();
    await expect(
      callGoverned({ model: 'sonnet', prompt: 'p' }, createTokenAccumulator(), gov as never),
    ).rejects.toBe(err);
    expect(gov.observe).not.toHaveBeenCalled();
  });
});

describe('directCaller', () => {
  beforeEach(() => { mocked.mockReset(); });

  it('calls claude directly, accumulates, and stops with UsageStopError after maxCalls', async () => {
    mocked.mockResolvedValue({ text: 'x', rateLimit: null, inputTokens: 2, outputTokens: 3, costUsd: 0.5 });
    const acc = createTokenAccumulator();
    const call = directCaller(acc, 2);
    await call({ model: 'sonnet', prompt: 'a' });
    await call({ model: 'sonnet', prompt: 'b' });
    await expect(call({ model: 'sonnet', prompt: 'c' })).rejects.toBeInstanceOf(UsageStopError);
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(call.calls()).toBe(2);
    expect(acc).toEqual({ input_tokens: 4, output_tokens: 6, estimated_cost_usd: 1 });
  });
});
