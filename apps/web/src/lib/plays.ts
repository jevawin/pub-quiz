import { supabase } from './supabase';
import { enqueue, flushOutbox, size } from './outbox';

export type QuestionPlayRow = {
  session_id: string;
  question_id: string;
  chosen_option: string;
  is_correct: boolean;
  time_to_answer_ms: number;
  played_at: string;
};

export type QuizSessionRow = {
  // Client-generated so the rating (on tap) and the text (on Submit) land in one row.
  // Optional: rows queued in the outbox before 00043 have no id.
  id?: string;
  session_id: string;
  category_slug: string;
  difficulty: 'easy' | 'normal' | 'hard' | 'mixed';
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

async function saveSession(row: QuizSessionRow): Promise<{ error: unknown }> {
  // Upsert via RPC (migration 00043): quiz_sessions RLS is insert-only, and the
  // RPC is the only path that may update a row (rating/text only, own rows only).
  // session_id is taken from auth.uid() server-side.
  const { error } = await supabase.rpc('save_quiz_session', {
    p_id: row.id ?? null,
    p_category_slug: row.category_slug,
    p_difficulty: row.difficulty,
    p_num_questions: row.num_questions,
    p_score: row.score,
    p_overall_rating: row.overall_rating,
    p_feedback_text: row.feedback_text,
    p_started_at: row.started_at,
  });
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

export async function recordQuestionFeedback(
  sessionId: string,
  questionId: string,
  feedbackText: string,
): Promise<void> {
  await supabase.from('question_feedback').insert({
    session_id: sessionId,
    question_id: questionId,
    feedback_text: feedbackText,
  });
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

// Idempotent per row.id: safe to call again as the rating/text change; queued
// retries replay in order, so the last save wins.
export async function recordQuizSession(row: QuizSessionRow): Promise<void> {
  // Anything already queued is older: queue behind it so a late retry can't
  // overwrite this save with a stale rating/text.
  if (size('quiz_sessions') > 0) {
    enqueue('quiz_sessions', row);
    flushOutbox<QuizSessionRow>('quiz_sessions', saveSession).catch(() => {});
    return;
  }
  const { error } = await saveSession(row);
  if (error) {
    enqueue('quiz_sessions', row);
    return;
  }
  flushOutbox<QuizSessionRow>('quiz_sessions', saveSession).catch(() => {});
}
