import { createHash } from 'node:crypto';
import { createSupabaseClient } from '../lib/supabase.js';
import { searchArticles, getArticleText } from '../lib/wikipedia.js';
import { createClaudeClient, trackUsage, checkBudget, extractJson, HAIKU_INPUT, HAIKU_OUTPUT, BudgetExceededError } from '../lib/claude.js';
import type { TokenAccumulator } from '../lib/claude.js';
import type { PipelineConfig } from '../lib/config.js';
import type { Database } from '../lib/database.types.js';
import { log } from '../lib/logger.js';

type SourceInsert = Database['public']['Tables']['sources']['Insert'];

export interface AgentResult {
  processed: number;
  failed: number;
}

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
}

export async function runKnowledgeAgent(config: PipelineConfig, tokenAccumulator: TokenAccumulator): Promise<AgentResult> {
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const claude = createClaudeClient(config.anthropicApiKey);

  // 1. Fetch all categories
  log('info', 'Fetching categories for knowledge sourcing');
  const { data: allCategories, error: catError } = await supabase
    .from('categories')
    .select('id, name, slug');

  if (catError) {
    throw new Error(`Failed to fetch categories: ${catError.message}`);
  }

  const categories: CategoryRow[] = allCategories ?? [];
  log('info', 'Found categories', { count: categories.length });

  // 2. Find categories needing sources (fewer than 3)
  const categoriesNeedingSources: CategoryRow[] = [];

  for (const cat of categories) {
    const { data: sources, error: srcError } = await supabase
      .from('sources')
      .select('id')
      .eq('category_id', cat.id);

    if (srcError) {
      log('warn', 'Failed to check sources for category', { category: cat.name, error: srcError.message });
      continue;
    }

    if ((sources?.length ?? 0) < 3) {
      categoriesNeedingSources.push(cat);
    }

    if (categoriesNeedingSources.length >= config.knowledgeBatchSize) {
      break;
    }
  }

  log('info', 'Categories needing sources', { count: categoriesNeedingSources.length });

  // 3. Process each category with per-item error handling
  let processed = 0;
  let failed = 0;

  for (const category of categoriesNeedingSources) {
    try {
      // Build richer search query from category hierarchy (D-07)
      let searchTerms = category.name;
      let parentName: string | null = null;

      // Fetch category with parent_id
      const { data: categoryWithParent } = await supabase
        .from('categories')
        .select('id, name, slug, parent_id')
        .eq('id', category.id)
        .single();

      if (categoryWithParent?.parent_id) {
        const { data: parent } = await supabase
          .from('categories')
          .select('name')
          .eq('id', categoryWithParent.parent_id)
          .single();
        if (parent) {
          parentName = parent.name;
          searchTerms = `${category.name} ${parent.name}`;
        }
      } else {
        // Top-level: fetch children for context
        const { data: children } = await supabase
          .from('categories')
          .select('name')
          .eq('parent_id', category.id)
          .limit(3);
        if (children && children.length > 0) {
          searchTerms += ' ' + children.map((c: { name: string }) => c.name).join(' ');
        }
      }

      // Search Wikipedia for relevant articles
      let titles = await searchArticles(searchTerms, config.wikipediaUserAgent, 5);
      log('info', 'Wikipedia search results', { category: category.name, count: titles.length });

      // Fallback search when initial results sparse (D-08)
      if (titles.length < 2) {
        const fallbackTerms = parentName
          ? parentName
          : category.name.split(' ')[0];
        log('info', 'Retrying Wikipedia search with fallback terms', {
          category: category.name,
          fallbackTerms,
          originalResults: titles.length,
        });
        const fallbackTitles = await searchArticles(fallbackTerms, config.wikipediaUserAgent, 5);
        // Merge, dedup by title
        const existingSet = new Set(titles);
        for (const t of fallbackTitles) {
          if (!existingSet.has(t)) titles.push(t);
        }
      }

      for (const title of titles) {
        try {
          // Fetch article text
          const content = await getArticleText(title, config.wikipediaUserAgent, config.wikipediaMaxContentLength);

          if (content === null) {
            log('debug', 'Skipping missing Wikipedia page', { title });
            continue;
          }

          // Haiku relevance filtering (D-06)
          const relevancePrompt = `You are evaluating whether a Wikipedia article is relevant to a specific quiz category.

Category: ${category.name}
Article title: ${title}
Article excerpt: ${content.slice(0, 500)}

Rate the relevance of this article to the category on a scale of 0.0 to 1.0.
- 1.0 = directly about this category topic
- 0.5 = somewhat related
- 0.0 = completely unrelated

Return JSON: {"relevance": <number>, "reasoning": "<brief explanation>"}`;

          const relevanceResponse = await claude.messages.create({
            model: config.claudeModelVerification,
            max_tokens: 256,
            messages: [{ role: 'user', content: relevancePrompt }],
          });

          trackUsage(relevanceResponse, tokenAccumulator, HAIKU_INPUT, HAIKU_OUTPUT);
          checkBudget(tokenAccumulator, config.budgetCapUsd);

          const relevanceText = relevanceResponse.content.find((c: { type: string }) => c.type === 'text');
          let relevanceScore = 0;
          if (relevanceText && relevanceText.type === 'text') {
            try {
              const relevanceJson = JSON.parse(extractJson((relevanceText as { type: 'text'; text: string }).text));
              relevanceScore = typeof relevanceJson.relevance === 'number' ? relevanceJson.relevance : 0;
            } catch {
              log('warn', 'Failed to parse relevance score, skipping article', { title });
              continue;
            }
          }

          if (relevanceScore < config.relevanceThreshold) {
            log('info', 'Skipping low-relevance article', { title, relevanceScore, threshold: config.relevanceThreshold });
            continue;
          }

          // Compute SHA-256 hash for dedup
          const contentHash = createHash('sha256').update(content).digest('hex');

          // Check if content_hash already exists
          const { data: existing } = await supabase
            .from('sources')
            .select('id')
            .eq('content_hash', contentHash);

          if (existing && existing.length > 0) {
            log('debug', 'Skipping duplicate content', { title, contentHash });
            continue;
          }

          // Build Wikipedia URL
          const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

          // Insert into sources table
          const insertPayload: SourceInsert = {
            category_id: category.id,
            title,
            url,
            content,
            content_hash: contentHash,
          };
          const { error: insertError } = await supabase
            .from('sources')
            .insert(insertPayload)
            .select('id')
            .single();

          if (insertError) {
            log('error', 'Failed to insert source', { title, category: category.name, error: insertError.message });
            failed++;
            continue;
          }

          log('info', 'Inserted source', { title, category: category.name });
          processed++;
        } catch (err) {
          if (err instanceof BudgetExceededError) throw err;
          const errorMessage = err instanceof Error ? err.message : String(err);
          log('error', 'Failed to process article', { title, category: category.name, error: errorMessage });
          failed++;
        }
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      const errorMessage = err instanceof Error ? err.message : String(err);
      log('error', 'Failed to process category', { category: category.name, error: errorMessage });
      failed++;
    }
  }

  log('info', 'Knowledge Agent complete', { processed, failed });

  // Only throw if ALL items failed
  if (processed === 0 && failed > 0) {
    throw new Error(`Knowledge Agent: all ${failed} sources failed to process`);
  }

  return { processed, failed };
}
