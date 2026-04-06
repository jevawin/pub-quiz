import { PipelineConfig } from '../lib/config.js';
import { createClaudeClient, TokenAccumulator, trackUsage, checkBudget, extractJson, HAIKU_INPUT, HAIKU_OUTPUT, SONNET_INPUT, SONNET_OUTPUT, BudgetExceededError } from '../lib/claude.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { QaBatchSchema, SonnetRewriteSchema } from '../lib/schemas.js';
import { log } from '../lib/logger.js';
import type { Database } from '../lib/database.types.js';

type QuestionRow = Database['public']['Tables']['questions']['Row'];
type QuestionWithCategory = QuestionRow & { categories: { name: string } | null };

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
- "rewrite": Any fixable issue — phrasing, wrong answer, bad distractors, answer/question mismatch, anything salvageable. Describe what's wrong in your reasoning. You do NOT need to provide the fix — a separate agent will handle the rewrite.
- "reject": Fundamentally broken beyond repair (wrong category, nonsensical, unanswerable, niche specialist knowledge with no interesting angle).

RULES:
- Questions containing "according to the reference material", "according to the text", "based on the reference", or similar source-citing language MUST be flagged for rewrite.
- Questions that are "you know it or you don't" with no room for reasoning or debate should be flagged for rewrite.
- Questions over 100 characters should be flagged for rewrite.
- Niche specialist questions that fewer than 3 out of 6 random adults would recognise should be rejected.
- If the correct answer does not logically answer the question (e.g. question asks "how many?" but the answer is a name, or the answer is in the question text), flag it for rewrite — the rewrite agent can fix the answer.
- If the answer given to the question is literally in the question text (i.e. it's a free answer), flag it for rewrite.

(Standards from: pipeline/STYLE-GUIDE.md)`;

const SONNET_REWRITE_PROMPT = `You are a pub quiz editor fixing questions flagged by a QA reviewer. You can change ANY field — question text, correct answer, distractors, explanation, difficulty, fun fact — to produce a high-quality pub quiz question.

RULES:
1. Fix the specific issue identified in the QA reasoning.
2. After fixing, validate that ALL fields are consistent:
   - The correct answer must logically answer the question.
   - All 3 distractors must be plausible, from the same domain as the correct answer, and wrong.
   - The explanation must match the (possibly new) correct answer.
   - The fun fact (if present) must still relate to the correct answer. If it doesn't, write a new one (1-2 sentences, surprising, concrete, conversational). Set fun_fact to null if you can't think of a good one.
   - The difficulty label must be accurate.
   - The answer must NOT appear in the question text.
3. Keep questions to 40-80 characters. One breath to read aloud.
4. Write like a quizmaster talking to friends, not a textbook.
5. Every answer you provide must be factually correct. Do not guess.
6. Distractors: exactly 3, all plausible, same domain as correct answer.

Return JSON with these fields:
- "question_text": string (the fixed question)
- "correct_answer": string (correct answer — may be unchanged or fixed)
- "distractors": string[] (exactly 3 wrong answers)
- "explanation": string (2-3 sentences explaining why the answer is correct)
- "difficulty": "easy" | "normal" | "hard"
- "fun_fact": string | null (keep existing if still valid, rewrite if not, null if none)
- "changes_made": string (brief summary of what you changed and why)`;

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

  // Step 1: Fetch all verified questions with score >= 1, including category name
  const { data: verifiedQuestions, error: fetchError } = await supabase
    .from('questions')
    .select('*, categories(name)')
    .eq('status', 'verified')
    .gte('verification_score', 1) as { data: (QuestionRow & { categories: { name: string } | null })[] | null; error: { message: string } | null };

  if (fetchError || !verifiedQuestions || verifiedQuestions.length === 0) {
    log('info', 'No verified questions to QA', { error: fetchError?.message });
    return { processed: 0, failed: 0, rewritten: 0 };
  }

  log('info', `Found ${verifiedQuestions.length} verified questions to QA`);

  // Step 2: Group questions into batches of ~10 for efficient QA calls
  const BATCH_SIZE = 10;
  const batches: QuestionWithCategory[][] = [];
  for (let i = 0; i < verifiedQuestions.length; i += BATCH_SIZE) {
    batches.push(verifiedQuestions.slice(i, i + BATCH_SIZE));
  }

  // Step 3: Process each batch
  for (const questions of batches) {
    try {
      const questionsSection = questions.map((q, i) => {
        return `Question ${i + 1} (ID: ${q.id}):
Question: ${q.question_text}
Correct Answer: ${q.correct_answer}
Distractors: ${(q.distractors as string[]).join(', ')}
Explanation: ${q.explanation ?? 'None'}
Difficulty: ${q.difficulty}
Category: ${q.categories?.name ?? 'Unknown'}`;
      }).join('\n\n');

      const userPrompt = `Please quality-check the following pub quiz questions. No reference text is needed — judge them on clarity, difficulty calibration, distractor quality, and pub quiz suitability.

Return JSON with a "results" array where each object has these fields:
- "question_id": string (the UUID)
- "passed": boolean
- "action": "pass" | "rewrite" | "reject"
- "natural_language_score": number (0-10)
- "category_fit_score": number (0-10)
- "difficulty_calibration_score": number (0-10)
- "distractor_quality_score": number (0-10)
- "recalibrated_difficulty": "easy" | "normal" | "hard" (optional, only if the current difficulty label is wrong)
- "reasoning": string (for rewrites: describe what's wrong so the rewrite agent can fix it)

Do NOT provide rewritten text — just identify the issues. A separate agent handles rewrites.

${questionsSection}`;

      // Step 4: Call Claude Haiku
      log('info', 'Calling Claude Haiku for QA batch', { questionCount: questions.length });

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
        log('warn', 'No text content in Claude response', { batchSize: questions.length });
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
          batchSize: questions.length,
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
            // Haiku flagged this for rewrite — send to Sonnet for the fix
            try {
              const rewriteResult = await rewriteWithSonnet(
                claude, config, tokenAccumulator, originalQuestion, result.reasoning,
              );

              if (!rewriteResult) {
                log('warn', 'Sonnet rewrite failed, rejecting question', {
                  questionId: result.question_id,
                });
                await (supabase.from('questions').update({ status: 'rejected' as const } as never)
                  .eq('id', result.question_id) as unknown as Promise<{ error: { message: string } | null }>);
                failed++;
                continue;
              }

              const updateData: Record<string, unknown> = {
                qa_rewritten: true,
                question_text: rewriteResult.question_text,
                correct_answer: rewriteResult.correct_answer,
                distractors: rewriteResult.distractors,
                explanation: rewriteResult.explanation,
                difficulty: rewriteResult.difficulty,
              };

              // Update fun_fact: set to new value or null (clear stale ones)
              updateData.fun_fact = rewriteResult.fun_fact ?? null;

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

              log('info', 'Question rewritten by Sonnet', {
                questionId: result.question_id,
                changes: rewriteResult.changes_made,
                published: originalQuestion.verification_score >= 3,
              });
              processed++;
              rewritten++;
            } catch (rewriteError) {
              if (rewriteError instanceof BudgetExceededError) throw rewriteError;
              log('error', 'Sonnet rewrite error', {
                questionId: result.question_id,
                error: rewriteError instanceof Error ? rewriteError.message : String(rewriteError),
              });
              failed++;
              errors++;
            }
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
      log('error', 'Error processing QA batch', {
        batchSize: questions.length,
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

interface SonnetRewriteResult {
  question_text: string;
  correct_answer: string;
  distractors: string[];
  explanation: string;
  difficulty: 'easy' | 'normal' | 'hard';
  fun_fact: string | null;
  changes_made: string;
}

async function rewriteWithSonnet(
  claude: ReturnType<typeof createClaudeClient>,
  config: PipelineConfig,
  tokenAccumulator: TokenAccumulator,
  question: QuestionWithCategory,
  qaReasoning: string,
): Promise<SonnetRewriteResult | null> {
  const userPrompt = `Fix this pub quiz question. The QA reviewer identified the following issue:

**QA Issue:** ${qaReasoning}

**Current question:**
- Question: ${question.question_text}
- Correct Answer: ${question.correct_answer}
- Distractors: ${(question.distractors as string[]).join(', ')}
- Explanation: ${question.explanation ?? 'None'}
- Difficulty: ${question.difficulty}
- Category: ${question.categories?.name ?? 'Unknown'}
- Fun Fact: ${(question as Record<string, unknown>).fun_fact ?? 'None'}

Fix the issue and return the complete corrected question as JSON.`;

  const response = await claude.messages.create({
    model: config.claudeModelGeneration,
    max_tokens: 1024,
    system: SONNET_REWRITE_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  trackUsage(response, tokenAccumulator, SONNET_INPUT, SONNET_OUTPUT);
  checkBudget(tokenAccumulator, config.budgetCapUsd);

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') return null;

  try {
    const jsonStr = extractJson(textContent.text);
    const parsed = JSON.parse(jsonStr);
    const result = SonnetRewriteSchema.parse(parsed);

    // Validate distractor count
    if (result.distractors.length !== 3) return null;

    // Validate no distractor matches the correct answer
    if (result.distractors.some(d => d.toLowerCase().trim() === result.correct_answer.toLowerCase().trim())) {
      log('warn', 'Sonnet rewrite has distractor matching correct answer', {
        answer: result.correct_answer,
      });
      return null;
    }

    return result;
  } catch (parseError) {
    log('warn', 'Failed to parse Sonnet rewrite response', {
      error: parseError instanceof Error ? parseError.message : String(parseError),
    });
    return null;
  }
}
