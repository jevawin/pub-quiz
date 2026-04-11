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

export async function fetchRandomQuestions(
  uiDifficulty: UiDifficulty,
  categorySlug: string,
  n: number,
): Promise<LoadedQuestion[]> {
  const { data, error } = await supabase.rpc('random_published_questions', {
    p_difficulty: uiToDbDifficulty(uiDifficulty),
    p_category_slug: categorySlug,
    p_limit: n,
  });
  if (error) throw error;
  const rows = (data ?? []) as RpcRow[];
  if (rows.length === 0) throw new Error('No questions returned');
  return rows.map((r) => {
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
  });
}
