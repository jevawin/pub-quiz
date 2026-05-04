#!/usr/bin/env node
import { config as dotenvConfig } from 'dotenv';
// Override empty/stale shell vars so .env always wins for pipeline scripts.
dotenvConfig({ override: true });
/**
 * Re-categorise published questions that currently have only ONE question_categories
 * row (almost always just the mandatory 'general-knowledge' from the Phase 04
 * backfill). Brings them up to multi-category coverage matching the post-999.8
 * pipeline's behaviour: 1-3 extras + general-knowledge, max 4 total per D-15.
 *
 * Per-question flow:
 *   1. Ask Claude (Haiku) to propose 1-3 extra category slugs from the existing
 *      tree, given the question text + correct answer.
 *   2. Validate slugs against `categories.slug` — reject inventions.
 *   3. Call `calibrateQuestion` with the proposed slugs as `assigned_slugs` to
 *      score each. The calibrator then upserts qc rows (general-knowledge always
 *      included). The 4-row trigger on `question_categories` enforces the cap.
 *
 * Cost estimate at 453 questions × 2 calls each:
 *   - Proposer (Haiku): ~$0.01 (small constrained slug-pick task)
 *   - Calibrator (Sonnet, claudeModelVerification): ~$0.50-$1.50
 *   Total expected: $0.50-$2.00
 *
 * CLI:
 *   npx tsx pipeline/src/scripts/recategorise-single-cat-questions.ts --dry-run --limit 10
 *   npx tsx pipeline/src/scripts/recategorise-single-cat-questions.ts --limit 50
 *   npx tsx pipeline/src/scripts/recategorise-single-cat-questions.ts --budget-cap-usd 3
 *   npx tsx pipeline/src/scripts/recategorise-single-cat-questions.ts                # full run
 */
import { createSupabaseClient } from '../lib/supabase.js';
import {
  createClaudeClient,
  createTokenAccumulator,
  trackUsage,
  checkBudget,
  extractJson,
  HAIKU_INPUT,
  HAIKU_OUTPUT,
  BudgetExceededError,
} from '../lib/claude.js';
import type { TokenAccumulator } from '../lib/claude.js';
import type Anthropic from '@anthropic-ai/sdk';
import { calibrateQuestion } from '../agents/calibrator.js';
import { loadConfig } from '../lib/config.js';
import type { PipelineConfig } from '../lib/config.js';
import { log } from '../lib/logger.js';
import { GENERAL_KNOWLEDGE_SLUG } from '../lib/general-knowledge-guard.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types.js';

const PROPOSER_MODEL = 'claude-haiku-4-5-20251001';
const PROPOSER_SYSTEM_PROMPT = `You are a pub quiz categoriser. Given a question, the correct answer, and the existing category tree, propose 1-3 additional category slugs (kebab-case) that a player choosing that category would expect to see this question under.

Rules:
- Only propose slugs from the provided list. Do not invent new slugs.
- Never propose 'general-knowledge' — it is mandatory and added automatically.
- Never propose a slug already assigned to the question.
- Only propose a category if a player who chose it would genuinely expect this question — not just tangentially related.
- Propose 1-3 slugs. Fewer is fine if only one fits well. Zero is allowed if nothing fits.

Return JSON exactly in this shape:
{ "category_slugs": ["science", "history"], "reasoning": "brief explanation" }`;

interface QuestionRow {
  id: string;
  question_text: string;
  correct_answer: string;
  distractors: string[];
  existing_slugs: string[]; // includes 'general-knowledge' if present
}

export interface RecategoriseResult {
  processed: number;
  skipped_no_extras: number;
  failed: number;
  cost_usd: number;
}

export interface RecategoriseOptions {
  limit?: number;
  dryRun?: boolean;
  budgetCapUsd?: number;
}

/**
 * Fetch published questions whose `question_categories` count is exactly 1.
 * PostgREST has no clean HAVING COUNT — fetch all published IDs + all qc rows
 * and bucket client-side. Cheap (3000 IDs at most).
 */
export async function fetchSingleCatQuestions(
  supabase: SupabaseClient<Database>,
  limit?: number,
): Promise<QuestionRow[]> {
  const PAGE = 1000;

  // All published Q ids
  const pubIds: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('questions')
      .select('id')
      .eq('status', 'published')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    pubIds.push(...data.map((r) => r.id));
    if (data.length < PAGE) break;
  }

  // Map qid → slugs[]
  const qidToSlugs = new Map<string, string[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (supabase
      .from('question_categories')
      .select('question_id, categories(slug)')
      .range(from, from + PAGE - 1) as unknown as Promise<{
        data: Array<{ question_id: string; categories: { slug: string } | null }> | null;
        error: { message: string } | null;
      }>);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const slug = row.categories?.slug;
      if (!slug) continue;
      const arr = qidToSlugs.get(row.question_id) ?? [];
      arr.push(slug);
      qidToSlugs.set(row.question_id, arr);
    }
    if (data.length < PAGE) break;
  }

  const singleCatIds = pubIds.filter((id) => (qidToSlugs.get(id)?.length ?? 0) === 1);
  const targetIds = limit ? singleCatIds.slice(0, limit) : singleCatIds;

  if (targetIds.length === 0) return [];

  const { data: qData, error: qErr } = await supabase
    .from('questions')
    .select('id, question_text, correct_answer, distractors')
    .in('id', targetIds);
  if (qErr) throw new Error(qErr.message);

  return (qData ?? []).map((q) => ({
    id: q.id,
    question_text: q.question_text,
    correct_answer: q.correct_answer,
    distractors: q.distractors as string[],
    existing_slugs: qidToSlugs.get(q.id) ?? [],
  }));
}

export async function fetchAvailableSlugs(
  supabase: SupabaseClient<Database>,
): Promise<string[]> {
  const { data, error } = await supabase.from('categories').select('slug');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.slug).filter((s) => s !== GENERAL_KNOWLEDGE_SLUG);
}

export async function proposeExtraCategories(
  claude: Anthropic,
  tokenAcc: TokenAccumulator,
  question: QuestionRow,
  availableSlugs: string[],
  budgetCapUsd: number,
): Promise<{ slugs: string[]; reasoning?: string; error?: string }> {
  const userPrompt = `Question: ${question.question_text}

Correct answer: ${question.correct_answer}
Distractors: ${question.distractors.join(', ')}

Already assigned slugs: ${question.existing_slugs.join(', ') || '(none)'}

Available category slugs (pick from these only):
${availableSlugs.join(', ')}

Return the JSON object with category_slugs and reasoning.`;

  let response;
  try {
    response = await claude.messages.create({
      model: PROPOSER_MODEL,
      max_tokens: 256,
      system: PROPOSER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    return { slugs: [], error: err instanceof Error ? err.message : String(err) };
  }

  trackUsage(response, tokenAcc, HAIKU_INPUT, HAIKU_OUTPUT);
  checkBudget(tokenAcc, budgetCapUsd);

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    return { slugs: [], error: 'No text content in proposer response' };
  }

  let parsed: { category_slugs?: unknown; reasoning?: unknown };
  try {
    parsed = JSON.parse(extractJson(textContent.text));
  } catch (err) {
    return { slugs: [], error: `Proposer JSON parse failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!Array.isArray(parsed.category_slugs)) {
    return { slugs: [], error: `Proposer returned non-array category_slugs` };
  }

  const proposed = parsed.category_slugs.filter((s): s is string => typeof s === 'string');

  // Validate: must be in availableSlugs, must not be 'general-knowledge', must
  // not duplicate existing assignments. Drop invalid silently with a log.
  const availableSet = new Set(availableSlugs);
  const existingSet = new Set(question.existing_slugs);
  const valid: string[] = [];
  for (const slug of proposed) {
    if (slug === GENERAL_KNOWLEDGE_SLUG) {
      log('warn', 'Proposer returned general-knowledge as extra; dropping', { qid: question.id });
      continue;
    }
    if (!availableSet.has(slug)) {
      log('warn', 'Proposer returned unknown slug; dropping', { qid: question.id, slug });
      continue;
    }
    if (existingSet.has(slug)) continue; // already assigned, skip
    if (!valid.includes(slug)) valid.push(slug);
  }

  // Cap to keep total ≤ 4 (D-15: max 4 categories per question).
  // existing_slugs already includes general-knowledge if it was assigned;
  // calibrator will re-add general-knowledge so we account for it once.
  const existingNonGk = question.existing_slugs.filter((s) => s !== GENERAL_KNOWLEDGE_SLUG).length;
  const slotsLeft = Math.max(0, 4 - existingNonGk - 1); // -1 reserves a slot for general-knowledge
  const capped = valid.slice(0, Math.min(3, slotsLeft));

  return {
    slugs: capped,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
  };
}

/**
 * Run one question through the proposer + calibrator. Returns a status string
 * for telemetry. Caller decides whether to call this in dry-run vs real mode.
 */
export async function recategoriseOne(
  supabase: SupabaseClient<Database>,
  claude: Anthropic,
  tokenAcc: TokenAccumulator,
  question: QuestionRow,
  availableSlugs: string[],
  config: PipelineConfig,
  opts: { dryRun: boolean; budgetCapUsd: number },
): Promise<{ status: 'processed' | 'skipped_no_extras' | 'failed'; slugs?: string[]; error?: string }> {
  const proposal = await proposeExtraCategories(
    claude,
    tokenAcc,
    question,
    availableSlugs,
    opts.budgetCapUsd,
  );

  if (proposal.error) {
    return { status: 'failed', error: `proposer: ${proposal.error}` };
  }

  if (proposal.slugs.length === 0) {
    log('info', 'No extras proposed, skipping', { qid: question.id, reasoning: proposal.reasoning });
    return { status: 'skipped_no_extras', slugs: [] };
  }

  if (opts.dryRun) {
    log('info', 'DRY-RUN would calibrate + insert', {
      qid: question.id,
      proposed: proposal.slugs,
      reasoning: proposal.reasoning,
    });
    return { status: 'processed', slugs: proposal.slugs };
  }

  // Calibrator handles the upsert (onConflict: 'question_id,category_id') and
  // adds general-knowledge automatically. The 4-row trigger on the table will
  // reject inserts that exceed the cap; treat that as a failure.
  const calibResult = await calibrateQuestion(
    supabase,
    tokenAcc,
    {
      id: question.id,
      question_text: question.question_text,
      correct_answer: question.correct_answer,
      distractors: question.distractors,
      assigned_slugs: proposal.slugs,
    },
    claude,
    { claudeModelVerification: config.claudeModelVerification, budgetCapUsd: opts.budgetCapUsd },
  );

  if (!calibResult.success) {
    return { status: 'failed', error: `calibrator: ${calibResult.error}` };
  }

  log('info', 'Recategorised', { qid: question.id, slugs: proposal.slugs, scores: calibResult.scores });
  return { status: 'processed', slugs: proposal.slugs };
}

export async function runRecategorise(
  config: PipelineConfig,
  options: RecategoriseOptions = {},
): Promise<RecategoriseResult> {
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const claude = createClaudeClient(config.anthropicApiKey);
  const tokenAcc = createTokenAccumulator();
  const budgetCapUsd = options.budgetCapUsd ?? config.budgetCapUsd;
  const dryRun = options.dryRun ?? false;

  log('info', 'Recategorise starting', { limit: options.limit ?? 'all', dryRun, budgetCapUsd });

  const questions = await fetchSingleCatQuestions(supabase, options.limit);
  log('info', `Found ${questions.length} single-cat published questions to process`);

  if (questions.length === 0) {
    return { processed: 0, skipped_no_extras: 0, failed: 0, cost_usd: 0 };
  }

  const availableSlugs = await fetchAvailableSlugs(supabase);
  log('info', `Loaded ${availableSlugs.length} available category slugs`);

  let processed = 0,
    skipped_no_extras = 0,
    failed = 0;

  for (const q of questions) {
    try {
      checkBudget(tokenAcc, budgetCapUsd);
    } catch (err) {
      log('error', 'Budget cap reached, halting', {
        cost_usd: tokenAcc.estimated_cost_usd,
        budget: budgetCapUsd,
      });
      throw err;
    }

    try {
      const r = await recategoriseOne(supabase, claude, tokenAcc, q, availableSlugs, config, {
        dryRun,
        budgetCapUsd,
      });
      if (r.status === 'processed') processed++;
      else if (r.status === 'skipped_no_extras') skipped_no_extras++;
      else {
        failed++;
        log('warn', 'Question failed', { qid: q.id, error: r.error });
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      failed++;
      log('warn', 'recategoriseOne threw', {
        qid: q.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log('info', 'Recategorise complete', {
    processed,
    skipped_no_extras,
    failed,
    cost_usd: tokenAcc.estimated_cost_usd.toFixed(4),
    dryRun,
  });

  return {
    processed,
    skipped_no_extras,
    failed,
    cost_usd: tokenAcc.estimated_cost_usd,
  };
}

function parseArgs(argv: string[]): RecategoriseOptions {
  const opts: RecategoriseOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--limit') {
      const n = Number(argv[++i]);
      if (Number.isNaN(n) || n <= 0) throw new Error('--limit requires a positive integer');
      opts.limit = n;
    } else if (a === '--budget-cap-usd') {
      const n = Number(argv[++i]);
      if (Number.isNaN(n) || n <= 0) throw new Error('--budget-cap-usd requires a positive number');
      opts.budgetCapUsd = n;
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: recategorise-single-cat-questions [--dry-run] [--limit N] [--budget-cap-usd N]');
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return opts;
}

export async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  try {
    const result = await runRecategorise(config, opts);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.failed > 0 ? 1 : 0);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      console.error(err.message);
      process.exit(2);
    }
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  }
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('recategorise-single-cat-questions.ts');
if (isMain) {
  void main();
}
