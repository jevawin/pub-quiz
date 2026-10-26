import { callClaude, ClaudeCallError, type ClaudeCallOptions, type ClaudeCallResult } from './claude-cli.js';
import { log } from './logger.js';
import { UsageStopError, type UsageGovernor } from './usage.js';

export interface TokenAccumulator {
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export function createTokenAccumulator(): TokenAccumulator {
  return {
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: 0,
  };
}

export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  return fenced ? fenced[1].trim() : text.trim();
}

/**
 * The governed way to call Claude: asks the governor for permission, makes the call,
 * records tokens/cost, and feeds the rate-limit reading back. A stop condition seen AFTER
 * a successful call does not throw (the result was paid for); the next beforeCall() stops.
 */
export async function callGoverned(
  opts: ClaudeCallOptions,
  acc: TokenAccumulator,
  gov: UsageGovernor,
): Promise<ClaudeCallResult> {
  try {
    await gov.beforeCall();
  } catch (err) {
    if (err instanceof UsageStopError) log('info', 'Usage stop before call', { reason: err.reason });
    throw err;
  }
  let result: ClaudeCallResult;
  try {
    result = await callClaude(opts);
  } catch (err) {
    if (err instanceof ClaudeCallError && err.rateLimit) {
      gov.observe(err.rateLimit);
      const reason = gov.stopReason();
      if (reason) throw new UsageStopError(reason);
    }
    throw err;
  }
  acc.input_tokens += result.inputTokens;
  acc.output_tokens += result.outputTokens;
  acc.estimated_cost_usd += result.costUsd;
  gov.noteCost(result.costUsd);
  gov.observe(result.rateLimit);
  const pct = (u: number | undefined): number | null => (u === undefined ? null : Math.round(u * 100 * 100) / 100);
  log('info', 'Claude call', {
    model: opts.model,
    sevenDay: pct(result.rateLimit?.weekly.seven_day?.utilization),
    fiveHour: pct(result.rateLimit?.fiveHour?.utilization),
    consumedPoints: gov.consumedPoints,
    budgetPoints: gov.budgetPoints,
    notionalCostUsd: acc.estimated_cost_usd,
  });
  return result;
}

export type ClaudeCaller = (opts: ClaudeCallOptions) => Promise<ClaudeCallResult>;

/**
 * For the manual scripts (no governor): calls claude -p directly, accumulates tokens/cost, and
 * stops with UsageStopError once `maxCalls` calls have been made. Reusing UsageStopError means
 * the rethrow guards in the shared agents treat it as a clean stop.
 */
export function directCaller(acc: TokenAccumulator, maxCalls: number): ClaudeCaller & { calls: () => number } {
  let calls = 0;
  const fn = async (opts: ClaudeCallOptions): Promise<ClaudeCallResult> => {
    if (calls >= maxCalls) throw new UsageStopError(`max calls (${maxCalls}) reached`);
    calls++;
    const result = await callClaude(opts);
    acc.input_tokens += result.inputTokens;
    acc.output_tokens += result.outputTokens;
    acc.estimated_cost_usd += result.costUsd;
    return result;
  };
  return Object.assign(fn, { calls: () => calls });
}
