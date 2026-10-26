import type { ClaudeCallOptions, ClaudeCallResult } from '../../src/lib/claude-cli.js';

/** The shape the old SDK-based tests used for canned responses. */
export interface LegacyResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface LegacyClaudeFake {
  respond: (args: { model: string; system?: string; messages: Array<{ role: 'user'; content: string }> }) => Promise<LegacyResponse>;
}

/**
 * Adapts a `{ respond }` fake to a `callGoverned` mock implementation, so tests can
 * keep their canned responses and call-argument assertions. `respond` is read lazily so tests can
 * replace it after setup. A rejection (e.g. UsageStopError) propagates unchanged.
 */
export function bridgeClaude(fake: LegacyClaudeFake) {
  return async (opts: ClaudeCallOptions): Promise<ClaudeCallResult> => {
    const r = await fake.respond({
      model: opts.model,
      system: opts.system,
      messages: [{ role: 'user', content: opts.prompt }],
    });
    const block = r.content.find((c) => c.type === 'text');
    return {
      text: block?.text ?? '',
      rateLimit: null,
      inputTokens: r.usage?.input_tokens ?? 0,
      outputTokens: r.usage?.output_tokens ?? 0,
      costUsd: ((r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0)) / 1_000_000, // dummy but non-zero
    };
  };
}
