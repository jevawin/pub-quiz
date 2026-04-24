import { PipelineConfig } from '../lib/config.js';
import { createClaudeClient, TokenAccumulator, trackUsage, checkBudget, extractJson, OPUS_INPUT, OPUS_OUTPUT, BudgetExceededError } from '../lib/claude.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { FactCheckBatchSchema } from '../lib/schemas.js';
import { searchArticles, getArticleText } from '../lib/wikipedia.js';
import { log } from '../lib/logger.js';
import type { Database } from '../lib/database.types.js';

type QuestionRow = Database['public']['Tables']['questions']['Row'];

export interface AgentResult {
  processed: number;
  failed: number;
}

const VERIFICATION_GUIDANCE = `
CRITICAL — Parse the question as (Entity, Attribute, Value) and verify ALL THREE match:
- ENTITY: what specific thing is the question asking about? (e.g. "penguin SKIN", not "penguin")
- ATTRIBUTE: what property of that entity? (e.g. "colour", "height", "year of first climb")
- VALUE: the stated correct answer

Only mark is_correct as true if the source EXPLICITLY states that THIS entity has THIS attribute equal to THIS value. Do NOT accept confirmation from adjacent facts about the same topic. Common traps:
- Question asks about penguin SKIN colour, source talks about penguin FEATHERS being black and white → NOT verified
- Question asks when the Titanic SET SAIL, source gives the SINKING date → NOT verified
- Question asks about antenna HEIGHT, source gives TOTAL tower height → NOT verified
- Question asks about a specific SONG, source talks about the artist in general → NOT verified
- Question asks what X plays on a SPECIFIC song, source says what X plays usually → NOT verified

If the source is about the right general topic but doesn't explicitly confirm the entity+attribute+value triple, mark is_correct as false and score 0.

Also check that the answer logically responds to the question. If the question asks "how many?" the answer must be a number. If it asks "who?" the answer must be a person. If it asks "what year?" or "in which year" the answer must be a year. If it asks "which country" the answer must be a country. If there is any type mismatch between question and answer, mark is_correct as false and score 0 — this is an automatic fail regardless of whether the fact itself is correct.

Check the distractors too. They must be the same TYPE as the correct answer (all years, all people, all countries, etc.). If the distractors are a different type from what the question asks for, mark is_correct as false.`;

const WIKIPEDIA_PROMPT = `You are a fact-checker for a pub quiz app. For each question, verify whether the stated correct answer is actually correct based ONLY on the provided reference text. Do NOT use your own knowledge -- only what the reference text states. Score verification strength: 0 = cannot verify from text, 1 = weakly supported, 2 = clearly supported, 3 = explicitly stated in text. If the answer contradicts the reference text, mark is_correct as false.
${VERIFICATION_GUIDANCE}`;

const OWN_KNOWLEDGE_PROMPT = `You are a fact-checker for a pub quiz app. Using your own knowledge (NOT a reference text), verify whether the stated correct answer is factually correct. Be strict — only mark is_correct as true if you are highly confident the answer is correct. Score: 0 = uncertain/likely wrong, 1 = probably correct but not sure, 2 = confident it is correct, 3 = certain. If in any doubt, mark is_correct as false.
${VERIFICATION_GUIDANCE}`;

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

  // Fetch all pending, unverified questions
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

  // Pre-filter: programmatic type-mismatch check
  // Catches cases like "In which year...?" → answer is a person's name
  const TYPE_PATTERNS: [RegExp, RegExp, string][] = [
    [/\b(?:what|which)\s+year\b|in\s+which\s+year\b|\bwhen\s+(?:did|was|were|is)\b/i, /^\d{3,4}(?:\s|$)/, 'year'],
    [/\bhow\s+many\b/i, /^\d/, 'number'],
    [/\b(?:what|which)\s+country\b|in\s+which\s+country\b/i, /^[A-Z]/, 'country'],
  ];

  const passedQuestions: QuestionRow[] = [];
  for (const question of pendingQuestions) {
    let typeMismatch = false;
    for (const [questionPattern, answerPattern, expectedType] of TYPE_PATTERNS) {
      if (questionPattern.test(question.question_text) && !answerPattern.test(question.correct_answer)) {
        log('warn', 'Type mismatch: question/answer type conflict', {
          questionId: question.id,
          questionText: question.question_text,
          answer: question.correct_answer,
          expectedType,
        });
        await (supabase.from('questions').update({ verification_score: 0, status: 'rejected' as const } as never)
          .eq('id', question.id) as unknown as Promise<{ error: { message: string } | null }>);
        failed++;
        typeMismatch = true;
        break;
      }
    }
    if (!typeMismatch) passedQuestions.push(question);
  }

  // Source 1: Wikipedia search verification
  const needsOwnKnowledge: QuestionRow[] = [];

  log('info', 'Starting Wikipedia verification', { count: passedQuestions.length });

  for (const question of passedQuestions) {
    try {
      const searchQuery = `${question.correct_answer} ${question.question_text}`;
      const titles = await searchArticles(searchQuery, config.wikipediaUserAgent, 1);

      if (titles.length === 0) {
        needsOwnKnowledge.push(question);
        continue;
      }

      const articleText = await getArticleText(titles[0], config.wikipediaUserAgent, config.wikipediaMaxContentLength);
      if (!articleText) {
        needsOwnKnowledge.push(question);
        continue;
      }

      const userPrompt = `Reference text:
${articleText}

Please fact-check the following question against the reference text above. Return JSON with a "results" array where each object has exactly these fields:
- "question_id": string (the UUID from above)
- "is_correct": boolean
- "verification_score": number (0-3)
- "reasoning": string (brief explanation)

Question 1 (ID: ${question.id}):
Question: ${question.question_text}
Correct Answer: ${question.correct_answer}
Distractors: ${(question.distractors as string[]).join(', ')}`;

      const response = await claude.messages.create({
        model: config.claudeModelAudit,
        max_tokens: 1024,
        system: WIKIPEDIA_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      trackUsage(response, tokenAccumulator, OPUS_INPUT, OPUS_OUTPUT);
      checkBudget(tokenAccumulator, config.budgetCapUsd);

      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        needsOwnKnowledge.push(question);
        continue;
      }

      let parsedBatch;
      try {
        parsedBatch = FactCheckBatchSchema.parse(JSON.parse(extractJson(textContent.text)));
      } catch {
        needsOwnKnowledge.push(question);
        continue;
      }

      const result = parsedBatch.results[0];
      if (result?.is_correct && result.verification_score >= 2) {
        await (supabase.from('questions').update({
          verification_score: result.verification_score,
          status: 'verified' as const,
          fact_checked_at: new Date().toISOString(),
        } as never).eq('id', question.id) as unknown as Promise<{ error: { message: string } | null }>);
        log('info', 'Question verified via Wikipedia', {
          questionId: question.id,
          score: result.verification_score,
          source: titles[0],
        });
        processed++;
      } else {
        needsOwnKnowledge.push(question);
        log('info', 'Wikipedia could not verify, queued for own-knowledge', {
          questionId: question.id,
          reasoning: result?.reasoning,
        });
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      log('error', 'Wikipedia verification error', {
        questionId: question.id,
        error: err instanceof Error ? err.message : String(err),
      });
      needsOwnKnowledge.push(question);
      errors++;
    }
  }

  // Source 2: Claude's own knowledge
  if (needsOwnKnowledge.length > 0) {
    log('info', 'Starting own-knowledge verification', { count: needsOwnKnowledge.length });

    for (const question of needsOwnKnowledge) {
      try {
        const userPrompt = `Verify this pub quiz question using your own knowledge. No reference text is provided — rely on what you know.

Return JSON with a "results" array with one object:
- "question_id": string
- "is_correct": boolean
- "verification_score": number (0-3)
- "reasoning": string

Question (ID: ${question.id}):
Question: ${question.question_text}
Correct Answer: ${question.correct_answer}
Distractors: ${(question.distractors as string[]).join(', ')}`;

        const response = await claude.messages.create({
          model: config.claudeModelAudit,
          max_tokens: 512,
          system: OWN_KNOWLEDGE_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        });

        trackUsage(response, tokenAccumulator, OPUS_INPUT, OPUS_OUTPUT);
        checkBudget(tokenAccumulator, config.budgetCapUsd);

        const textContent = response.content.find(c => c.type === 'text');
        if (!textContent || textContent.type !== 'text') {
          await (supabase.from('questions').update({ verification_score: 0, status: 'rejected' as const } as never)
            .eq('id', question.id) as unknown as Promise<{ error: { message: string } | null }>);
          failed++;
          continue;
        }

        let parsedBatch;
        try {
          parsedBatch = FactCheckBatchSchema.parse(JSON.parse(extractJson(textContent.text)));
        } catch {
          await (supabase.from('questions').update({ verification_score: 0, status: 'rejected' as const } as never)
            .eq('id', question.id) as unknown as Promise<{ error: { message: string } | null }>);
          failed++;
          continue;
        }

        const result = parsedBatch.results[0];
        if (result?.is_correct && result.verification_score >= 2) {
          await (supabase.from('questions').update({
            verification_score: result.verification_score,
            status: 'verified' as const,
            fact_checked_at: new Date().toISOString(),
          } as never).eq('id', question.id) as unknown as Promise<{ error: { message: string } | null }>);
          log('info', 'Question verified by own knowledge', {
            questionId: question.id,
            score: result.verification_score,
          });
          processed++;
        } else {
          await (supabase.from('questions').update({ verification_score: 0, status: 'rejected' as const } as never)
            .eq('id', question.id) as unknown as Promise<{ error: { message: string } | null }>);
          log('info', 'Question rejected after all verification', {
            questionId: question.id,
            reasoning: result?.reasoning,
          });
          failed++;
        }
      } catch (err) {
        if (err instanceof BudgetExceededError) throw err;
        log('error', 'Own-knowledge verification error', {
          questionId: question.id,
          error: err instanceof Error ? err.message : String(err),
        });
        await (supabase.from('questions').update({ verification_score: 0, status: 'rejected' as const } as never)
          .eq('id', question.id) as unknown as Promise<{ error: { message: string } | null }>);
        failed++;
        errors++;
      }
    }
  }

  log('info', 'Fact-Check Agent completed', { processed, failed });

  if (processed === 0 && errors > 0) {
    throw new Error(`All ${errors} fact-checks failed due to errors`);
  }

  return { processed, failed };
}
