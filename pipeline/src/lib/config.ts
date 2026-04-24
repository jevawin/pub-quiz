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
  anthropicApiKey: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  budgetCapUsd: number;
  categoryBatchSize: number;
  knowledgeBatchSize: number;
  questionsBatchSize: number;
  claudeModelGeneration: string;
  claudeModelVerification: string;
  claudeModelAudit: string;
  wikipediaUserAgent: string;
  wikipediaMaxContentLength: number;
  relevanceThreshold: number;
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
    anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    budgetCapUsd: envNumber('PIPELINE_BUDGET_USD', 1.00),
    categoryBatchSize: envNumber('CATEGORY_BATCH_SIZE', 5),
    knowledgeBatchSize: envNumber('KNOWLEDGE_BATCH_SIZE', 10),
    questionsBatchSize: envNumber('QUESTIONS_BATCH_SIZE', 20),
    claudeModelGeneration: 'claude-sonnet-4-5-20250929',
    claudeModelVerification: 'claude-sonnet-4-5-20250929',
    claudeModelAudit: 'claude-opus-4-6',
    wikipediaUserAgent: 'PubQuizPipeline/1.0 (https://github.com/pub-quiz)',
    wikipediaMaxContentLength: 3000,
    relevanceThreshold: envNumber('RELEVANCE_THRESHOLD', 0.6),
  };
}
