import { supabase } from './supabase';
import { shuffle } from './shuffle';
import { uiToDbDifficulties, type UiDifficulty } from './difficulty';
import type { LoadedQuestion } from '@/state/quiz';

type RpcRow = {
  id: string;
  question_text: string;
  correct_answer: string;
  distractors: string[];
  explanation: string | null;
  category_id: string;
  category_slug: string;
};

function toLoadedQuestion(r: RpcRow): LoadedQuestion {
  const distractors = Array.isArray(r.distractors) ? r.distractors : [];
  const options = shuffle([r.correct_answer, ...distractors]);
  const correctIndex = options.indexOf(r.correct_answer);
  return {
    id: r.id,
    question_text: r.question_text,
    options,
    correctIndex,
    explanation: r.explanation,
    category_slug: r.category_slug ?? 'general',
  };
}

/** Fetch rows for one difficulty + category slug combo. */
async function fetchForDifficulty(
  dbDifficulty: string,
  categorySlug: string,
  limit: number,
): Promise<RpcRow[]> {
  const { data, error } = await supabase.rpc('random_published_questions', {
    p_difficulty: dbDifficulty,
    p_category_slug: categorySlug,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as RpcRow[];
}

function dedupeAndLimit(batches: RpcRow[][], n: number): RpcRow[] {
  const seen = new Set<string>();
  const all: RpcRow[] = [];
  for (const rows of batches) {
    for (const row of rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        all.push(row);
      }
    }
  }
  return shuffle(all).slice(0, n);
}

export async function fetchRandomQuestions(
  uiDifficulty: UiDifficulty,
  categorySlugs: string[],
  n: number,
): Promise<LoadedQuestion[]> {
  const dbDifficulties = uiToDbDifficulties(uiDifficulty);
  const allSelected = categorySlugs.length === 0 || categorySlugs.includes('general');
  const slugs = allSelected ? ['general'] : categorySlugs;

  // Build all (difficulty × category) RPC calls
  const perCombo = Math.max(1, Math.ceil(n / (dbDifficulties.length * slugs.length)) + 2);
  const batches = await Promise.all(
    dbDifficulties.flatMap((diff) =>
      slugs.map((slug) => fetchForDifficulty(diff, slug, perCombo)),
    ),
  );

  const limited = dedupeAndLimit(batches, n);
  if (limited.length === 0) throw new Error('No questions found — try a different category or difficulty');
  return limited.map(toLoadedQuestion);
}
