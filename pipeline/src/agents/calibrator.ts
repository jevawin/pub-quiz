import { PipelineConfig } from '../lib/config.js';
import { createClaudeClient, TokenAccumulator, trackUsage, checkBudget, extractJson, HAIKU_INPUT, HAIKU_OUTPUT, BudgetExceededError } from '../lib/claude.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { CalibratorScoreSchema } from '../lib/schemas.js';
import { log } from '../lib/logger.js';
import { jsonKeyToSlug, slugToJsonKey } from '../lib/slug-converter.js';
import { resolveSlugsToIds } from '../lib/categories.js';
import { GENERAL_KNOWLEDGE_SLUG } from '../lib/general-knowledge-guard.js';
import { expandSlugsToChain } from '../lib/category-chain.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types.js';

/**
 * Phase 999.22 — chain tagging.
 * GK row is OPTIONAL (per locked decision 4). Calibrator only inserts GK qc row
 * when the model's gk score meets this threshold — i.e. when an average pub-table
 * player would have a genuine chance of knowing the answer.
 *
 * Below threshold: GK row omitted (Q invisible to GK pill, surfaces only via
 * subject pills). Above: included with given estimate_score.
 */
export const GK_THRESHOLD = 20;

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

/**
 * Phase 999.22 — Chain-tagging calibrator.
 *
 * Differs from `calibrateQuestion` (single-tier) in three ways:
 *   1. Walks `parent_id` chain up to root for each assigned slug. One qc row
 *      per ancestor with a per-tier audience score.
 *   2. GK row OPTIONAL: only inserted when model's gk score >= GK_THRESHOLD.
 *   3. INSERT-ONLY (`upsert ignoreDuplicates`): existing rows preserved. Backfill
 *      adds chain rows without overwriting any manual estimate_score edits.
 *
 * Score guidance baked into prompt: each tier scored independently for that
 * tier's audience (broad-pill picker scores lower than niche-pill picker).
 */
const CHAIN_SYSTEM_PROMPT = `You are a pub quiz difficulty calibrator emitting per-tier audience scores.

For EACH category in the supplied chain, estimate the percentage (0-100) of players who picked THAT specific category as their pill, who would answer correctly. Reason about each tier's audience independently — the broad-pill picker is a casual fan, the deep-niche picker is an enthusiast.

Anchor examples:
- "Who won The International 2016 (Dota 2)?":
    gaming: 15 (broad gamers don't follow esports tournaments)
    esports_and_competitive_gaming: 50 (esports fans know top events)
- "What was David Bowie's first album?":
    music: 30 (broad music audience: niche fact)
    rock_and_roll_legends: 50 (rock audience: more recognisable)
    david_bowie: 75 (Bowie fans should know)

Always include a separate \`general_knowledge\` score representing the mixed pub audience — most people would have a genuine chance of knowing the answer. If the answer is so niche that only category specialists could guess (Dota tournament winners, scientific Latin names, etc), score general_knowledge below ${GK_THRESHOLD} so the row is OMITTED.

Return JSON exactly in this shape:
{ "scores": { "gaming": 25, "video_game_franchises": 55, "general_knowledge": 5 }, "reasoning": "brief" }

Keys use snake_case. Values are integers 0-100. Include exactly one score per chain category plus general_knowledge.`;

export interface CalibrateChainOutput extends CalibrateOutput {
  /** Chain slugs the model was asked to score (excluding GK). */
  chain_slugs?: string[];
  /** Whether GK row was inserted (true) or omitted (below GK_THRESHOLD). */
  gk_included?: boolean;
}

export async function calibrateQuestionWithChain(
  supabase: SupabaseClient<Database>,
  tokenAcc: TokenAccumulator,
  input: CalibrateInput,
  claude: ReturnType<typeof createClaudeClient>,
  config: Pick<PipelineConfig, 'claudeModelVerification' | 'budgetCapUsd'>,
): Promise<CalibrateChainOutput> {
  // Fetch categories tree once per call. Tiny table (<200 rows); negligible cost.
  // For batch runs the caller can wrap to cache, but keep self-contained for tests.
  const { data: cats, error: catErr } = await supabase
    .from('categories')
    .select('id, slug, parent_id');

  if (catErr) {
    return { success: false, error: `categories fetch: ${catErr.message}` };
  }

  type CatRow = { id: string; slug: string; parent_id: string | null };
  const rows: CatRow[] = (cats ?? []) as CatRow[];
  const slugToId = new Map<string, string>(rows.map((c) => [c.slug, c.id]));
  const idToSlug = new Map<string, string>(rows.map((c) => [c.id, c.slug]));
  const slugToParent = new Map<string, string | null>(
    rows.map((c) => [c.slug, c.parent_id ? (idToSlug.get(c.parent_id) ?? null) : null]),
  );

  // Compute chain (assigned slugs + all ancestors). Excludes GK — GK is appended
  // to the prompt as a mandatory score request, then conditionally inserted.
  const chainSlugs = expandSlugsToChain(slugToParent, input.assigned_slugs)
    .filter((s) => s !== GENERAL_KNOWLEDGE_SLUG);

  if (chainSlugs.length === 0) {
    return { success: false, error: 'No valid slugs in assigned_slugs' };
  }

  // Build prompt
  const allSlugsForPrompt = [...chainSlugs, GENERAL_KNOWLEDGE_SLUG];
  const categoriesList = allSlugsForPrompt.map((s) => `- ${slugToJsonKey(s)}`).join('\n');
  const userPrompt = `Question: ${input.question_text}

Correct answer: ${input.correct_answer}
Distractors: ${input.distractors.join(', ')}

Categories to score (chain from leaf up to root, plus general_knowledge):
${categoriesList}

Return the JSON scores object.`;

  let response;
  try {
    response = await claude.messages.create({
      model: config.claudeModelVerification,
      max_tokens: 512,
      system: CHAIN_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  trackUsage(response, tokenAcc, HAIKU_INPUT, HAIKU_OUTPUT);
  checkBudget(tokenAcc, config.budgetCapUsd);

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    return { success: false, error: 'No text content in calibrator response' };
  }

  let parsed;
  try {
    parsed = CalibratorScoreSchema.parse(JSON.parse(extractJson(textContent.text)));
  } catch (parseErr) {
    return {
      success: false,
      error: parseErr instanceof Error ? parseErr.message : String(parseErr),
    };
  }

  // Validate every expected slug has a score
  for (const slug of allSlugsForPrompt) {
    if (!(slugToJsonKey(slug) in parsed.scores)) {
      return {
        success: false,
        error: `Calibrator response missing score for slug '${slug}'`,
      };
    }
  }

  // Convert snake_case → kebab-case slug map of scores
  const slugScores: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed.scores)) {
    slugScores[jsonKeyToSlug(k)] = v;
  }

  // Conditional GK: only insert when score meets threshold (locked decision 4)
  const gkScore = slugScores[GENERAL_KNOWLEDGE_SLUG] ?? 0;
  const gkIncluded = gkScore >= GK_THRESHOLD;
  const slugsToInsert = gkIncluded
    ? [...chainSlugs, GENERAL_KNOWLEDGE_SLUG]
    : chainSlugs;

  // Build insert rows
  const insertRows = slugsToInsert
    .map((slug) => {
      const catId = slugToId.get(slug);
      if (!catId) {
        log('warn', 'Calibrator: slug missing from tree, skipping', { slug });
        return null;
      }
      return {
        question_id: input.id,
        category_id: catId,
        estimate_score: slugScores[slug] ?? 0,
        observed_n: 0,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (insertRows.length === 0) {
    return { success: false, error: 'No valid rows to insert (all slugs missing from tree)' };
  }

  // Insert-only (locked decision 5): preserve existing scores. Use upsert with
  // ignoreDuplicates so PK conflicts on (question_id, category_id) are no-ops.
  const upsertRet = await (supabase
    .from('question_categories')
    .upsert(insertRows as never, {
      onConflict: 'question_id,category_id',
      ignoreDuplicates: true,
    }) as unknown as Promise<{ error: { message: string } | null }>);

  if (upsertRet.error) {
    return { success: false, error: upsertRet.error.message };
  }

  return {
    success: true,
    scores: slugScores,
    chain_slugs: chainSlugs,
    gk_included: gkIncluded,
  };
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
  // - status='pending' or 'published' AND no question_categories rows yet.
  // Phase 999.8 Plan 05 dropped questions.calibrated_at; "uncalibrated" now means
  // no row exists in the question_categories join table (empty join → never scored).
  // PostgREST does not have a clean "where no related row exists" filter, so we
  // fetch the candidate set then drop those that already have join rows.
  const { data: candidateRows, error: fetchError } = await (supabase
    .from('questions')
    .select('id, question_text, correct_answer, distractors, status')
    .or('status.eq.pending,status.eq.published')
    .limit(2000) as unknown as Promise<{
      data: Array<{
        id: string;
        question_text: string;
        correct_answer: string;
        distractors: string[];
        status: string;
      }> | null;
      error: { message: string } | null;
    }>);

  let questions = candidateRows;
  if (questions && questions.length > 0) {
    const ids = questions.map((q) => q.id);
    const { data: alreadyScoredRows } = await supabase
      .from('question_categories')
      .select('question_id')
      .in('question_id', ids);
    const alreadyScored = new Set(
      ((alreadyScoredRows ?? []) as Array<{ question_id: string }>).map((r) => r.question_id),
    );
    questions = questions.filter((q) => !alreadyScored.has(q.id)).slice(0, 200);
  }

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
