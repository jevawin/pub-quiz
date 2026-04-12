import Anthropic from '@anthropic-ai/sdk';

// Cost constants: dollars per million tokens
export const SONNET_INPUT = 3;
export const SONNET_OUTPUT = 15;
export const HAIKU_INPUT = 1;
export const HAIKU_OUTPUT = 5;
export const OPUS_INPUT = 15;
export const OPUS_OUTPUT = 75;

export interface TokenAccumulator {
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly accumulated: number,
    public readonly budget: number,
  ) {
    super(
      `Budget exceeded: $${accumulated.toFixed(4)} spent, budget is $${budget.toFixed(2)}`,
    );
    this.name = 'BudgetExceededError';
  }
}

export function createClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

export function createTokenAccumulator(): TokenAccumulator {
  return {
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: 0,
  };
}

export function trackUsage(
  response: Anthropic.Message,
  accumulator: TokenAccumulator,
  inputCostPerMTok: number,
  outputCostPerMTok: number,
): void {
  const { input_tokens, output_tokens } = response.usage;
  accumulator.input_tokens += input_tokens;
  accumulator.output_tokens += output_tokens;
  accumulator.estimated_cost_usd +=
    (input_tokens / 1_000_000) * inputCostPerMTok +
    (output_tokens / 1_000_000) * outputCostPerMTok;
}

export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  return fenced ? fenced[1].trim() : text.trim();
}

export function checkBudget(
  accumulator: TokenAccumulator,
  budgetCapUsd: number,
): void {
  if (accumulator.estimated_cost_usd > budgetCapUsd) {
    throw new BudgetExceededError(accumulator.estimated_cost_usd, budgetCapUsd);
  }
}
