import { useReducer, useEffect, useRef, useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { quizReducer, initialQuizState, selectScore } from '@/state/quiz';
import type { LoadedQuestion } from '@/state/quiz';
import { createActiveTimer } from '@/lib/activeTimer';
import { recordQuestionPlay, recordRecategorisation } from '@/lib/plays';
import { ensureSessionId } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { findCategory, CATEGORY_OPTIONS } from '@/config/categories';
import { CheckCircle, XCircle, LogOut, Smile, Flame, Skull, Wind, ThumbsUp, X, ChevronLeft, ArrowRight } from 'lucide-react';
import type { UiDifficulty } from '@/lib/difficulty';

type LocationState = {
  questions: LoadedQuestion[];
  config: { category: string; difficulty: UiDifficulty; count: number };
  startedAt: number;
};

const DIFFICULTY_ICONS = { Easy: Smile, Medium: Flame, Hard: Skull } as const;

export function Play() {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(quizReducer, initialQuizState);
  const timerRef = useRef<ReturnType<typeof createActiveTimer> | null>(null);
  const initialised = useRef(false);
  const [showRecategorise, setShowRecategorise] = useState(false);

  const locationState = location.state as LocationState | undefined;

  // Redirect if no router state (deep-link protection)
  useEffect(() => {
    if (!locationState?.questions) {
      navigate('/', { replace: true });
      return;
    }
    if (!initialised.current) {
      initialised.current = true;
      timerRef.current = createActiveTimer();
      timerRef.current.reset();
      dispatch({
        type: 'START',
        questions: locationState.questions,
        startedAt: locationState.startedAt,
      });
    }
  }, [locationState, navigate]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      timerRef.current?.destroy();
    };
  }, []);

  // Reset timer on each new question (playing phase)
  useEffect(() => {
    if (state.phase === 'playing' && timerRef.current) {
      timerRef.current.reset();
    }
  }, [state.phase === 'playing' ? (state.phase === 'playing' ? state.index : -1) : -1]);

  // Navigate to /done on finish
  useEffect(() => {
    if (state.phase === 'finished') {
      navigate('/done', {
        replace: true,
        state: {
          score: selectScore(state),
          config: locationState?.config,
          startedAt: state.startedAt,
          answers: state.answers,
        },
      });
    }
  }, [state.phase, navigate, locationState?.config]);

  const onChoose = useCallback(
    (chosenIndex: number) => {
      if (state.phase !== 'playing') return;
      const elapsedMs = timerRef.current?.elapsedMs() ?? 0;
      timerRef.current?.pause();
      dispatch({ type: 'ANSWER', chosenIndex, elapsedMs });
    },
    [state.phase],
  );

  const onFeedback = useCallback(
    async (reaction: 'too-easy' | 'too-hard' | 'just-right') => {
      if (state.phase !== 'revealed') return;
      setShowRecategorise(false);
      const sessionId = await ensureSessionId();
      const last = state.answers[state.answers.length - 1]!;
      const q = state.questions[state.index]!;
      await recordQuestionPlay({
        session_id: sessionId,
        question_id: q.id,
        chosen_option: q.options[last.chosenIndex]!,
        is_correct: last.isCorrect,
        time_to_answer_ms: last.elapsedMs,
        feedback_reaction: reaction,
        played_at: new Date().toISOString(),
      });
      dispatch({ type: 'FEEDBACK', reaction });
      dispatch({ type: 'NEXT' });
    },
    [state],
  );

  const onRecategorise = useCallback(
    async (slug: string) => {
      if (state.phase !== 'revealed' && state.phase !== 'reviewing') return;
      const sessionId = await ensureSessionId();
      const q = state.questions[state.index]!;
      await recordRecategorisation(sessionId, q.id, slug);
      setShowRecategorise(false);
    },
    [state],
  );

  // Don't render anything while redirecting or loading
  if (state.phase === 'idle' || state.phase === 'loading' || state.phase === 'finished') {
    return null;
  }

  const question = state.questions[state.index]!;
  const questionNumber = state.index + 1;
  const totalQuestions = state.questions.length;
  const isReviewing = state.phase === 'reviewing';
  const reviewAnswer = isReviewing ? state.answers[state.index] : null;
  const lastAnswer = state.phase === 'revealed' ? state.answers[state.answers.length - 1] : null;
  const shownAnswer = reviewAnswer ?? lastAnswer;
  const isCorrect = shownAnswer?.isCorrect ?? false;
  const canGoBack = state.index > 0;

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="inline-flex items-center gap-2">
          {canGoBack && (
            <button
              onClick={() => dispatch({ type: 'VIEW_PREVIOUS' })}
              className="inline-flex items-center gap-0.5 rounded-md px-2 py-1.5 text-base text-neutral-600 hover:bg-neutral-100 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
          )}
          <span className="text-base text-neutral-600">
            Question {questionNumber} of {totalQuestions}
          </span>
        </div>
        <button
          onClick={() => navigate('/', { replace: true })}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-base text-neutral-600 hover:bg-neutral-100 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Exit
        </button>
      </div>

      <Card>
        <CardHeader>
          {(() => {
            const cat = findCategory(question.category_slug);
            const CatIcon = cat.icon;
            const catLabel = cat.label;
            const diff = locationState?.config.difficulty ?? 'Easy';
            const DiffIcon = DIFFICULTY_ICONS[diff];
            return (
              <div className="flex items-center justify-between text-base text-neutral-500 mb-2">
                <span className="inline-flex items-center gap-1">
                  <CatIcon className="h-4 w-4" />
                  {catLabel}
                  {(state.phase === 'revealed' || isReviewing) && (
                    <button
                      onClick={() => setShowRecategorise(true)}
                      className="ml-1 text-blue-600 underline underline-offset-2 text-base hover:text-blue-800"
                    >
                      Wrong?
                    </button>
                  )}
                </span>
                <span className="inline-flex items-center gap-1">
                  <DiffIcon className="h-4 w-4" />
                  {diff}
                </span>
              </div>
            );
          })()}
          <CardTitle className="text-xl leading-relaxed">
            {question.question_text}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {state.phase === 'playing' && (
            <div className="space-y-2">
              {question.options.map((option, i) => (
                <button
                  key={i}
                  onClick={() => onChoose(i)}
                  className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent"
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {state.phase === 'revealed' && (
            <div className="space-y-4">
              {/* Result banner */}
              <div
                className={`flex items-center gap-2 rounded-lg p-3 ${
                  isCorrect
                    ? 'bg-green-50 text-green-800'
                    : 'bg-red-50 text-red-800'
                }`}
              >
                {isCorrect ? (
                  <CheckCircle className="h-5 w-5" />
                ) : (
                  <XCircle className="h-5 w-5" />
                )}
                <span className="font-medium">
                  {isCorrect ? 'Correct!' : 'Incorrect'}
                </span>
              </div>

              {/* Show correct answer if wrong */}
              {!isCorrect && (
                <p className="text-base text-neutral-600">
                  The correct answer was: <strong>{question.options[question.correctIndex]}</strong>
                </p>
              )}

              {/* Explanation */}
              {question.explanation && (
                <p className="text-base text-neutral-600">
                  {question.explanation}
                </p>
              )}

              {/* Difficulty feedback + next */}
              <p className="text-base font-medium">How was the difficulty?</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => onFeedback('too-easy')}
                  className="inline-flex items-center justify-center rounded-md border-2 border-amber-600 text-amber-700 bg-amber-50 px-4 py-3 text-base font-medium hover:bg-amber-100 transition-colors w-full min-[500px]:w-auto"
                >
                  <Wind className="mr-1.5 h-4 w-4" />
                  Too easy →
                </button>
                <button
                  onClick={() => onFeedback('just-right')}
                  className="inline-flex items-center justify-center rounded-md border-2 border-green-600 text-green-700 bg-green-50 px-4 py-3 text-base font-medium hover:bg-green-100 transition-colors w-full min-[500px]:w-auto"
                >
                  <ThumbsUp className="mr-1.5 h-4 w-4" />
                  Just right →
                </button>
                <button
                  onClick={() => onFeedback('too-hard')}
                  className="inline-flex items-center justify-center rounded-md border-2 border-amber-600 text-amber-700 bg-amber-50 px-4 py-3 text-base font-medium hover:bg-amber-100 transition-colors w-full min-[500px]:w-auto"
                >
                  <Skull className="mr-1.5 h-4 w-4" />
                  Too hard →
                </button>
              </div>
            </div>
          )}

          {isReviewing && reviewAnswer && (
            <div className="space-y-4">
              {/* Result banner */}
              <div
                className={`flex items-center gap-2 rounded-lg p-3 ${
                  isCorrect
                    ? 'bg-green-50 text-green-800'
                    : 'bg-red-50 text-red-800'
                }`}
              >
                {isCorrect ? (
                  <CheckCircle className="h-5 w-5" />
                ) : (
                  <XCircle className="h-5 w-5" />
                )}
                <span className="font-medium">
                  {isCorrect ? 'Correct!' : 'Incorrect'}
                </span>
              </div>

              {!isCorrect && (
                <p className="text-base text-neutral-600">
                  The correct answer was: <strong>{question.options[question.correctIndex]}</strong>
                </p>
              )}

              {question.explanation && (
                <p className="text-base text-neutral-600">
                  {question.explanation}
                </p>
              )}

              <button
                onClick={() => dispatch({ type: 'VIEW_CURRENT' })}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 text-white px-4 py-3 text-base font-semibold shadow transition-colors hover:bg-neutral-800"
              >
                <ArrowRight className="h-4 w-4" />
                Continue to question {state.currentIndex + 1}
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recategorise modal */}
      {showRecategorise && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full max-h-[80vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-lg font-semibold">Which category does this belong to?</p>
              <button
                onClick={() => setShowRecategorise(false)}
                className="rounded-md p-1 hover:bg-neutral-100 transition-colors"
              >
                <X className="h-5 w-5 text-neutral-500" />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.filter((c) => c.slug !== 'general').map((c) => {
                const CatIcon = c.icon;
                return (
                  <button
                    key={c.slug}
                    onClick={() => onRecategorise(c.slug)}
                    className="inline-flex items-center gap-1.5 rounded-lg border-2 border-neutral-300 bg-white text-neutral-700 px-4 py-2.5 text-base font-medium hover:border-neutral-900 hover:bg-neutral-900 hover:text-white transition-colors"
                  >
                    <CatIcon className="h-4 w-4" />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
