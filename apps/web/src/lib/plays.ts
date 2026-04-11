import { supabase } from './supabase';
import { enqueue, flushOutbox } from './outbox';

export type QuestionPlayRow = {
  session_id: string;
  question_id: string;
  chosen_option: string;
  is_correct: boolean;
  time_to_answer_ms: number;
  feedback_reaction: 'easy' | 'medium' | 'hard' | null;
  played_at: string;
};

export type QuizSessionRow = {
  session_id: string;
  category_slug: string;
  difficulty: 'easy' | 'normal' | 'hard';
  num_questions: 5 | 10 | 15 | 20;
  score: number;
  overall_rating: 'good' | 'okay' | 'bad' | null;
  feedback_text: string | null;
  started_at: string;
};

async function insertPlay(row: QuestionPlayRow): Promise<{ error: unknown }> {
  // IMPORTANT: do NOT chain .select() — insert-only RLS has no SELECT policy.
  const { error } = await supabase.from('question_plays').insert(row);
  return { error };
}

async function insertSession(row: QuizSessionRow): Promise<{ error: unknown }> {
  // IMPORTANT: do NOT chain .select() — insert-only RLS has no SELECT policy.
  const { error } = await supabase.from('quiz_sessions').insert(row);
  return { error };
}

export async function recordQuestionPlay(row: QuestionPlayRow): Promise<void> {
  const { error } = await insertPlay(row);
  if (error) {
    enqueue('question_plays', row);
    return;
  }
  flushOutbox<QuestionPlayRow>('question_plays', insertPlay).catch(() => {});
}

export async function recordRecategorisation(
  sessionId: string,
  questionId: string,
  suggestedCategorySlug: string,
): Promise<void> {
  await supabase.from('question_recategorisations').insert({
    session_id: sessionId,
    question_id: questionId,
    suggested_category_slug: suggestedCategorySlug,
  });
}

export async function recordQuizSession(row: QuizSessionRow): Promise<void> {
  const { error } = await insertSession(row);
  if (error) {
    enqueue('quiz_sessions', row);
    return;
  }
  flushOutbox<QuizSessionRow>('quiz_sessions', insertSession).catch(() => {});
}
