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

  // Fetch subcategories only (depth >= 1) — root categories are browse containers, not question generators
  const { data: categories, error: catError } = await supabase
    .from('categories')
    .select('id, name, slug, depth')
    .gte('depth', 1);

  if (catError || !categories || categories.length === 0) {
    log('warn', 'No categories found or error fetching categories', { error: catError?.message });
    return [];
  }

  // For each category, count questions — no source requirement (questions generated from Claude's knowledge)
  const eligible: OrderedCategory[] = [];

  for (const cat of categories) {
    // Phase 999.8 Plan 05: questions.category_id is gone — count via the
    // question_categories join table (one row per (question, category)).
    const { count: questionCount, error: qErr } = await supabase
      .from('question_categories')
      .select('question_id', { count: 'exact', head: true })
      .eq('category_id', cat.id);

    if (qErr) continue;

    const qCount = questionCount ?? 0;

    // Skip categories at or above threshold
    if (qCount >= threshold) continue;

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
