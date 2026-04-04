import { createHash } from 'node:crypto';
import { createSupabaseClient } from '../lib/supabase.js';
import { searchArticles, getArticleText } from '../lib/wikipedia.js';
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

export async function runKnowledgeAgent(config: PipelineConfig): Promise<AgentResult> {
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);

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
      // Search Wikipedia for relevant articles
      const titles = await searchArticles(category.name, config.wikipediaUserAgent, 5);
      log('info', 'Wikipedia search results', { category: category.name, count: titles.length });

      for (const title of titles) {
        try {
          // Fetch article text
          const content = await getArticleText(title, config.wikipediaUserAgent, config.wikipediaMaxContentLength);

          if (content === null) {
            log('debug', 'Skipping missing Wikipedia page', { title });
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
          const errorMessage = err instanceof Error ? err.message : String(err);
          log('error', 'Failed to process article', { title, category: category.name, error: errorMessage });
          failed++;
        }
      }
    } catch (err) {
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
