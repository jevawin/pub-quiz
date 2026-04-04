import { PipelineConfig } from '../lib/config.js';
import { createClaudeClient, TokenAccumulator, trackUsage, checkBudget, HAIKU_INPUT, HAIKU_OUTPUT, BudgetExceededError } from '../lib/claude.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { FactCheckBatchSchema } from '../lib/schemas.js';
import { log } from '../lib/logger.js';
import type { Database } from '../lib/database.types.js';

type QuestionRow = Database['public']['Tables']['questions']['Row'];
type SourceRow = Database['public']['Tables']['sources']['Row'];

export interface AgentResult {
  processed: number;
  failed: number;
}

const SYSTEM_PROMPT = `You are a fact-checker for a pub quiz app. For each question, verify whether the stated correct answer is actually correct based ONLY on the provided reference text. Do NOT use your own knowledge -- only what the reference text states. Score verification strength: 0 = cannot verify from text, 1 = weakly supported, 2 = clearly supported, 3 = explicitly stated in text. If the answer contradicts the reference text, mark is_correct as false.`;

export async function runFactCheckAgent(
  config: PipelineConfig,
  tokenAccumulator: TokenAccumulator,
): Promise<AgentResult> {
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const claude = createClaudeClient(config.anthropicApiKey);

  let processed = 0;
  let failed = 0;
  let errors = 0;

  log('info', 'Fact-Check Agent starting');

  // Step 1: Fetch all pending, unverified questions
  const { data: pendingQuestions, error: fetchError } = await supabase
    .from('questions')
    .select('*')
    .eq('status', 'pending')
    .eq('verification_score', 0) as { data: QuestionRow[] | null; error: { message: string } | null };

  if (fetchError || !pendingQuestions || pendingQuestions.length === 0) {
    log('info', 'No pending questions to fact-check', { error: fetchError?.message });
    return { processed: 0, failed: 0 };
  }

  log('info', `Found ${pendingQuestions.length} pending questions to fact-check`);

  // Step 2: Group questions by source_id for efficiency
  const questionsBySource = new Map<string, QuestionRow[]>();
  for (const q of pendingQuestions) {
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
Distractors: ${(q.distractors as string[]).join(', ')}`;
      }).join('\n\n');

      const userPrompt = `Reference text:
${source.content}

Please fact-check the following questions against the reference text above. Return JSON with a "results" array.

${questionsSection}`;

      // Step 4: Call Claude Haiku
      log('info', `Calling Claude Haiku for source: ${source.title}`, { questionCount: questions.length });

      const response = await claude.messages.create({
        model: config.claudeModelVerification,
        max_tokens: 2048,
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
        const jsonStr = textContent.text;
        const parsed = JSON.parse(jsonStr);
        parsedBatch = FactCheckBatchSchema.parse(parsed);
      } catch (parseError) {
        log('warn', 'Failed to parse Claude response as FactCheckBatch', {
          sourceId,
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
        failed += questions.length;
        errors += questions.length;
        continue;
      }

      // Step 6: Process each fact-check result
      for (const result of parsedBatch.results) {
        try {
          if (result.is_correct) {
            // Determine status based on verification score
            if (result.verification_score >= 3) {
              // Auto-publish: high confidence only
              const updateResult = await (supabase
                .from('questions')
                .update({
                  verification_score: result.verification_score,
                  status: 'published' as const,
                  published_at: new Date().toISOString(),
                } as never)
                .eq('id', result.question_id) as unknown as Promise<{ error: { message: string } | null }>);

              if (updateResult?.error) {
                log('error', 'Failed to update question as published', {
                  questionId: result.question_id,
                  error: updateResult.error.message,
                });
                failed++;
                errors++;
                continue;
              }

              log('info', 'Question auto-published', {
                questionId: result.question_id,
                score: result.verification_score,
              });
            } else {
              // Verified but not auto-published (score 1-2)
              const updateResult = await (supabase
                .from('questions')
                .update({
                  verification_score: result.verification_score,
                  status: 'verified' as const,
                } as never)
                .eq('id', result.question_id) as unknown as Promise<{ error: { message: string } | null }>);

              if (updateResult?.error) {
                log('error', 'Failed to update question as verified', {
                  questionId: result.question_id,
                  error: updateResult.error.message,
                });
                failed++;
                errors++;
                continue;
              }

              log('info', 'Question verified (not auto-published)', {
                questionId: result.question_id,
                score: result.verification_score,
              });
            }
            processed++;
          } else {
            // Rejected
            const updateResult = await (supabase
              .from('questions')
              .update({
                verification_score: 0,
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

            log('info', 'Question rejected', {
              questionId: result.question_id,
              reasoning: result.reasoning,
            });
            failed++;
          }
        } catch (itemError) {
          log('error', 'Per-item error processing fact-check result', {
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
      log('error', 'Error processing source group', {
        sourceId,
        error: groupError instanceof Error ? groupError.message : String(groupError),
      });
      failed += questions.length;
      errors += questions.length;
    }
  }

  log('info', 'Fact-Check Agent completed', { processed, failed });

  // Only throw if ALL items had actual processing errors (not just rejections)
  if (processed === 0 && errors > 0) {
    throw new Error(`All ${errors} fact-checks failed due to errors`);
  }

  return { processed, failed };
}
