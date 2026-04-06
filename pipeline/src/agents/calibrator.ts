import { PipelineConfig } from '../lib/config.js';
import { createClaudeClient, TokenAccumulator, trackUsage, checkBudget, extractJson, HAIKU_INPUT, HAIKU_OUTPUT, BudgetExceededError } from '../lib/claude.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { log } from '../lib/logger.js';
import { z } from 'zod';
import type { Database } from '../lib/database.types.js';

type QuestionRow = Database['public']['Tables']['questions']['Row'];

export interface CalibratorResult {
  processed: number;
  recalibrated: number;
  failed: number;
}

const CalibratorResponseSchema = z.object({
  answered_correctly: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
  estimated_percent_correct: z.number().min(0).max(100),
  difficulty: z.enum(['easy', 'normal', 'hard']),
  reasoning: z.string(),
});

const SYSTEM_PROMPT = `You are a pub quiz difficulty calibrator. For each question, you do two things:

1. **Try to answer the question** from the four options. Answer honestly — don't cheat by looking for linguistic clues in the question. You are simulating a knowledgeable adult.

2. **Estimate what % of degree-educated UK adults in a pub would get it right.** Be realistic. Most people are not as well-read as you are.

Then map the result to a difficulty label:

- **easy** (70%+ of adults would get it): Primary-school or universal knowledge. "What's the capital of France?" "Who wrote Romeo and Juliet?" The answer should feel obvious to most people, with no plausible trap in the distractors.

- **normal** (35-70%): Most adults have heard of the topic but could plausibly pick the wrong answer. "Who wrote Brave New World?" "Largest moon in the solar system?" The distractors are close enough that half the table might debate.

- **hard** (<35%): Enthusiast knowledge. Pub table guesses; one person might know for sure. "Guinness's second brewery outside Ireland?" "First posthumous F1 champion?"

Rules:
- If you got the answer WRONG or picked with LOW confidence → it's at least HARD
- If the distractors are genuine traps (close, plausible, requiring specific knowledge to distinguish) → it's at least NORMAL
- If the question requires remembering a specific number/year/name without context clues → it's at least NORMAL
- Famous topic ≠ easy. The question is about the specific fact, not the topic.

Return JSON: {
  "answered_correctly": boolean,
  "confidence": "high" | "medium" | "low",
  "estimated_percent_correct": number (0-100),
  "difficulty": "easy" | "normal" | "hard",
  "reasoning": string
}`;

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

  // Fetch published questions that haven't been calibrated yet (use qa_rewritten as a proxy
  // until we add a dedicated flag — for now calibrate all published each run is cheap enough).
  // Only calibrate questions that have never been calibrated OR were rewritten.
  const { data: questions, error: fetchError } = await supabase
    .from('questions')
    .select('*')
    .eq('status', 'published')
    .is('calibrated_at', null)
    .limit(200) as { data: QuestionRow[] | null; error: { message: string } | null };

  if (fetchError || !questions || questions.length === 0) {
    log('info', 'No questions to calibrate', { error: fetchError?.message });
    return { processed: 0, recalibrated: 0, failed: 0 };
  }

  log('info', `Found ${questions.length} questions to calibrate`);

  for (const question of questions) {
    try {
      // Randomise the option order so the model can't cheat by position
      const options = [
        question.correct_answer,
        ...(question.distractors as string[]),
      ];
      // Fisher-Yates shuffle
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
      }
      const correctIndex = options.indexOf(question.correct_answer);
      const letters = ['A', 'B', 'C', 'D'];

      // Present question with NO category, NO explanation, NO hints
      const userPrompt = `Question: ${question.question_text}

Options:
${options.map((o, i) => `${letters[i]}) ${o}`).join('\n')}

The correct answer is ${letters[correctIndex]}) ${question.correct_answer}.

Would you have answered this correctly without being told? Rate the difficulty for UK pub-goers. Return the JSON.`;

      const response = await claude.messages.create({
        model: config.claudeModelVerification,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      trackUsage(response, tokenAccumulator, HAIKU_INPUT, HAIKU_OUTPUT);
      checkBudget(tokenAccumulator, config.budgetCapUsd);

      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        failed++;
        continue;
      }

      let parsed;
      try {
        parsed = CalibratorResponseSchema.parse(JSON.parse(extractJson(textContent.text)));
      } catch (parseError) {
        log('warn', 'Failed to parse calibrator response', {
          questionId: question.id,
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
        failed++;
        continue;
      }

      const didChange = parsed.difficulty !== question.difficulty;
      const updateData: Record<string, unknown> = {
        calibrated_at: new Date().toISOString(),
        calibration_percent: parsed.estimated_percent_correct,
      };
      if (didChange) {
        updateData.difficulty = parsed.difficulty;
      }

      const { error: updateError } = await (supabase
        .from('questions')
        .update(updateData as never)
        .eq('id', question.id) as unknown as Promise<{ error: { message: string } | null }>);

      if (updateError) {
        log('error', 'Failed to update calibration', {
          questionId: question.id,
          error: updateError.message,
        });
        failed++;
        continue;
      }

      if (didChange) {
        log('info', 'Question recalibrated', {
          questionId: question.id,
          from: question.difficulty,
          to: parsed.difficulty,
          percent: parsed.estimated_percent_correct,
          answeredCorrectly: parsed.answered_correctly,
        });
        recalibrated++;
      }
      processed++;
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
