import { PipelineConfig } from '../lib/config.js';
import { createClaudeClient, TokenAccumulator, trackUsage, checkBudget, extractJson, SONNET_INPUT, SONNET_OUTPUT, BudgetExceededError } from '../lib/claude.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { QuestionBatchSchema } from '../lib/schemas.js';
import { log } from '../lib/logger.js';
import { getEligibleCategoriesOrdered } from '../lib/category-selection.js';
import { assertGeneralKnowledge, assertNoGeneralKnowledgeInExtras, GENERAL_KNOWLEDGE_SLUG } from '../lib/general-knowledge-guard.js';
import { resolveSlugsToIds } from '../lib/categories.js';
import type { Database } from '../lib/database.types.js';

export interface AgentResult {
  processed: number;
  failed: number;
}

export const SYSTEM_PROMPT = `You are an expert pub quiz question writer. Write questions a quizmaster would read aloud in a pub — the kind that make a table of friends debate the answer over a pint.

## Audience

This is a **UK pub quiz**. Write for a table of friends in a British pub.

- **UK topics are always welcome:** British history, geography, culture, sport, TV, music, food, monarchy, etc.
- **Global knowledge is welcome:** world geography, science, nature, internationally famous films/TV/music, major world events, well-known world leaders, etc.
- **American topics are fine IF they're globally famous:** Friends, Cheers, Seinfeld, NASA, Hollywood, Lincoln, the moon landings, "how many states in the US", etc.
- **American topics are NOT fine if they're US-internal:** minor US presidents most Brits wouldn't know, US-specific sports (NFL, NBA, NHL, MLB rules/records), US state capitals, US civics, US-only TV shows or celebrities. Ask yourself: "Would a table of 6 in a Manchester pub have a chance at this?" If not, skip it.

When in doubt, lean British or global rather than American.

## Tone — classic UK pub quiz

You are a quizmaster talking to a table of friends, not a teacher setting a comprehension test. Conversational, answer-first phrasing. Open with the subject or the verb. One breath to read aloud.

- Good: "Who scored England's 1966 World Cup hat-trick?" → Geoff Hurst. Broad appeal, answer-first, one breath.
- Bad: "According to the reference material, what does paragraph 3 say about Geoff Hurst's achievements?" — textbook comprehension, banned.
- Good: "Which planet is closest to the Sun?" → Mercury.
- Bad: "Based on the text, which of the following planets has the shortest orbital period?" — exam phrasing, banned.
- Good: "What's the currency of Japan?" → Yen.
- Bad: "It is said that the currency of Japan has several denominations — what is it called?" — hedged opener, banned.

## Rules

1. Favour questions a table of 3+ ordinary adults would have a genuine shot at. Niche-specialist knowledge belongs in niche category rounds, not general ones.
2. Use your own knowledge to write questions. Every answer must be factually correct — you will be fact-checked.
3. NEVER reference source material, textbooks, or articles. These are standalone pub quiz questions.
4. Each question: 1 correct answer + 3 plausible distractors from the same domain (all countries, all years, all people, etc.). Every distractor must be DEFINITELY WRONG — never use a distractor that could also be a correct answer. For example, don't ask "What has blue blood?" with "Octopus" as a distractor, because octopuses also have blue blood.
5. Write a 2-3 sentence explanation for why the correct answer is right.
6. Keep questions to 40-80 characters. One breath to read aloud.
7. Do NOT generate questions similar to ones already listed.

## Categories

Every question belongs to \`general_knowledge\` plus 1-3 specific extra categories. You must:

- Always include \`general_knowledge\` in \`category_scores\`. Never list \`general-knowledge\` in \`category_slugs\` — it is mandatory and injected automatically.
- Propose 1-3 specific extra categories in \`category_slugs\` using kebab-case slugs (e.g. \`science-and-nature\`, \`history\`, \`geography\`).
- Only propose a category if a player who chose that category would expect to see this question — not just tangentially related.

## Scoring

\`category_scores\` values are integers 0-100, representing the percentage of players who chose that category who would answer this question correctly. Score each category separately — a science enthusiast may get a physics question at 75% while the general pub gets 20%.

## Difficulty target (per batch of 5: 2 easy, 2 normal, 1 hard using general_knowledge score)

**Be strict about this.** Most questions end up harder than writers think. When in doubt, rate it harder.

EASY (general_knowledge 67-100) — almost EVERYONE at a pub table would get this:
- "What is the capital of France?" → Paris
- "How many sides does a hexagon have?" → Six

NORMAL (general_knowledge 34-66) — most adults have heard of this but might hesitate:
- "Who wrote the dystopian novel Brave New World?" → Aldous Huxley
- "What is the largest moon in the Solar System?" → Ganymede

HARD (general_knowledge 0-33) — one enthusiast at the table might know:
- "What did Alfred Hitchcock use as blood in Psycho?" → Chocolate syrup
- "Who holds the record for most goals across all FIFA World Cups?" → Miroslav Klose

## Anti-Patterns (never do these)
- Comprehension-test framing. Never phrase questions as "according to the source/reference/text/article/paragraph".
- Hedged or indirect openers ("It is said that...", "One might argue that...", "Some people believe...").
- Trick questions that punish rather than reward thinking
- "You know it or you don't" questions with no room for reasoning
- Textbook/exam phrasing — write like you're talking to a friend
- Niche specialist questions — would 3+ people at a random table have a chance?
- Questions over 100 characters
- Questions about events from the current or previous year — they date fast
- Corporate/business questions (company rebrandings, product launch dates, internal org names)
- Questions where the answer doesn't match the question type
- Never include the correct answer in the question text
- Never include the answer — or a near-answer — in the question text
- Always use a person's full commonly-known name on first mention

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
      type QuestionRow = Database['public']['Tables']['questions']['Row'];
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

      const userPrompt = `Category: ${category.name} (slug: ${category.slug})
${dedupSection}${dedupNote}

Generate ${questionsToGenerate} pub quiz questions about ${category.name}. Use your own knowledge — write questions that are factually correct and would work in a real pub quiz.

Return as JSON with a "questions" array where each object has exactly these fields:
- "question_text": string (the question)
- "correct_answer": string
- "distractors": array of exactly 3 strings (wrong answers)
- "explanation": string (2-3 sentences)
- "category_slugs": array of 1-3 specific extra category slugs (kebab-case). Do NOT include "general-knowledge" here.
- "category_scores": object with snake_case keys and integer values 0-100. Always include "general_knowledge". Include one key per entry in category_slugs (using snake_case). Example: { "general_knowledge": 45, "science_and_nature": 68 }

Example question object:
{
  "question_text": "What is the chemical symbol for gold?",
  "correct_answer": "Au",
  "distractors": ["Ag", "Fe", "Cu"],
  "explanation": "Gold has the symbol Au from the Latin 'aurum'. It is a precious metal used throughout history.",
  "category_slugs": ["science-and-nature"],
  "category_scores": { "general_knowledge": 45, "science_and_nature": 68 }
}`;

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

      // Step 5: Validate and insert each question
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

          // Reverse check: distinctive words from the QUESTION that are substrings of the answer.
          const questionWords = qLowerText
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 5 && !stopwords.has(w));
          const reverseMatch = questionWords.some(w => answerFull.includes(w));

          if (fullMatch || distinctiveMatch || reverseMatch) {
            log('warn', 'Answer appears in question text, skipping question', {
              questionText: question.question_text,
              correctAnswer: question.correct_answer,
              matchType: fullMatch ? 'full' : distinctiveMatch ? 'distinctive-word' : 'reverse-substring',
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

          // D-12: validate general_knowledge is present in scores
          try {
            assertGeneralKnowledge(question.category_scores);
          } catch (gkError) {
            log('error', 'Question missing general_knowledge score, skipping', {
              questionText: question.question_text,
              error: gkError instanceof Error ? gkError.message : String(gkError),
            });
            failed++;
            continue;
          }

          // D-13: validate general-knowledge not in category_slugs (should be caught by Zod but belt-and-suspenders)
          try {
            assertNoGeneralKnowledgeInExtras(question.category_slugs);
          } catch (gkExtrasError) {
            log('error', 'Question proposes general-knowledge as extra, skipping', {
              questionText: question.question_text,
              error: gkExtrasError instanceof Error ? gkExtrasError.message : String(gkExtrasError),
            });
            failed++;
            continue;
          }

          // Resolve slugs to category IDs
          const allSlugs = [...question.category_slugs, GENERAL_KNOWLEDGE_SLUG];
          let slugToId: Map<string, string>;
          try {
            slugToId = await resolveSlugsToIds(supabase, allSlugs);
          } catch (resolveError) {
            log('error', 'Failed to resolve category slugs to IDs, skipping question', {
              questionText: question.question_text,
              slugs: allSlugs,
              error: resolveError instanceof Error ? resolveError.message : String(resolveError),
            });
            failed++;
            continue;
          }

          // Insert question row (transitional: category_id and difficulty placeholders until Plan 05 drops them)
          const { data: inserted, error: qErr } = await supabase
            .from('questions')
            .insert({
              category_id: slugToId.get(GENERAL_KNOWLEDGE_SLUG)!,
              source_id: null,
              question_text: question.question_text,
              correct_answer: question.correct_answer,
              distractors: question.distractors,
              explanation: question.explanation,
              difficulty: 'normal',  // transitional placeholder — dropped in Plan 05
              verification_score: 0,
              status: 'pending',
            } as never)
            .select('id')
            .single();

          if (qErr || !inserted) {
            log('error', 'Failed to insert question', {
              questionText: question.question_text,
              error: qErr ? (qErr as { message: string }).message : 'no data returned',
            });
            failed++;
            continue;
          }

          // Build question_categories rows — include ALL slugs (extras + GK)
          const qcRows = allSlugs.map(slug => {
            const jsonKey = slug.replace(/-/g, '_');
            const score = question.category_scores[jsonKey];
            if (typeof score !== 'number') {
              throw new Error(`Missing score for slug ${slug} (json key ${jsonKey})`);
            }
            return {
              question_id: (inserted as { id: string }).id,
              category_id: slugToId.get(slug)!,
              estimate_score: score,
              observed_n: 0,
            };
          });

          // Single multi-row insert — deferred trigger sees the full set at commit
          const { error: qcErr } = await supabase.from('question_categories').insert(qcRows as never);
          if (qcErr) {
            log('error', 'Failed to insert question_categories rows', {
              questionId: (inserted as { id: string }).id,
              error: (qcErr as { message: string }).message,
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
