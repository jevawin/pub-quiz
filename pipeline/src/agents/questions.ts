import { PipelineConfig } from '../lib/config.js';
import { createClaudeClient, TokenAccumulator, trackUsage, checkBudget, extractJson, SONNET_INPUT, SONNET_OUTPUT, BudgetExceededError } from '../lib/claude.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { QuestionBatchSchema } from '../lib/schemas.js';
import { log } from '../lib/logger.js';
import { getEligibleCategoriesOrdered } from '../lib/category-selection.js';
import type { Database } from '../lib/database.types.js';

type QuestionRow = Database['public']['Tables']['questions']['Row'];

export interface AgentResult {
  processed: number;
  failed: number;
}

const SYSTEM_PROMPT = `You are an expert pub quiz question writer. Write questions a quizmaster would read aloud in a pub — the kind that make a table of friends debate the answer over a pint.

## Audience

This is a **UK pub quiz**. Write for a table of friends in a British pub.

- **UK topics are always welcome:** British history, geography, culture, sport, TV, music, food, monarchy, etc.
- **Global knowledge is welcome:** world geography, science, nature, internationally famous films/TV/music, major world events, well-known world leaders, etc.
- **American topics are fine IF they're globally famous:** Friends, Cheers, Seinfeld, NASA, Hollywood, Lincoln, the moon landings, "how many states in the US", etc.
- **American topics are NOT fine if they're US-internal:** minor US presidents most Brits wouldn't know, US-specific sports (NFL, NBA, NHL, MLB rules/records), US state capitals, US civics, US-only TV shows or celebrities. Ask yourself: "Would a table of 6 in a Manchester pub have a chance at this?" If not, skip it.

When in doubt, lean British or global rather than American.

## Rules

1. Use your own knowledge to write questions. Every answer must be factually correct — you will be fact-checked.
2. NEVER reference source material, textbooks, or articles. These are standalone pub quiz questions.
3. Each question: 1 correct answer + 3 plausible distractors from the same domain (all countries, all years, all people, etc.).
4. Write a 2-3 sentence explanation for why the correct answer is right.
5. Keep questions to 40-80 characters. One breath to read aloud.
6. Do NOT generate questions similar to ones already listed.

## Difficulty (target per batch of 5: 2 easy, 2 normal, 1 hard)

**Be strict about this.** Most questions end up harder than writers think. When in doubt, rate it harder.

EASY (35-40%) — almost EVERYONE at a pub table would get this. Primary-school level, universal knowledge, no trap between close alternatives:
- "What is the capital of France?" → Paris
- "How many sides does a hexagon have?" → Six
- "What colour do you get when you mix red and yellow?" → Orange
- "In which country would you find the Eiffel Tower?" → France
- "Who wrote Romeo and Juliet?" → Shakespeare

NORMAL (40-45%) — most adults have heard of this but might hesitate between close alternatives:
- "Who wrote the dystopian novel Brave New World?" → Aldous Huxley
- "What is the largest moon in the Solar System?" → Ganymede
- "What is the largest species of shark?" → Whale shark
- "Which of Henry VIII's six wives was he married to the longest?" → Catherine of Aragon
- "On a standard Monopoly board, which square is opposite Go?" → Free Parking

HARD (15-20%) — one enthusiast at the table might know, but the answer is interesting:
- "What did Alfred Hitchcock use as blood in Psycho?" → Chocolate syrup
- "Which Disney princess has the least screen time in her own film?" → Aurora
- "Who holds the record for most goals across all FIFA World Cups?" → Miroslav Klose

**Key test for EASY:** Could a 10-year-old have a reasonable shot? If not, it's at least NORMAL. "Ganymede vs Titan" is NOT easy even though the solar system is a common topic. "Whale shark vs great white" is NOT easy because people assume great whites are biggest. The distractors matter — if they're plausible traps, bump the difficulty.

## The Double-Up Technique
Add an interesting detail that gives players something to work with:
- Before: "For what movie did Paul Newman win his Oscar?"
- After: "Paul Newman's only competitive Oscar was for a role he'd first played 25 years earlier. Name that movie."

## Anti-Patterns (never do these)
- Referencing source material in the question text
- Trick questions that punish rather than reward thinking
- "You know it or you don't" questions with no room for reasoning — prefer questions that spark debate
- Textbook/exam phrasing — write like you're talking to a friend
- Niche specialist questions — would 3+ people at a random table have a chance?
- Questions over 100 characters
- Questions about events from the current or previous year — they date fast and won't age well
- Corporate/business questions (company rebrandings, product launch dates, internal org names)
- Questions where the answer doesn't match the question type. If you ask "what era?" the answer must be an era. Double-check this.
- Never include the correct answer in the question text. If the question is about a named thing, describe it rather than naming it. For example, don't write "In the sitcom Cheers, what is the name of the bar?" — instead write "What's the name of the bar in the sitcom where everybody knows your name?"

(Style reference: Open Trivia Database, CC BY-SA 4.0. Full guide: pipeline/STYLE-GUIDE.md)`;

const DEDUP_CAP = 20;
const QUESTIONS_PER_CATEGORY = 5;
const MIN_QUESTIONS_THRESHOLD = 10;

export async function runQuestionsAgent(
  config: PipelineConfig,
  tokenAccumulator: TokenAccumulator,
): Promise<AgentResult> {
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const claude = createClaudeClient(config.anthropicApiKey);

  let processed = 0;
  let failed = 0;

  log('info', 'Questions Agent starting');

  // Step 1: Find categories needing questions, ordered by least-covered first
  const eligibleCategories = await getEligibleCategoriesOrdered(
    supabase,
    config.questionsBatchSize,
    MIN_QUESTIONS_THRESHOLD,
  );

  if (eligibleCategories.length === 0) {
    log('info', 'No eligible categories found (all have sufficient questions)');
    return { processed: 0, failed: 0 };
  }

  log('info', `Found ${eligibleCategories.length} eligible categories`);

  let totalQuestionsGenerated = 0;

  for (const category of eligibleCategories) {
    if (totalQuestionsGenerated >= config.questionsBatchSize) {
      log('info', 'Reached questionsBatchSize limit', { limit: config.questionsBatchSize });
      break;
    }

    try {
      // Step 2: Fetch existing questions for dedup (capped at DEDUP_CAP)
      const { data: existingQuestions } = await supabase
        .from('questions')
        .select('*')
        .eq('category_id', category.id)
        .order('created_at', { ascending: false })
        .limit(DEDUP_CAP) as { data: QuestionRow[] | null; error: unknown };

      const existingQuestionTexts = existingQuestions?.map((q) => q.question_text) ?? [];

      // Build dedup context
      let dedupSection = '';
      if (existingQuestionTexts.length > 0) {
        dedupSection = `\n\nExisting questions to avoid (do NOT create similar questions):\n${existingQuestionTexts.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
      }

      const { data: allQuestions } = await supabase
        .from('questions')
        .select('*')
        .eq('category_id', category.id) as { data: QuestionRow[] | null; error: unknown };

      const totalExisting = allQuestions?.length ?? 0;
      let dedupNote = '';
      if (totalExisting > DEDUP_CAP) {
        dedupNote = `\n\nNote: There are ${totalExisting} existing questions for this category -- avoid overlapping topics.`;
      }

      const questionsToGenerate = Math.min(
        QUESTIONS_PER_CATEGORY,
        config.questionsBatchSize - totalQuestionsGenerated,
      );

      const userPrompt = `Category: ${category.name}

Generate ${questionsToGenerate} pub quiz questions about ${category.name}. Use your own knowledge — write questions that are factually correct and would work in a real pub quiz.
${dedupSection}${dedupNote}

Return as JSON with a "questions" array where each object has exactly these fields:
- "question_text": string (the question)
- "correct_answer": string
- "distractors": array of exactly 3 strings (wrong answers)
- "explanation": string (2-3 sentences)
- "difficulty": "easy" | "normal" | "hard"`;

      // Step 3: Call Claude
      log('info', `Calling Claude for category: ${category.name}`, { questionsToGenerate });

      const response = await claude.messages.create({
        model: config.claudeModelGeneration,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      trackUsage(response, tokenAccumulator, SONNET_INPUT, SONNET_OUTPUT);
      checkBudget(tokenAccumulator, config.budgetCapUsd);

      // Step 4: Parse response
      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        log('warn', 'No text content in Claude response', { category: category.name });
        continue;
      }

      let parsedBatch;
      try {
        const jsonStr = extractJson(textContent.text);
        const parsed = JSON.parse(jsonStr);
        parsedBatch = QuestionBatchSchema.parse(parsed);
      } catch (parseError) {
        log('warn', 'Failed to parse Claude response as QuestionBatch', {
          category: category.name,
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
        failed += questionsToGenerate;
        continue;
      }

      // Step 5: Validate and insert each question (no source_id — generated from knowledge)
      for (const question of parsedBatch.questions) {
        try {
          if (question.distractors.length !== 3) {
            log('warn', 'Question has wrong number of distractors', {
              questionText: question.question_text,
              distractorCount: question.distractors.length,
            });
            failed++;
            continue;
          }

          const hasCollision = question.distractors.some(
            (d) => d.toLowerCase().trim() === question.correct_answer.toLowerCase().trim(),
          );
          if (hasCollision) {
            log('warn', 'Distractor matches correct answer, skipping question', {
              questionText: question.question_text,
              correctAnswer: question.correct_answer,
            });
            failed++;
            continue;
          }

          // Check if answer (full or distinctive word) appears in question text
          const qLowerText = question.question_text.toLowerCase();
          const answerFull = question.correct_answer.toLowerCase().trim();

          // Full answer match
          const fullMatch = qLowerText.includes(answerFull) && answerFull.length > 2;

          // Distinctive-word match: any ≥5-char word from the answer appearing in the question.
          // Skips common connective words to avoid false positives.
          const stopwords = new Set([
            'the', 'and', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by',
            'from', 'is', 'was', 'are', 'were', 'been', 'being', 'have', 'has',
            'had', 'does', 'did', 'a', 'an', 'or', 'but', 'not', 'new', 'old',
            'great', 'little', 'big', 'small', 'first', 'last', 'second',
          ]);
          const answerWords = answerFull
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 5 && !stopwords.has(w));
          const distinctiveMatch = answerWords.some(w => {
            const re = new RegExp(`\\b${w}\\b`, 'i');
            return re.test(question.question_text);
          });

          if (fullMatch || distinctiveMatch) {
            log('warn', 'Answer appears in question text, skipping question', {
              questionText: question.question_text,
              correctAnswer: question.correct_answer,
              matchType: fullMatch ? 'full' : 'distinctive-word',
            });
            failed++;
            continue;
          }

          // Check for answer-type mismatches (e.g. "how many?" expects a number)
          const qLower = question.question_text.toLowerCase();
          const hasTypeMismatch =
            (/\bhow many\b/.test(qLower) && !/\d/.test(question.correct_answer)) ||
            (/\bhow much\b/.test(qLower) && !/\d/.test(question.correct_answer)) ||
            (/\bwhat year\b|\bin what year\b|\bwhich year\b/.test(qLower) && !/\d{3,4}/.test(question.correct_answer));

          if (hasTypeMismatch) {
            log('warn', 'Answer-type mismatch detected, skipping question', {
              questionText: question.question_text,
              correctAnswer: question.correct_answer,
            });
            failed++;
            continue;
          }

          const insertData: Database['public']['Tables']['questions']['Insert'] = {
            category_id: category.id,
            source_id: null,
            question_text: question.question_text,
            correct_answer: question.correct_answer,
            distractors: question.distractors,
            explanation: question.explanation,
            difficulty: question.difficulty,
            verification_score: 0,
            status: 'pending',
          };
          const { error: insertError } = await (supabase.from('questions').insert(insertData as never) as unknown as Promise<{ error: { message: string } | null }>);

          if (insertError) {
            log('error', 'Failed to insert question', {
              questionText: question.question_text,
              error: insertError.message,
            });
            failed++;
            continue;
          }

          processed++;
          totalQuestionsGenerated++;
          log('info', 'Inserted question', { questionText: question.question_text });
        } catch (itemError) {
          log('error', 'Per-item error processing question', {
            questionText: question.question_text,
            error: itemError instanceof Error ? itemError.message : String(itemError),
          });
          failed++;
        }
      }
    } catch (categoryError) {
      if (categoryError instanceof BudgetExceededError) {
        throw categoryError;
      }
      log('error', 'Error processing category', {
        category: category.name,
        error: categoryError instanceof Error ? categoryError.message : String(categoryError),
      });
    }
  }

  log('info', 'Questions Agent completed', { processed, failed });

  if (processed === 0 && failed > 0) {
    throw new Error(`All ${failed} questions failed to process`);
  }

  return { processed, failed };
}
