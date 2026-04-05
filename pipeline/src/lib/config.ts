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
  wikipediaUserAgent: string;
  wikipediaMaxContentLength: number;
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
    claudeModelVerification: 'claude-haiku-4-5-20251001',
    wikipediaUserAgent: 'PubQuizPipeline/1.0 (https://github.com/pub-quiz)',
    wikipediaMaxContentLength: 3000,
  };
}
