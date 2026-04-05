import { PipelineConfig } from '../lib/config.js';
import { createClaudeClient, TokenAccumulator, trackUsage, checkBudget, extractJson, HAIKU_INPUT, HAIKU_OUTPUT, BudgetExceededError } from '../lib/claude.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { searchArticles, getArticleText } from '../lib/wikipedia.js';
import { log } from '../lib/logger.js';
import type { Database } from '../lib/database.types.js';

type QuestionRow = Database['public']['Tables']['questions']['Row'];

export interface EnrichmentResult {
  enriched: number;
  skipped: number;
  failed: number;
}

const SYSTEM_PROMPT = `You are writing fun facts for a pub quiz app. After a player answers a question (right or wrong), they see your fun fact. Your job is to make the answer memorable and shareable.

Rules:
- 1-2 sentences max. Must work as standalone text (will be used in SMS).
- Lead with the surprising part. Don't build up to it.
- Be CONCRETE: specific numbers, names, dates, vivid details. Not vague statements.
- Must CONNECT to the answer — extend what the player just learned, don't go on a tangent.
- Must be SURPRISING — the reader should think "oh really?" or "I didn't know that."
- Write conversationally, like telling a mate at the pub. Not like an encyclopaedia.
- Do NOT restate the correct answer or explain why it's right.
- Do NOT start with "Did you know" — just state the fact.

Good: "He didn't even want the job — Pope Julius II essentially forced him into it. He considered himself a sculptor, not a painter."
Bad: "Michelangelo was an Italian Renaissance artist who painted many famous works."

Good: "Honey never spoils. Archaeologists found 3,000-year-old honey in Egyptian tombs that was still edible."
Bad: "Honey has a very long shelf life due to its chemical properties."

Return JSON: {"fun_fact": "your fact here"}`;

export async function runEnrichmentAgent(
  config: PipelineConfig,
  tokenAccumulator: TokenAccumulator,
): Promise<EnrichmentResult> {
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const claude = createClaudeClient(config.anthropicApiKey);

  let enriched = 0;
  let skipped = 0;
  let failed = 0;

  log('info', 'Enrichment Agent starting');

  // Fetch published questions without fun facts
  const { data: questions, error: fetchError } = await supabase
    .from('questions')
    .select('*')
    .eq('status', 'published')
    .is('fun_fact', null)
    .limit(50) as { data: QuestionRow[] | null; error: { message: string } | null };

  if (fetchError || !questions || questions.length === 0) {
    log('info', 'No published questions needing enrichment', { error: fetchError?.message });
    return { enriched: 0, skipped: 0, failed: 0 };
  }

  log('info', `Found ${questions.length} questions to enrich`);

  for (const question of questions) {
    try {
      // Search Wikipedia for the answer topic
      const searchQuery = `${question.correct_answer} ${question.question_text}`;
      const titles = await searchArticles(searchQuery, config.wikipediaUserAgent, 1);

      let articleText: string | null = null;
      if (titles.length > 0) {
        articleText = await getArticleText(titles[0], config.wikipediaUserAgent, config.wikipediaMaxContentLength);
      }

      if (!articleText) {
        // Try searching just the answer
        const fallbackTitles = await searchArticles(question.correct_answer, config.wikipediaUserAgent, 1);
        if (fallbackTitles.length > 0) {
          articleText = await getArticleText(fallbackTitles[0], config.wikipediaUserAgent, config.wikipediaMaxContentLength);
        }
      }

      if (!articleText) {
        log('info', 'No Wikipedia source found for enrichment', { questionId: question.id, answer: question.correct_answer });
        skipped++;
        continue;
      }

      // Call Haiku to generate the fun fact
      const userPrompt = `Question: ${question.question_text}
Correct answer: ${question.correct_answer}
Category: ${question.category_id}

Reference material about the answer:
${articleText}

Write a fun fact about the correct answer that would make someone say "oh really?" after answering this question. Remember: don't restate the answer, don't explain why it's right — add something new and surprising.`;

      const response = await claude.messages.create({
        model: config.claudeModelVerification,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      trackUsage(response, tokenAccumulator, HAIKU_INPUT, HAIKU_OUTPUT);
      checkBudget(tokenAccumulator, config.budgetCapUsd);

      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        log('warn', 'No text content in enrichment response', { questionId: question.id });
        failed++;
        continue;
      }

      let funFact: string;
      try {
        const jsonStr = extractJson(textContent.text);
        const parsed = JSON.parse(jsonStr);
        funFact = parsed.fun_fact;
        if (!funFact || typeof funFact !== 'string' || funFact.length < 10) {
          throw new Error('Invalid fun_fact');
        }
      } catch {
        log('warn', 'Failed to parse enrichment response', { questionId: question.id });
        failed++;
        continue;
      }

      // Update the question with the fun fact
      const { error: updateError } = await (supabase
        .from('questions')
        .update({ fun_fact: funFact } as never)
        .eq('id', question.id) as unknown as Promise<{ error: { message: string } | null }>);

      if (updateError) {
        log('error', 'Failed to update fun fact', { questionId: question.id, error: updateError.message });
        failed++;
        continue;
      }

      log('info', 'Question enriched', { questionId: question.id, funFact: funFact.slice(0, 60) + '...' });
      enriched++;
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      log('error', 'Enrichment error', {
        questionId: question.id,
        error: err instanceof Error ? err.message : String(err),
      });
      failed++;
    }
  }

  log('info', 'Enrichment Agent completed', { enriched, skipped, failed });
  return { enriched, skipped, failed };
}
