/**
 * The ONE way this pipeline calls `claude -p`. Prompts carry untrusted text (Wikipedia,
 * model output). The host user may be privileged: treat any tool-capable `claude` fed
 * untrusted text as a code-execution path. The posture is a SECURITY BOUNDARY - do not
 * "simplify" it.
 *
 * Measured (a bare `claude -p` run from a project directory): it executed `crontab -l`
 * unprompted; `--allowedTools` restricts nothing; `--restricted` alone
 * still offers Read (confined to cwd) and a subagent with shell access. Only
 * `--restricted --strict-mcp-config --settings <deny-all>` refused every route, and cwd must
 * be a fresh EMPTY directory because Read survives `--restricted`.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRateLimitEvent, type RateLimitInfo } from './usage.js';

const SETTINGS = fileURLToPath(new URL('../../config/claude-isolated-settings.json', import.meta.url));
const NEUTRAL_SYSTEM = 'You are a helpful assistant.';
const DEFAULT_TIMEOUT_MS = 600_000;

export interface ClaudeCallOptions {
  model: string;
  system?: string;
  prompt: string;
  timeoutMs?: number;
}

export interface ClaudeCallResult {
  text: string;
  rateLimit: RateLimitInfo | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export class ClaudeCallError extends Error {
  constructor(
    message: string,
    public readonly rateLimit: RateLimitInfo | null = null,
  ) {
    super(message);
    this.name = 'ClaudeCallError';
  }
}

export type SpawnFn = (cmd: string, args: string[], opts: Record<string, unknown>) => ChildProcess;

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ['PATH', 'HOME', 'LANG', 'CLAUDE_CODE_OAUTH_TOKEN']) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}

export async function callClaude(
  opts: ClaudeCallOptions,
  spawnFn: SpawnFn = nodeSpawn as unknown as SpawnFn,
): Promise<ClaudeCallResult> {
  if (opts.system?.startsWith('-')) {
    throw new ClaudeCallError('system prompt must not start with "-"');
  }
  const args = [
    '-p', '--model', opts.model,
    '--output-format', 'stream-json', '--verbose',
    '--restricted', '--strict-mcp-config',
    '--settings', SETTINGS,
    '--no-session-persistence',
    '--system-prompt', opts.system ?? NEUTRAL_SYSTEM,
  ];
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = await mkdtemp(join(tmpdir(), 'pq-claude-'));
  try {
    return await new Promise<ClaudeCallResult>((resolve, reject) => {
      let rateLimit: RateLimitInfo | null = null;
      let resultFrame: Record<string, unknown> | null = null;
      let buf = '';
      let stderr = '';
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const fail = (msg: string) => finish(() => reject(new ClaudeCallError(msg, rateLimit)));

      let child: ChildProcess;
      try {
        child = spawnFn('claude', args, {
          cwd,
          env: childEnv(),
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (e) {
        return fail(`claude -p failed to start: ${e instanceof Error ? e.message : String(e)}`);
      }

      timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
        fail(`claude -p timed out after ${timeoutMs}ms`);
      }, timeoutMs);

      const onLine = (line: string) => {
        const t = line.trim();
        if (!t) return;
        let frame: unknown;
        try { frame = JSON.parse(t); } catch { return; }
        if (typeof frame !== 'object' || frame === null) return;
        const f = frame as Record<string, unknown>;
        if (f.type === 'rate_limit_event') {
          const rl = parseRateLimitEvent(f);
          if (rl) rateLimit = rl;
        } else if (f.type === 'result') {
          resultFrame = f;
        }
      };

      child.stdout?.on('data', (d: Buffer | string) => {
        buf += d.toString();
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          onLine(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      });
      child.stderr?.on('data', (d: Buffer | string) => {
        if (stderr.length < 2000) stderr += d.toString();
      });
      child.on('error', (e: Error) => fail(`claude -p failed to start: ${e.message}`));
      child.on('close', (code: number | null) => {
        onLine(buf);
        buf = '';
        const r = resultFrame as Record<string, unknown> | null;
        if (code !== 0) {
          const fromResult = r && typeof r.result === 'string' ? r.result.trim() : '';
          return fail(`claude -p exited ${code}: ${(fromResult || stderr.trim()).slice(0, 200)}`);
        }
        if (!r) return fail('claude -p produced no result frame');
        if (r.is_error === true) {
          return fail(`claude -p reported an error: ${String(r.result ?? '').slice(0, 200)}`);
        }
        if (typeof r.result !== 'string') return fail('claude -p result frame has no text');
        const u = (r.usage ?? {}) as Record<string, unknown>;
        finish(() =>
          resolve({
            text: r.result as string,
            rateLimit,
            inputTokens:
              num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens),
            outputTokens: num(u.output_tokens),
            costUsd: num(r.total_cost_usd),
          }),
        );
      });

      child.stdin?.on?.('error', () => { /* child died early; close/error reports it */ });
      child.stdin?.end(opts.prompt);
    });
  } finally {
    // cwd is always our own mkdtemp result under tmpdir(), never caller input.
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}
