import { PipelineConfig } from '../lib/config.js';
import { createClaudeClient, TokenAccumulator, trackUsage, checkBudget, extractJson, HAIKU_INPUT, HAIKU_OUTPUT, BudgetExceededError } from '../lib/claude.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { QaBatchSchema } from '../lib/schemas.js';
import { log } from '../lib/logger.js';
import type { Database } from '../lib/database.types.js';

type QuestionRow = Database['public']['Tables']['questions']['Row'];
type SourceRow = Database['public']['Tables']['sources']['Row'];

export interface AgentResult {
  processed: number;
  failed: number;
}

export interface QaAgentResult extends AgentResult {
  rewritten: number;
}

const SYSTEM_PROMPT = `You are a quality assurance reviewer for a pub quiz app. Score each question on 4 dimensions (0-10):

1. **Natural Language Quality:** Clear, concise, sounds natural read aloud? Target 40-80 characters. No textbook or exam phrasing.
2. **Category Fit:** Does this question belong in the stated category? Would a quizmaster put it in this round?
3. **Difficulty Calibration:** Does the label match reality? Easy = most of a pub table knows. Normal = half might know. Hard = one person might know, but the answer is interesting. Target mix: 35-40% easy, 40-45% normal, 15-20% hard. If the label is wrong, recalibrate it in your response.
4. **Distractor Quality:** All 3 wrong answers plausible AND from the same domain as the correct answer? (All countries, all years, all people, etc.) No joke answers, no obviously absurd options.

Actions:
- "pass": Good as-is (all scores >= 5)
- "rewrite": Fixable issues. Rewrite phrasing/distractors/explanation only — do NOT change factual content or correct answer.
- "reject": Fundamentally broken (wrong category, nonsensical, unanswerable, niche specialist knowledge).

RULES:
- When rewriting distractors, you MUST provide exactly 3.
- Questions containing "according to the reference material", "according to the text", "based on the reference", or similar source-citing language MUST be rewritten to remove those phrases. Pub quiz questions never reference a source document.
- Questions that are "you know it or you don't" with no room for reasoning or debate should be rewritten to add context or a hint (the "double up" technique).
- Questions over 100 characters should be shortened.
- Niche specialist questions that fewer than 3 out of 6 random adults would recognise should be rejected.
- If the correct answer does not logically answer the question (e.g. question asks "what era?" but the answer is a place, or question asks "who?" but the answer is a date), REJECT it. Do not try to rewrite around a question/answer type mismatch — the answer cannot be changed, so the question is fundamentally broken.

(Standards from: pipeline/STYLE-GUIDE.md)`;

export async function runQaAgent(
  config: PipelineConfig,
  tokenAccumulator: TokenAccumulator,
): Promise<QaAgentResult> {
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const claude = createClaudeClient(config.anthropicApiKey);

  let processed = 0;
  let failed = 0;
  let rewritten = 0;
  let errors = 0;

  log('info', 'QA Agent starting');

  // Step 1: Fetch all verified questions with score >= 1
  const { data: verifiedQuestions, error: fetchError } = await supabase
    .from('questions')
    .select('*')
    .eq('status', 'verified')
    .gte('verification_score', 1) as { data: QuestionRow[] | null; error: { message: string } | null };

  if (fetchError || !verifiedQuestions || verifiedQuestions.length === 0) {
    log('info', 'No verified questions to QA', { error: fetchError?.message });
    return { processed: 0, failed: 0, rewritten: 0 };
  }

  log('info', `Found ${verifiedQuestions.length} verified questions to QA`);

  // Step 2: Group questions by source_id
  const questionsBySource = new Map<string, QuestionRow[]>();
  for (const q of verifiedQuestions) {
    const sourceId = q.source_id ?? 'no-source';
    if (!questionsBySource.has(sourceId)) {
      questionsBySource.set(sourceId, []);
    }
    questionsBySource.get(sourceId)!.push(q);
  }

  // Step 3: Process each source group
  for (const [sourceId, questions] of questionsBySource) {
    try {
      // Fetch source content
      const { data: source, error: srcError } = await supabase
        .from('sources')
        .select('*')
        .eq('id', sourceId)
        .single() as { data: SourceRow | null; error: { message: string } | null };

      if (srcError || !source) {
        log('warn', `Could not fetch source ${sourceId}`, { error: srcError?.message });
        failed += questions.length;
        errors += questions.length;
        continue;
      }

      // Build the user prompt with all questions for this source
      const questionsSection = questions.map((q, i) => {
        return `Question ${i + 1} (ID: ${q.id}):
Question: ${q.question_text}
Correct Answer: ${q.correct_answer}
Distractors: ${(q.distractors as string[]).join(', ')}
Explanation: ${q.explanation ?? 'None'}
Difficulty: ${q.difficulty}
Category: ${q.category_id}`;
      }).join('\n\n');

      const userPrompt = `Reference text:
${source.content}

Please quality-check the following questions. Return JSON with a "results" array where each object has these fields:
- "question_id": string (the UUID)
- "passed": boolean
- "action": "pass" | "rewrite" | "reject"
- "natural_language_score": number (0-10)
- "category_fit_score": number (0-10)
- "difficulty_calibration_score": number (0-10)
- "distractor_quality_score": number (0-10)
- "rewritten_question_text": string (optional, only if action is "rewrite")
- "rewritten_distractors": string[] (optional, exactly 3 items, only if action is "rewrite")
- "rewritten_explanation": string (optional, only if action is "rewrite")
- "recalibrated_difficulty": "easy" | "normal" | "hard" (optional, only if the current difficulty label is wrong)
- "reasoning": string

${questionsSection}`;

      // Step 4: Call Claude Haiku
      log('info', `Calling Claude Haiku for QA on source: ${source.title}`, { questionCount: questions.length });

      const response = await claude.messages.create({
        model: config.claudeModelVerification,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      // Track tokens with Haiku rates
      trackUsage(response, tokenAccumulator, HAIKU_INPUT, HAIKU_OUTPUT);
      checkBudget(tokenAccumulator, config.budgetCapUsd);

      // Step 5: Parse response
      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        log('warn', 'No text content in Claude response', { sourceId });
        failed += questions.length;
        errors += questions.length;
        continue;
      }

      let parsedBatch;
      try {
        const jsonStr = extractJson(textContent.text);
        const parsed = JSON.parse(jsonStr);
        parsedBatch = QaBatchSchema.parse(parsed);
      } catch (parseError) {
        log('warn', 'Failed to parse Claude response as QaBatch', {
          sourceId,
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
        failed += questions.length;
        errors += questions.length;
        continue;
      }

      // Build a lookup from question ID to the original question for verification_score
      const questionLookup = new Map(questions.map((q) => [q.id, q]));

      // Step 6: Process each QA result
      for (const result of parsedBatch.results) {
        try {
          const originalQuestion = questionLookup.get(result.question_id);
          if (!originalQuestion) {
            log('warn', `QA result references unknown question ${result.question_id}`);
            failed++;
            errors++;
            continue;
          }

          if (result.action === 'reject') {
            // Reject: update status to rejected
            const updateResult = await (supabase
              .from('questions')
              .update({
                status: 'rejected' as const,
              } as never)
              .eq('id', result.question_id) as unknown as Promise<{ error: { message: string } | null }>);

            if (updateResult?.error) {
              log('error', 'Failed to update question as rejected', {
                questionId: result.question_id,
                error: updateResult.error.message,
              });
              failed++;
              errors++;
              continue;
            }

            log('info', 'Question rejected by QA', {
              questionId: result.question_id,
              reasoning: result.reasoning,
            });
            failed++;
          } else if (result.action === 'rewrite') {
            // Rewrite: update text, distractors, explanation, set qa_rewritten=true
            // Keep existing verification_score (D-05)
            const updateData: Record<string, unknown> = {
              qa_rewritten: true,
            };

            if (result.rewritten_question_text) {
              updateData.question_text = result.rewritten_question_text;
            }
            if (result.rewritten_distractors) {
              updateData.distractors = result.rewritten_distractors;
            }
            if (result.rewritten_explanation) {
              updateData.explanation = result.rewritten_explanation;
            }
            if (result.recalibrated_difficulty) {
              updateData.difficulty = result.recalibrated_difficulty;
            }

            // Apply publish logic: score >= 3 => publish
            if (originalQuestion.verification_score >= 3) {
              updateData.status = 'published';
              updateData.published_at = new Date().toISOString();
            }

            const updateResult = await (supabase
              .from('questions')
              .update(updateData as never)
              .eq('id', result.question_id) as unknown as Promise<{ error: { message: string } | null }>);

            if (updateResult?.error) {
              log('error', 'Failed to update rewritten question', {
                questionId: result.question_id,
                error: updateResult.error.message,
              });
              failed++;
              errors++;
              continue;
            }

            log('info', 'Question rewritten by QA', {
              questionId: result.question_id,
              published: originalQuestion.verification_score >= 3,
            });
            processed++;
            rewritten++;
          } else {
            // Pass: publish if score >= 3, otherwise leave as verified
            const passUpdateData: Record<string, unknown> = {};

            if (result.recalibrated_difficulty) {
              passUpdateData.difficulty = result.recalibrated_difficulty;
            }

            if (originalQuestion.verification_score >= 3) {
              passUpdateData.status = 'published';
              passUpdateData.published_at = new Date().toISOString();
            }

            if (Object.keys(passUpdateData).length > 0) {
              const updateResult = await (supabase
                .from('questions')
                .update(passUpdateData as never)
                .eq('id', result.question_id) as unknown as Promise<{ error: { message: string } | null }>);

              if (updateResult?.error) {
                log('error', 'Failed to update question', {
                  questionId: result.question_id,
                  error: updateResult.error.message,
                });
                failed++;
                errors++;
                continue;
              }

              log('info', originalQuestion.verification_score >= 3 ? 'Question published' : 'Question difficulty recalibrated', {
                questionId: result.question_id,
                score: originalQuestion.verification_score,
                ...(result.recalibrated_difficulty ? { recalibrated: result.recalibrated_difficulty } : {}),
              });
            } else {
              log('info', 'Question passes QA, no changes needed (score < 3)', {
                questionId: result.question_id,
                score: originalQuestion.verification_score,
              });
            }
            processed++;
          }
        } catch (itemError) {
          log('error', 'Per-item error processing QA result', {
            questionId: result.question_id,
            error: itemError instanceof Error ? itemError.message : String(itemError),
          });
          failed++;
          errors++;
        }
      }
    } catch (groupError) {
      if (groupError instanceof BudgetExceededError) {
        throw groupError;
      }
      log('error', 'Error processing source group for QA', {
        sourceId,
        error: groupError instanceof Error ? groupError.message : String(groupError),
      });
      failed += questions.length;
      errors += questions.length;
    }
  }

  log('info', 'QA Agent completed', { processed, failed, rewritten });

  // Only throw if ALL items had actual processing errors
  if (processed === 0 && errors > 0) {
    throw new Error(`All ${errors} QA checks failed due to errors`);
  }

  return { processed, failed, rewritten };
}
