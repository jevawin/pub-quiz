import { describe, it, expect } from 'vitest';
import {
  quizReducer,
  initialQuizState,
  selectScore,
  type LoadedQuestion,
  type QuizState,
} from './quiz';

function makeQuestion(id: string, correctIndex = 0): LoadedQuestion {
  return {
    id,
    question_text: `Question ${id}?`,
    options: ['A', 'B', 'C', 'D'],
    correctIndex,
    explanation: null,
  };
}

describe('quizReducer', () => {
  it('initial state phase is idle', () => {
    expect(initialQuizState.phase).toBe('idle');
  });

  it('START action transitions to playing at index 0 with the given questions', () => {
    const questions = [makeQuestion('q1'), makeQuestion('q2')];
    const state = quizReducer(initialQuizState, {
      type: 'START',
      questions,
      startedAt: 1000,
    });
    expect(state.phase).toBe('playing');
    if (state.phase === 'playing') {
      expect(state.index).toBe(0);
      expect(state.questions).toBe(questions);
      expect(state.answers).toEqual([]);
      expect(state.startedAt).toBe(1000);
    }
  });

  it('ANSWER records the chosen index + elapsedMs and transitions to revealed', () => {
    const questions = [makeQuestion('q1', 2)];
    let state: QuizState = quizReducer(initialQuizState, {
      type: 'START',
      questions,
      startedAt: 0,
    });
    state = quizReducer(state, { type: 'ANSWER', chosenIndex: 2, elapsedMs: 500 });
    expect(state.phase).toBe('revealed');
    if (state.phase === 'revealed') {
      expect(state.answers).toHaveLength(1);
      expect(state.answers[0].questionId).toBe('q1');
      expect(state.answers[0].chosenIndex).toBe(2);
      expect(state.answers[0].isCorrect).toBe(true);
      expect(state.answers[0].elapsedMs).toBe(500);
      expect(state.answers[0].reaction).toBeNull();
    }
  });

  it('from revealed, FEEDBACK sets the reaction on the last answer', () => {
    const questions = [makeQuestion('q1'), makeQuestion('q2')];
    let state: QuizState = quizReducer(initialQuizState, {
      type: 'START',
      questions,
      startedAt: 0,
    });
    state = quizReducer(state, { type: 'ANSWER', chosenIndex: 0, elapsedMs: 100 });
    state = quizReducer(state, { type: 'FEEDBACK', reaction: 'good' });
    if (state.phase === 'revealed') {
      expect(state.answers[0].reaction).toBe('good');
    }
  });

  it('NEXT from revealed advances index by 1 and returns to playing', () => {
    const questions = [makeQuestion('q1'), makeQuestion('q2'), makeQuestion('q3')];
    let state: QuizState = quizReducer(initialQuizState, {
      type: 'START',
      questions,
      startedAt: 0,
    });
    state = quizReducer(state, { type: 'ANSWER', chosenIndex: 0, elapsedMs: 100 });
    state = quizReducer(state, { type: 'NEXT' });
    expect(state.phase).toBe('playing');
    if (state.phase === 'playing') {
      expect(state.index).toBe(1);
    }
  });

  it('NEXT on last question transitions to finished', () => {
    const questions = [makeQuestion('q1')];
    let state: QuizState = quizReducer(initialQuizState, {
      type: 'START',
      questions,
      startedAt: 0,
    });
    state = quizReducer(state, { type: 'ANSWER', chosenIndex: 0, elapsedMs: 100 });
    state = quizReducer(state, { type: 'NEXT' });
    expect(state.phase).toBe('finished');
  });

  it('RESET returns to idle', () => {
    const questions = [makeQuestion('q1')];
    let state: QuizState = quizReducer(initialQuizState, {
      type: 'START',
      questions,
      startedAt: 0,
    });
    state = quizReducer(state, { type: 'RESET' });
    expect(state.phase).toBe('idle');
  });

  it('selectScore sums isCorrect === true across answers', () => {
    const questions = [makeQuestion('q1', 0), makeQuestion('q2', 1), makeQuestion('q3', 2)];
    let state: QuizState = quizReducer(initialQuizState, {
      type: 'START',
      questions,
      startedAt: 0,
    });
    // Answer q1 correctly (correct=0, chosen=0)
    state = quizReducer(state, { type: 'ANSWER', chosenIndex: 0, elapsedMs: 100 });
    state = quizReducer(state, { type: 'NEXT' });
    // Answer q2 incorrectly (correct=1, chosen=3)
    state = quizReducer(state, { type: 'ANSWER', chosenIndex: 3, elapsedMs: 200 });
    state = quizReducer(state, { type: 'NEXT' });
    // Answer q3 correctly (correct=2, chosen=2)
    state = quizReducer(state, { type: 'ANSWER', chosenIndex: 2, elapsedMs: 300 });

    expect(selectScore(state)).toBe(2);
    // idle state returns 0
    expect(selectScore(initialQuizState)).toBe(0);
  });
});
