import type { TypedSupabaseClient } from './supabase.js';
import { log } from './logger.js';

const DEFAULT_MIN_QUESTIONS_THRESHOLD = 10;

export interface OrderedCategory {
  id: string;
  name: string;
  slug: string;
  questionCount: number;
}

export async function getEligibleCategoriesOrdered(
  supabase: TypedSupabaseClient,
  batchSize: number,
  minQuestionsThreshold?: number,
): Promise<OrderedCategory[]> {
  const threshold = minQuestionsThreshold ?? DEFAULT_MIN_QUESTIONS_THRESHOLD;

  // Fetch all categories
  const { data: categories, error: catError } = await supabase
    .from('categories')
    .select('id, name, slug');

  if (catError || !categories || categories.length === 0) {
    log('warn', 'No categories found or error fetching categories', { error: catError?.message });
    return [];
  }

  // For each category, count questions and check sources
  const eligible: OrderedCategory[] = [];

  for (const cat of categories) {
    // Count questions
    const { count: questionCount, error: qErr } = await supabase
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('category_id', cat.id);

    if (qErr) continue;

    const qCount = questionCount ?? 0;

    // Skip categories at or above threshold
    if (qCount >= threshold) continue;

    // Check sources exist
    const { count: sourceCount, error: sErr } = await supabase
      .from('sources')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', cat.id);

    if (sErr) continue;

    // Skip categories with no sources
    if ((sourceCount ?? 0) === 0) continue;

    eligible.push({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      questionCount: qCount,
    });
  }

  // Sort by question count ascending (least-covered first)
  eligible.sort((a, b) => a.questionCount - b.questionCount);

  // Limit to batch size
  const selected = eligible.slice(0, batchSize);

  if (selected.length > 0) {
    log('info', 'Category selection', {
      eligible: eligible.length,
      selected: selected.length,
      leastCovered: selected[0].name,
    });
  } else {
    log('info', 'Category selection: no eligible categories found');
  }

  return selected;
}
