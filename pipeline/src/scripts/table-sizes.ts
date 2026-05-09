#!/usr/bin/env node
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import { createSupabaseClient } from '../lib/supabase.js';

const TABLES = [
  'questions',
  'question_categories',
  'categories',
  'question_feedback',
  'question_recategorisations',
  'question_plays',
  'quiz_sessions',
  'sources',
  'pipeline_runs',
  'questions_staging',
];

async function main(): Promise<void> {
  const sb = createSupabaseClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  for (const t of TABLES) {
    const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true });
    console.log(`${t.padEnd(30)} ${error ? `ERROR: ${error.message}` : count}`);
  }
}
void main().catch((e) => { console.error(e); process.exit(1); });
