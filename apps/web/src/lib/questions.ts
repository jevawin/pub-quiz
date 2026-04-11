import { supabase } from './supabase';
import { shuffle } from './shuffle';
import { uiToDbDifficulty, type UiDifficulty } from './difficulty';
import type { LoadedQuestion } from '@/state/quiz';

type RpcRow = {
  id: string;
  question_text: string;
  correct_answer: string;
  distractors: string[];
  explanation: string | null;
  category_id: string;
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
  };
}

export async function fetchRandomQuestions(
  uiDifficulty: UiDifficulty,
  categorySlugs: string[],
  n: number,
): Promise<LoadedQuestion[]> {
  const dbDifficulty = uiToDbDifficulty(uiDifficulty);

  // All categories or just "general" → single call with general (returns everything)
  const allSelected = categorySlugs.length === 0 || categorySlugs.includes('general');
  if (allSelected) {
    const { data, error } = await supabase.rpc('random_published_questions', {
      p_difficulty: dbDifficulty,
      p_category_slug: 'general',
      p_limit: n,
    });
    if (error) throw error;
    const rows = (data ?? []) as RpcRow[];
    if (rows.length === 0) throw new Error('No questions found — try a different category or difficulty');
    return rows.map(toLoadedQuestion);
  }

  // Multiple specific categories → call per category, combine, shuffle, limit
  const perCategory = Math.max(1, Math.ceil(n / categorySlugs.length) + 2); // overfetch slightly
  const results = await Promise.all(
    categorySlugs.map(async (slug) => {
      const { data, error } = await supabase.rpc('random_published_questions', {
        p_difficulty: dbDifficulty,
        p_category_slug: slug,
        p_limit: perCategory,
      });
      if (error) throw error;
      return (data ?? []) as RpcRow[];
    }),
  );

  // Deduplicate by id, shuffle, take n
  const seen = new Set<string>();
  const all: RpcRow[] = [];
  for (const rows of results) {
    for (const row of rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        all.push(row);
      }
    }
  }
  const shuffled = shuffle(all);
  const limited = shuffled.slice(0, n);
  if (limited.length === 0) throw new Error('No questions found — try a different category or difficulty');
  return limited.map(toLoadedQuestion);
}
