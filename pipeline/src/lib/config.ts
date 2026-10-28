export const DIFFICULTY_BANDS = {
  hard:   { min: 0,  max: 33 },
  medium: { min: 34, max: 66 },
  easy:   { min: 67, max: 100 },
} as const;

export type DifficultyBand = keyof typeof DIFFICULTY_BANDS;

export function scoreToBand(score: number): DifficultyBand {
  if (score <= 33) return 'hard';
  if (score <= 66) return 'medium';
  return 'easy';
}

export interface PipelineConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  categoryBatchSize: number;
  knowledgeBatchSize: number;
  questionsBatchSize: number;
  claudeModelGeneration: string;
  claudeModelVerification: string;
  claudeModelAudit: string;
  /** Moving aliases only, never pinned model ids. */
  taxonomyAssessModel: string;
  taxonomyClassifyModel: string;
  /** Kill switch (ENABLE_TAXONOMY=1): required by every taxonomy mode that writes to the DB. */
  enableTaxonomy: boolean;
  taxonomyMaxActionsWeekly: number;
  taxonomyMaxActionsCleanup: number;
  /** Weekly review budget as a share of one night's budget points. */
  taxonomyWeeklyBudgetShare: number;
  taxonomyWeeklyRoots: number;
  taxonomyWeeklyRehomeCategories: number;
  wikipediaUserAgent: string;
  wikipediaMaxContentLength: number;
  relevanceThreshold: number;
  enableCategoryAgent: boolean;
  /** A pipeline run still 'running' after this long is considered stale. */
  staleRunMs: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function envNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got: ${value}`);
  }
  return parsed;
}

export function loadConfig(): PipelineConfig {
  return {
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    categoryBatchSize: envNumber('CATEGORY_BATCH_SIZE', 5),
    knowledgeBatchSize: envNumber('KNOWLEDGE_BATCH_SIZE', 10),
    questionsBatchSize: envNumber('QUESTIONS_BATCH_SIZE', 20),
    claudeModelGeneration: 'sonnet',
    claudeModelVerification: 'sonnet',
    claudeModelAudit: 'opus',
    taxonomyAssessModel: process.env.TAXONOMY_ASSESS_MODEL || 'opus',
    taxonomyClassifyModel: process.env.TAXONOMY_CLASSIFY_MODEL || 'sonnet',
    enableTaxonomy: process.env.ENABLE_TAXONOMY === '1',
    taxonomyMaxActionsWeekly: envNumber('TAXONOMY_MAX_ACTIONS_WEEKLY', 40),
    taxonomyMaxActionsCleanup: envNumber('TAXONOMY_MAX_ACTIONS_CLEANUP', 400),
    taxonomyWeeklyBudgetShare: envNumber('TAXONOMY_WEEKLY_BUDGET_SHARE', 0.1),
    taxonomyWeeklyRoots: envNumber('TAXONOMY_WEEKLY_ROOTS', 3),
    taxonomyWeeklyRehomeCategories: envNumber('TAXONOMY_WEEKLY_REHOME_CATEGORIES', 4),
    wikipediaUserAgent: 'PubQuizPipeline/1.0 (https://github.com/pub-quiz)',
    wikipediaMaxContentLength: 3000,
    relevanceThreshold: envNumber('RELEVANCE_THRESHOLD', 0.6),
    enableCategoryAgent: ['1', 'true'].includes((process.env.ENABLE_CATEGORY_AGENT ?? '').toLowerCase()),
    staleRunMs: envNumber('STALE_RUN_MS', 7 * 3600 * 1000),
  };
}
