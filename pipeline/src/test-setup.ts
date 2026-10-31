import { afterEach, beforeEach } from 'vitest';

// Fails any test that tried to run the real claude CLI (see the guard in lib/claude-cli.ts), even when the
// caller swallowed the error.
const g = globalThis as { __pqRealClaudeAttempts?: number };
beforeEach(() => {
  g.__pqRealClaudeAttempts = 0;
});
afterEach(() => {
  const n = g.__pqRealClaudeAttempts ?? 0;
  g.__pqRealClaudeAttempts = 0;
  if (n > 0) throw new Error(`test attempted ${n} real claude CLI call(s); mock it`);
});
