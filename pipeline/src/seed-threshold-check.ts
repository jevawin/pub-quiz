import { appendFileSync } from 'node:fs';
import type { TypedSupabaseClient } from './lib/supabase.js';
import { loadConfig } from './lib/config.js';
import { createSupabaseClient } from './lib/supabase.js';
import { log } from './lib/logger.js';

const VERIFIED_THRESHOLD = 1000;

export interface ThresholdResult {
  seedComplete: boolean;
  verifiedCount: number;
  categoryCount: number;
}

export async function checkThreshold(supabase: TypedSupabaseClient): Promise<ThresholdResult> {
  // Count verified questions (verification_score >= 3)
  const { count: verifiedCount, error: countError } = await supabase
    .from('questions')
    .select('*', { count: 'exact', head: true })
    .gte('verification_score', 3);

  if (countError) {
    log('error', 'Failed to count verified questions', { error: countError.message });
    process.exit(1);
  }

  const verified = verifiedCount ?? 0;

  // Get unique category IDs from verified questions
  const { data: categoryRows, error: catError } = await supabase
    .from('questions')
    .select('category_id')
    .gte('verification_score', 3);

  if (catError) {
    log('error', 'Failed to fetch verified question categories', { error: catError.message });
    process.exit(1);
  }

  const uniqueCategories = new Set((categoryRows ?? []).map((r) => r.category_id));
  const categoryCount = uniqueCategories.size;

  const seedComplete = verified >= VERIFIED_THRESHOLD;

  if (seedComplete) {
    // Write GitHub Actions outputs
    const outputFile = process.env.GITHUB_OUTPUT;
    if (outputFile) {
      appendFileSync(outputFile, `seed_complete=true\n`);
      appendFileSync(outputFile, `verified_count=${verified}\n`);
    }

    console.log(`::notice::SEED COMPLETE: ${verified} verified questions across ${categoryCount} categories`);
  } else {
    log('info', `Seed in progress: ${verified}/1000 verified questions across ${categoryCount} categories`);
  }

  return { seedComplete, verifiedCount: verified, categoryCount };
}

// Run when executed directly (not when imported as a module in tests)
const isDirectExecution = typeof process !== 'undefined' && process.argv[1] &&
  (process.argv[1].endsWith('seed-threshold-check.ts') || process.argv[1].endsWith('seed-threshold-check.js'));

if (isDirectExecution) {
  const config = loadConfig();
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  checkThreshold(supabase);
}
