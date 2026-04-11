export type LoadedQuestion = {
  id: string;
  question_text: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
};

export type AnswerRecord = {
  questionId: string;
  chosenIndex: number;
  isCorrect: boolean;
  elapsedMs: number;
  reaction: 'good' | 'bad' | 'confusing' | null;
};

export type QuizPhase = 'idle' | 'loading' | 'playing' | 'revealed' | 'finished';

export type QuizState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | {
      phase: 'playing' | 'revealed' | 'finished';
      questions: LoadedQuestion[];
      index: number;
      answers: AnswerRecord[];
      startedAt: number;
    };

export type QuizAction =
  | { type: 'LOAD' }
  | { type: 'START'; questions: LoadedQuestion[]; startedAt: number }
  | { type: 'ANSWER'; chosenIndex: number; elapsedMs: number }
  | { type: 'FEEDBACK'; reaction: 'good' | 'bad' | 'confusing' | null }
  | { type: 'NEXT' }
  | { type: 'RESET' };

export const initialQuizState: QuizState = { phase: 'idle' };

export function quizReducer(state: QuizState, action: QuizAction): QuizState {
  switch (action.type) {
    case 'LOAD':
      return { phase: 'loading' };
    case 'START':
      return {
        phase: 'playing',
        questions: action.questions,
        index: 0,
        answers: [],
        startedAt: action.startedAt,
      };
    case 'ANSWER': {
      if (state.phase !== 'playing') return state;
      const q = state.questions[state.index]!;
      const record: AnswerRecord = {
        questionId: q.id,
        chosenIndex: action.chosenIndex,
        isCorrect: action.chosenIndex === q.correctIndex,
        elapsedMs: action.elapsedMs,
        reaction: null,
      };
      return { ...state, phase: 'revealed', answers: [...state.answers, record] };
    }
    case 'FEEDBACK': {
      if (state.phase !== 'revealed') return state;
      const answers = state.answers.slice();
      const last = answers[answers.length - 1];
      if (last) answers[answers.length - 1] = { ...last, reaction: action.reaction };
      return { ...state, answers };
    }
    case 'NEXT': {
      if (state.phase !== 'revealed') return state;
      const nextIndex = state.index + 1;
      if (nextIndex >= state.questions.length) return { ...state, phase: 'finished' };
      return { ...state, phase: 'playing', index: nextIndex };
    }
    case 'RESET':
      return { phase: 'idle' };
  }
}

export function selectScore(state: QuizState): number {
  if (state.phase === 'idle' || state.phase === 'loading') return 0;
  return state.answers.filter((a) => a.isCorrect).length;
}
