import type { LoadedQuestion, AnswerRecord } from '@/state/quiz';
import type { UiDifficulty } from '@/lib/difficulty';

const KEY = 'pq_active_quiz';

export type PersistedQuiz = {
  questions: LoadedQuestion[];
  answers: AnswerRecord[];
  currentIndex: number;
  config: { category: string; difficulty: UiDifficulty; count: number };
  startedAt: number;
};

export function saveQuizState(data: PersistedQuiz): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

export function loadQuizState(): PersistedQuiz | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedQuiz;
  } catch {
    return null;
  }
}

export function clearQuizState(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Ignore
  }
}
