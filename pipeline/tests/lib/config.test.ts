import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig } from '../../src/lib/config.js';

const KEYS = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ENABLE_CATEGORY_AGENT', 'STALE_RUN_MS', 'TAXONOMY_ASSESS_MODEL', 'TAXONOMY_CLASSIFY_MODEL', 'ENABLE_TAXONOMY'];
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
      'enableCategoryAgent', 'enableTaxonomy', 'knowledgeBatchSize', 'questionsBatchSize', 'relevanceThreshold',
      'staleRunMs', 'supabaseServiceRoleKey', 'supabaseUrl', 'taxonomyAssessModel',
      'taxonomyClassifyModel', 'taxonomyMaxActionsCleanup', 'taxonomyMaxActionsWeekly',
      'taxonomyWeeklyBudgetShare', 'taxonomyWeeklyRehomeCategories', 'taxonomyWeeklyRoots',
      'wikipediaMaxContentLength', 'wikipediaUserAgent',
    ]);
  });

  it('uses moving model aliases and the new defaults', () => {
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    delete process.env.ENABLE_CATEGORY_AGENT;
    delete process.env.STALE_RUN_MS;
    delete process.env.TAXONOMY_ASSESS_MODEL;
    delete process.env.TAXONOMY_CLASSIFY_MODEL;
    delete process.env.ENABLE_TAXONOMY;
    const c = loadConfig();
    expect(c.taxonomyAssessModel).toBe('opus');
    expect(c.taxonomyClassifyModel).toBe('sonnet');
    expect(c.claudeModelGeneration).toBe('sonnet');
    expect(c.claudeModelVerification).toBe('sonnet');
    expect(c.claudeModelAudit).toBe('opus');
    expect(c.enableCategoryAgent).toBe(false);
    expect(c.staleRunMs).toBe(7 * 3600 * 1000);
    expect(c.enableTaxonomy).toBe(false);
    expect(c.taxonomyMaxActionsWeekly).toBe(40);
    expect(c.taxonomyMaxActionsCleanup).toBe(400);
    expect(c.taxonomyWeeklyBudgetShare).toBe(0.1);
    expect(c.taxonomyWeeklyRoots).toBe(3);
    expect(c.taxonomyWeeklyRehomeCategories).toBe(4);
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
