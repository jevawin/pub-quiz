export type LoadedQuestion = {
  id: string;
  question_text: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
  fun_fact: string | null;
  category_slug: string;
};

export type AnswerRecord = {
  questionId: string;
  chosenIndex: number;
  isCorrect: boolean;
  elapsedMs: number;
};

export type QuizPhase = 'idle' | 'loading' | 'playing' | 'revealed' | 'reviewing' | 'finished';

export type QuizState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | {
      phase: 'playing' | 'revealed' | 'reviewing' | 'finished';
      questions: LoadedQuestion[];
      index: number;
      /** The index of the next unanswered question (the "frontier"). */
      currentIndex: number;
      answers: AnswerRecord[];
      startedAt: number;
      /** Index of the selected (but not yet confirmed) option, or null. */
      selectedIndex: number | null;
    };

export type QuizAction =
  | { type: 'LOAD' }
  | { type: 'START'; questions: LoadedQuestion[]; startedAt: number }
  | { type: 'RESTORE'; questions: LoadedQuestion[]; answers: AnswerRecord[]; currentIndex: number; startedAt: number }
  | { type: 'SELECT'; chosenIndex: number }
  | { type: 'ANSWER'; chosenIndex: number; elapsedMs: number }
  | { type: 'NEXT' }
  | { type: 'VIEW_PREVIOUS' }
  | { type: 'VIEW_CURRENT' }
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
        currentIndex: 0,
        answers: [],
        startedAt: action.startedAt,
        selectedIndex: null,
      };
    case 'RESTORE':
      return {
        phase: 'playing',
        questions: action.questions,
        index: action.currentIndex,
        currentIndex: action.currentIndex,
        answers: action.answers,
        startedAt: action.startedAt,
        selectedIndex: null,
      };
    case 'SELECT': {
      if (state.phase !== 'playing') return state;
      return { ...state, selectedIndex: action.chosenIndex };
    }
    case 'ANSWER': {
      if (state.phase !== 'playing') return state;
      const q = state.questions[state.index]!;
      const record: AnswerRecord = {
        questionId: q.id,
        chosenIndex: action.chosenIndex,
        isCorrect: action.chosenIndex === q.correctIndex,
        elapsedMs: action.elapsedMs,
      };
      return { ...state, phase: 'revealed', answers: [...state.answers, record], selectedIndex: null };
    }
    case 'NEXT': {
      if (state.phase !== 'revealed') return state;
      const nextIndex = state.index + 1;
      if (nextIndex >= state.questions.length) return { ...state, phase: 'finished', currentIndex: nextIndex };
      return { ...state, phase: 'playing', index: nextIndex, currentIndex: nextIndex, selectedIndex: null };
    }
    case 'VIEW_PREVIOUS': {
      if (state.phase === 'idle' || state.phase === 'loading') return state;
      if (state.index <= 0) return state;
      return { ...state, phase: 'reviewing', index: state.index - 1, selectedIndex: null };
    }
    case 'VIEW_CURRENT': {
      if (state.phase !== 'reviewing') return state;
      const atFrontier = state.currentIndex;
      if (atFrontier >= state.questions.length) return { ...state, phase: 'finished', index: atFrontier };
      // If we have an answer for the current question but haven't given feedback yet, go to revealed
      const hasAnswer = state.answers.length > atFrontier;
      return {
        ...state,
        index: atFrontier,
        phase: hasAnswer ? 'revealed' : 'playing',
      };
    }
    case 'RESET':
      return { phase: 'idle' };
  }
}

export function selectScore(state: QuizState): number {
  if (state.phase === 'idle' || state.phase === 'loading') return 0;
  return state.answers.filter((a) => a.isCorrect).length;
}
