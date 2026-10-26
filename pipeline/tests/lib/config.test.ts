import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig } from '../../src/lib/config.js';

const KEYS = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ENABLE_CATEGORY_AGENT', 'STALE_RUN_MS'];
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('loadConfig', () => {
  it('does not require ANTHROPIC_API_KEY', () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    const c = loadConfig();
    expect(Object.keys(c).sort()).toEqual([
      'categoryBatchSize', 'claudeModelAudit', 'claudeModelGeneration', 'claudeModelVerification',
      'enableCategoryAgent', 'knowledgeBatchSize', 'questionsBatchSize', 'relevanceThreshold',
      'staleRunMs', 'supabaseServiceRoleKey', 'supabaseUrl', 'wikipediaMaxContentLength',
      'wikipediaUserAgent',
    ]);
  });

  it('uses moving model aliases and the new defaults', () => {
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    delete process.env.ENABLE_CATEGORY_AGENT;
    delete process.env.STALE_RUN_MS;
    const c = loadConfig();
    expect(c.claudeModelGeneration).toBe('sonnet');
    expect(c.claudeModelVerification).toBe('sonnet');
    expect(c.claudeModelAudit).toBe('opus');
    expect(c.enableCategoryAgent).toBe(false);
    expect(c.staleRunMs).toBe(7 * 3600 * 1000);
  });

  it('reads ENABLE_CATEGORY_AGENT and STALE_RUN_MS from the environment', () => {
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    process.env.ENABLE_CATEGORY_AGENT = 'true';
    process.env.STALE_RUN_MS = '1000';
    const c = loadConfig();
    expect(c.enableCategoryAgent).toBe(true);
    expect(c.staleRunMs).toBe(1000);
  });
});
