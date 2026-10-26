import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { callClaude, ClaudeCallError } from '../claude-cli.js';

const RL = {
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    unifiedWindows: {
      five_hour: { utilization: 0.1, resetsAt: 1800000000 },
      seven_day: { utilization: 0.2, resetsAt: 1800500000 },
    },
  },
};
const RESULT = {
  type: 'result',
  is_error: false,
  result: 'hello',
  usage: {
    input_tokens: 10,
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 30,
    output_tokens: 5,
  },
  total_cost_usd: 0.0123,
};

interface Captured {
  cmd?: string;
  args?: string[];
  opts?: { cwd?: string; env?: Record<string, string> };
  stdin: string;
  cwdExistedDuring?: boolean;
  cwdEntries?: string[];
  killed?: boolean;
}

function fake(
  script: (child: any) => void,
  cap: Captured = { stdin: '' },
) {
  const spawnFn = ((cmd: string, args: string[], opts: any) => {
    cap.cmd = cmd;
    cap.args = args;
    cap.opts = opts;
    cap.cwdExistedDuring = existsSync(opts.cwd);
    cap.cwdEntries = readdirSync(opts.cwd);
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      write: (s: string) => { cap.stdin += s; },
      end: (s?: string) => { if (s) cap.stdin += s; },
      on: () => {},
    };
    child.kill = vi.fn(() => { cap.killed = true; return true; });
    setImmediate(() => script(child));
    return child;
  }) as any;
  return { spawnFn, cap };
}

const lines = (...fs: unknown[]) => fs.map((f) => JSON.stringify(f)).join('\n') + '\n';
const ok = (child: any, out = lines(RL, RESULT)) => {
  child.stdout.emit('data', Buffer.from(out));
  child.emit('close', 0);
};

const EXPECTED_DENY = ["Bash", "BashOutput", "KillShell", "Task", "Agent", "ToolSearch", "Monitor", "Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", "Skill", "Workflow", "CronCreate", "CronDelete", "CronList", "RemoteTrigger", "SendMessage", "DesignSync", "EnterWorktree", "ExitWorktree", "ListAgents", "PushNotification", "ReportFindings", "ScheduleWakeup", "Read", "Glob", "Grep"];

describe('isolated settings file', () => {
  it('deny list is exactly the measured-safe one (cannot be weakened silently)', () => {
    const f = new URL('../../../config/claude-isolated-settings.json', import.meta.url);
    const j = JSON.parse(readFileSync(f, 'utf8'));
    expect(EXPECTED_DENY).toHaveLength(29);
    expect(j.permissions.deny).toEqual(EXPECTED_DENY);
  });
});

describe('callClaude', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
  });

  it('returns text, tokens and rate limit', async () => {
    const { spawnFn } = fake((c) => ok(c, 'garbage line\n' + lines(RL, RESULT)));
    const r = await callClaude({ model: 'haiku', prompt: 'hi' }, spawnFn);
    expect(r.text).toBe('hello');
    expect(r.inputTokens).toBe(60);
    expect(r.outputTokens).toBe(5);
    expect(r.costUsd).toBe(0.0123);
    expect(r.rateLimit?.status).toBe('allowed');
    expect(r.rateLimit?.weekly.seven_day.utilization).toBe(0.2);
  });

  it('argv has --restricted, --strict-mcp-config, --settings with an absolute path, and no prompt text', async () => {
    const { spawnFn, cap } = fake((c) => ok(c));
    await callClaude({ model: 'sonnet', system: 'SYS', prompt: 'SECRET-PROMPT' }, spawnFn);
    const a = cap.args!;
    expect(cap.cmd).toBe('claude');
    expect(a).toEqual(expect.arrayContaining([
      '-p', '--model', 'sonnet', '--output-format', 'stream-json', '--verbose',
      '--restricted', '--strict-mcp-config', '--no-session-persistence',
    ]));
    const sp = a[a.indexOf('--settings') + 1];
    expect(isAbsolute(sp)).toBe(true);
    expect(existsSync(sp)).toBe(true);
    expect(a[a.indexOf('--system-prompt') + 1]).toBe('SYS');
    expect(a.join(' ')).not.toContain('SECRET-PROMPT');
    expect(cap.stdin).toBe('SECRET-PROMPT');
  });

  it('omitted system → neutral system prompt', async () => {
    const { spawnFn, cap } = fake((c) => ok(c));
    await callClaude({ model: 'haiku', prompt: 'x' }, spawnFn);
    expect(cap.args![cap.args!.indexOf('--system-prompt') + 1]).toBe('You are a helpful assistant.');
  });

  it('child env has no SUPABASE_*/ANTHROPIC_* keys and has the token', async () => {
    process.env.SUPABASE_SERVICE_KEY = 'leak';
    process.env.ANTHROPIC_API_KEY = 'leak2';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok';
    const { spawnFn, cap } = fake((c) => ok(c));
    await callClaude({ model: 'haiku', prompt: 'x' }, spawnFn);
    const env = cap.opts!.env!;
    expect(Object.keys(env).sort()).toEqual(
      ['CLAUDE_CODE_OAUTH_TOKEN', 'HOME', 'LANG', 'PATH'].filter((k) => k in env).sort(),
    );
    expect(Object.keys(env).some((k) => /^(SUPABASE_|ANTHROPIC_)/.test(k))).toBe(false);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok');
  });

  it('cwd is fresh, empty and removed', async () => {
    const { spawnFn, cap } = fake((c) => ok(c));
    await callClaude({ model: 'haiku', prompt: 'x' }, spawnFn);
    expect(cap.cwdExistedDuring).toBe(true);
    expect(cap.cwdEntries).toEqual([]);
    expect(existsSync(cap.opts!.cwd!)).toBe(false);
  });

  it('missing result frame → ClaudeCallError', async () => {
    const { spawnFn } = fake((c) => ok(c, lines(RL)));
    await expect(callClaude({ model: 'haiku', prompt: 'x' }, spawnFn)).rejects.toBeInstanceOf(ClaudeCallError);
  });

  it('is_error result keeps rateLimit on the error', async () => {
    const { spawnFn } = fake((c) => ok(c, lines(RL, { ...RESULT, is_error: true, result: 'boom' })));
    const e = await callClaude({ model: 'haiku', prompt: 'x' }, spawnFn).catch((x) => x);
    expect(e).toBeInstanceOf(ClaudeCallError);
    expect(e.rateLimit?.status).toBe('allowed');
  });

  it('non-zero exit', async () => {
    const { spawnFn } = fake((c) => {
      c.stderr.emit('data', Buffer.from('bad'));
      c.emit('close', 2);
    });
    await expect(callClaude({ model: 'haiku', prompt: 'x' }, spawnFn)).rejects.toThrow(/exited 2/);
  });

  it('spawn error event rejects immediately', async () => {
    const { spawnFn } = fake((c) => c.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })));
    await expect(callClaude({ model: 'haiku', prompt: 'x', timeoutMs: 60_000 }, spawnFn)).rejects.toThrow(/ENOENT/);
  });

  it('timeout kills the child', async () => {
    const { spawnFn, cap } = fake(() => { /* never closes */ });
    await expect(callClaude({ model: 'haiku', prompt: 'x', timeoutMs: 30 }, spawnFn)).rejects.toThrow(/timed out/);
    expect(cap.killed).toBe(true);
  });

  it('cwd is removed even if the child left files in it', async () => {
    const { spawnFn, cap } = fake((c) => {
      writeFileSync(join(cap.opts!.cwd!, 'junk.txt'), 'x');
      ok(c);
    });
    await callClaude({ model: 'haiku', prompt: 'x' }, spawnFn);
    expect(existsSync(cap.opts!.cwd!)).toBe(false);
  });

  it('system prompt starting with "-" is rejected before spawning', async () => {
    const { spawnFn, cap } = fake((c) => ok(c));
    await expect(callClaude({ model: 'haiku', system: '--evil', prompt: 'x' }, spawnFn)).rejects.toBeInstanceOf(ClaudeCallError);
    expect(cap.cmd).toBeUndefined();
  });

  it('synchronous spawn throw rejects with ClaudeCallError', async () => {
    const spawnFn = (() => { throw new Error('EAGAIN boom'); }) as any;
    const e = await callClaude({ model: 'haiku', prompt: 'x', timeoutMs: 60_000 }, spawnFn).catch((x) => x);
    expect(e).toBeInstanceOf(ClaudeCallError);
    expect(e.message).toMatch(/EAGAIN boom/);
  });

  it('non-zero exit prefers the result frame text over stderr', async () => {
    const { spawnFn } = fake((c) => {
      c.stderr.emit('data', Buffer.from('stderr-noise'));
      c.stdout.emit('data', Buffer.from(lines({ ...RESULT, is_error: true, result: 'usage limit reached' })));
      c.emit('close', 1);
    });
    const e = await callClaude({ model: 'haiku', prompt: 'x' }, spawnFn).catch((x) => x);
    expect(e.message).toMatch(/usage limit reached/);
    expect(e.message).not.toMatch(/stderr-noise/);
  });
});
