import { PipelineConfig } from '../lib/config.js';
import { createClaudeClient, TokenAccumulator, trackUsage, checkBudget, extractJson, SONNET_INPUT, SONNET_OUTPUT, BudgetExceededError } from '../lib/claude.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { QuestionBatchSchema } from '../lib/schemas.js';
import { log } from '../lib/logger.js';
import { getEligibleCategoriesOrdered } from '../lib/category-selection.js';
import type { Database } from '../lib/database.types.js';

type SourceRow = Database['public']['Tables']['sources']['Row'];
type QuestionRow = Database['public']['Tables']['questions']['Row'];

export interface AgentResult {
  processed: number;
  failed: number;
}

const SYSTEM_PROMPT = `You are an expert pub quiz question writer. Write questions a quizmaster would read aloud in a pub — the kind that make a table of friends debate the answer over a pint.

## Rules

1. Every answer MUST be verifiable from the provided reference material. The reference is your fact-check, not your audience.
2. NEVER write "according to the text/reference material" — questions must read as standalone pub quiz questions.
3. Each question: 1 correct answer + 3 plausible distractors from the same domain (all countries, all years, all people, etc.).
4. Write a 2-3 sentence explanation for why the correct answer is right.
5. Keep questions to 40-80 characters. One breath to read aloud.
6. Do NOT generate questions similar to ones already listed.

## Difficulty (target per batch of 5: 2 easy, 2 normal, 1 hard)

EASY (35-40%) — most of the table knows:
- "What is the largest planet in the Solar System?" → Jupiter
- "Who painted The Creation of Adam?" → Michelangelo
- "What is the capital of Jamaica?" → Kingston
- "The RMS Titanic was sailing to which American city?" → New York City

NORMAL (40-45%) — half the table might know:
- "Which of his six wives was Henry VIII married to the longest?" → Catherine of Aragon
- "What's the first National Park in the United States?" → Yellowstone
- "What is the best-selling album of all time?" → Thriller
- "On a standard Monopoly board, which square is opposite Go?" → Free Parking

HARD (15-20%) — one person might know, but the answer is interesting:
- "What did Alfred Hitchcock use as blood in Psycho?" → Chocolate syrup
- "Located in Chile, El Teniente is the world's largest underground mine for what metal?" → Copper
- "Which US President served the shortest term in office?" → William Henry Harrison

Easy means GENUINELY easy. "What is the capital of France?" not "In what year was Paris founded?"

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

(Style reference: Open Trivia Database, CC BY-SA 4.0. Full guide: pipeline/STYLE-GUIDE.md)`;

const DEDUP_CAP = 20;
const QUESTIONS_PER_CATEGORY = 5;
const MAX_SOURCES_PER_CATEGORY = 3;
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

  // Step 1: Find categories with sources but needing questions, ordered by least-covered first
  const eligibleCategories = await getEligibleCategoriesOrdered(
    supabase,
    config.questionsBatchSize,
    MIN_QUESTIONS_THRESHOLD,
  );

  if (eligibleCategories.length === 0) {
    log('info', 'No eligible categories found (all have sufficient questions or no sources)');
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
      // Step 2: Fetch source content (up to MAX_SOURCES_PER_CATEGORY)
      const { data: sources, error: srcError } = await supabase
        .from('sources')
        .select('*')
        .eq('category_id', category.id)
        .limit(MAX_SOURCES_PER_CATEGORY) as { data: SourceRow[] | null; error: { message: string } | null };

      if (srcError || !sources || sources.length === 0) {
        log('warn', `No sources found for category ${category.name}`, { error: srcError?.message });
        continue;
      }

      // Step 3: Fetch existing questions for dedup (capped at DEDUP_CAP)
      const { data: existingQuestions } = await supabase
        .from('questions')
        .select('*')
        .eq('category_id', category.id)
        .order('created_at', { ascending: false })
        .limit(DEDUP_CAP) as { data: QuestionRow[] | null; error: unknown };

      const existingQuestionTexts = existingQuestions?.map((q) => q.question_text) ?? [];

      // Build source text for prompt
      const sourceText = sources
        .map((s) => `### ${s.title}\n${s.content}`)
        .join('\n\n');

      // Build dedup context
      let dedupSection = '';
      if (existingQuestionTexts.length > 0) {
        dedupSection = `\n\nExisting questions to avoid (do NOT create similar questions):\n${existingQuestionTexts.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
      }

      // Count total existing questions for the note
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

Reference material:
${sourceText}
${dedupSection}${dedupNote}

Generate ${questionsToGenerate} multiple-choice questions based ONLY on the reference material above. Return as JSON with a "questions" array where each object has exactly these fields:
- "question_text": string (the question)
- "correct_answer": string
- "distractors": array of exactly 3 strings (wrong answers)
- "explanation": string (2-3 sentences)
- "difficulty": "easy" | "normal" | "hard"`;

      // Step 4: Call Claude
      log('info', `Calling Claude for category: ${category.name}`, { questionsToGenerate });

      const response = await claude.messages.create({
        model: config.claudeModelGeneration,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      // Track tokens
      trackUsage(response, tokenAccumulator, SONNET_INPUT, SONNET_OUTPUT);
      checkBudget(tokenAccumulator, config.budgetCapUsd);

      // Step 5: Parse response
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

      // Step 6: Validate and insert each question
      const primarySourceId = sources[0].id;

      for (const question of parsedBatch.questions) {
        try {
          // Validate distractors length
          if (question.distractors.length !== 3) {
            log('warn', 'Question has wrong number of distractors', {
              questionText: question.question_text,
              distractorCount: question.distractors.length,
            });
            failed++;
            continue;
          }

          // Validate no distractor matches correct answer (case-insensitive)
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

          // Insert into questions table
          const insertData: Database['public']['Tables']['questions']['Insert'] = {
            category_id: category.id,
            source_id: primarySourceId,
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

  // If ALL items failed and we attempted to process some, throw
  if (processed === 0 && failed > 0) {
    throw new Error(`All ${failed} questions failed to process`);
  }

  return { processed, failed };
}
