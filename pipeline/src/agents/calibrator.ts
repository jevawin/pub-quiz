import { PipelineConfig } from '../lib/config.js';
import { createClaudeClient, TokenAccumulator, trackUsage, checkBudget, extractJson, HAIKU_INPUT, HAIKU_OUTPUT, BudgetExceededError } from '../lib/claude.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { CalibratorScoreSchema } from '../lib/schemas.js';
import { log } from '../lib/logger.js';
import { jsonKeyToSlug, slugToJsonKey } from '../lib/slug-converter.js';
import { resolveSlugsToIds } from '../lib/categories.js';
import { GENERAL_KNOWLEDGE_SLUG } from '../lib/general-knowledge-guard.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types.js';

export interface CalibratorResult {
  processed: number;
  recalibrated: number;
  failed: number;
}

export interface CalibrateInput {
  id: string;
  question_text: string;
  correct_answer: string;
  distractors: string[];
  assigned_slugs: string[]; // non-GK extras; GK is always added
}

export interface CalibrateOutput {
  success: boolean;
  scores?: Record<string, number>; // keys are slugs (kebab-case), values 0-100
  error?: string;
}

const SYSTEM_PROMPT = `You are a pub quiz difficulty calibrator. For each category listed, estimate the percentage (0-100) of players who *chose to play this category* who would answer the given question correctly. Always include a separate score for \`general_knowledge\`, representing the mixed pub audience. Reason about each audience separately — a science enthusiast may get a physics question at 75% while the general pub gets 20%.

Return JSON exactly in this shape:
{ "scores": { "general_knowledge": 45, "science_and_nature": 68 }, "reasoning": "brief explanation" }

Keys use snake_case. Values are integers 0-100. Include exactly one score per assigned category plus general_knowledge.`;

export async function calibrateQuestion(
  supabase: SupabaseClient<Database>,
  tokenAcc: TokenAccumulator,
  input: CalibrateInput,
  claude: ReturnType<typeof createClaudeClient>,
  config: Pick<PipelineConfig, 'claudeModelVerification' | 'budgetCapUsd'>,
): Promise<CalibrateOutput> {
  const allSlugs = [...input.assigned_slugs, GENERAL_KNOWLEDGE_SLUG];

  // Build user message with question + categories
  const categoriesList = allSlugs.map(s => `- ${s}`).join('\n');
  const userPrompt = `Question: ${input.question_text}

Correct answer: ${input.correct_answer}
Distractors: ${input.distractors.join(', ')}

Categories to score:
${categoriesList}

Return the JSON scores object.`;

  let response;
  try {
    response = await claude.messages.create({
      model: config.claudeModelVerification,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  trackUsage(response, tokenAcc, HAIKU_INPUT, HAIKU_OUTPUT);
  checkBudget(tokenAcc, config.budgetCapUsd);

  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    return { success: false, error: 'No text content in calibrator response' };
  }

  let parsed;
  try {
    parsed = CalibratorScoreSchema.parse(JSON.parse(extractJson(textContent.text)));
  } catch (parseError) {
    return {
      success: false,
      error: parseError instanceof Error ? parseError.message : String(parseError),
    };
  }

  // Validate: every expected slug must have a score
  for (const slug of allSlugs) {
    const jsonKey = slugToJsonKey(slug);
    if (!(jsonKey in parsed.scores)) {
      return {
        success: false,
        error: `Calibrator response missing score for slug '${slug}' (json key '${jsonKey}')`,
      };
    }
  }

  // Convert snake_case JSON keys to kebab-case slugs
  const slugScores: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed.scores)) {
    slugScores[jsonKeyToSlug(k)] = v;
  }

  // Resolve slugs to category IDs
  let slugToId: Map<string, string>;
  try {
    slugToId = await resolveSlugsToIds(supabase, Object.keys(slugScores));
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Upsert rows into question_categories
  const rows = Object.entries(slugScores).map(([slug, score]) => ({
    question_id: input.id,
    category_id: slugToId.get(slug)!,
    estimate_score: score,
    observed_n: 0,
  }));

  const { error: upsertErr } = await (supabase
    .from('question_categories')
    .upsert(rows as never, { onConflict: 'question_id,category_id', ignoreDuplicates: false }) as unknown as Promise<{ error: { message: string } | null }>);

  if (upsertErr) {
    return { success: false, error: upsertErr.message };
  }

  return { success: true, scores: slugScores };
}

export async function runCalibratorAgent(
  config: PipelineConfig,
  tokenAccumulator: TokenAccumulator,
): Promise<CalibratorResult> {
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const claude = createClaudeClient(config.anthropicApiKey);

  let processed = 0;
  let recalibrated = 0;
  let failed = 0;

  log('info', 'Calibrator Agent starting');

  // Fetch questions needing calibration:
  // - status='pending' or published questions with no question_categories rows yet
  const { data: questions, error: fetchError } = await (supabase
    .from('questions')
    .select('id, question_text, correct_answer, distractors, status')
    .or('status.eq.pending,status.eq.published')
    .is('calibrated_at', null)
    .limit(200) as unknown as Promise<{
      data: Array<{
        id: string;
        question_text: string;
        correct_answer: string;
        distractors: string[];
        status: string;
      }> | null;
      error: { message: string } | null;
    }>);

  if (fetchError || !questions || questions.length === 0) {
    log('info', 'No questions to calibrate', { error: fetchError?.message });
    return { processed: 0, recalibrated: 0, failed: 0 };
  }

  log('info', `Found ${questions.length} questions to calibrate`);

  for (const question of questions) {
    try {
      // Fetch existing question_categories for this question to derive assigned_slugs
      const { data: existingQC } = await (supabase
        .from('question_categories')
        .select('category_id, categories(slug)')
        .eq('question_id', question.id) as unknown as Promise<{
          data: Array<{ category_id: string; categories: { slug: string } | null }> | null;
          error: unknown;
        }>);

      // Derive assigned_slugs (non-GK extras): exclude general-knowledge
      const existingSlugs = (existingQC ?? [])
        .map(r => r.categories?.slug)
        .filter((s): s is string => !!s && s !== GENERAL_KNOWLEDGE_SLUG);

      const result = await calibrateQuestion(
        supabase,
        tokenAccumulator,
        {
          id: question.id,
          question_text: question.question_text,
          correct_answer: question.correct_answer,
          distractors: question.distractors as string[],
          assigned_slugs: existingSlugs,
        },
        claude,
        config,
      );

      if (!result.success) {
        log('warn', 'Failed to calibrate question', {
          questionId: question.id,
          error: result.error,
        });
        failed++;
        continue;
      }

      processed++;
      recalibrated++;

      log('info', 'Question calibrated', {
        questionId: question.id,
        scores: result.scores,
      });
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      log('error', 'Calibrator error', {
        questionId: question.id,
        error: err instanceof Error ? err.message : String(err),
      });
      failed++;
    }
  }

  log('info', 'Calibrator Agent completed', { processed, recalibrated, failed });
  return { processed, recalibrated, failed };
}
