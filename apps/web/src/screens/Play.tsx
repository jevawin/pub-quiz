import { useReducer, useEffect, useRef, useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { quizReducer, initialQuizState, selectScore } from '@/state/quiz';
import type { LoadedQuestion } from '@/state/quiz';
import { createActiveTimer } from '@/lib/activeTimer';
import { recordQuestionPlay, recordRecategorisation, recordQuestionFeedback } from '@/lib/plays';
import { ensureSessionId } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { findCategory, CATEGORY_OPTIONS } from '@/config/categories';
import { CheckCircle, XCircle, LogOut, X, ChevronLeft, ArrowRight } from 'lucide-react';
import type { UiDifficulty } from '@/lib/difficulty';

type LocationState = {
  questions: LoadedQuestion[];
  config: { category: string; difficulty: UiDifficulty; count: number };
  startedAt: number;
};

export function Play() {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(quizReducer, initialQuizState);
  const timerRef = useRef<ReturnType<typeof createActiveTimer> | null>(null);
  const initialised = useRef(false);
  const [showRecategorise, setShowRecategorise] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);

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

  const onNext = useCallback(
    async () => {
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
        feedback_reaction: null,
        played_at: new Date().toISOString(),
      });
      dispatch({ type: 'NEXT' });
    },
    [state],
  );

  const onRecategorise = useCallback(
    async (slug: string) => {
      if (state.phase === 'idle' || state.phase === 'loading' || state.phase === 'finished') return;
      const sessionId = await ensureSessionId();
      const q = state.questions[state.index]!;
      await recordRecategorisation(sessionId, q.id, slug);
      setShowRecategorise(false);
    },
    [state],
  );

  const onSubmitFeedback = useCallback(async () => {
    if (!feedbackText.trim()) return;
    if (state.phase === 'idle' || state.phase === 'loading' || state.phase === 'finished') return;
    const sessionId = await ensureSessionId();
    const q = state.questions[state.index]!;
    await recordQuestionFeedback(sessionId, q.id, feedbackText.trim());
    setFeedbackText('');
    setFeedbackSent(true);
  }, [feedbackText, state]);

  // Reset feedback state when question changes
  useEffect(() => {
    setShowFeedback(false);
    setShowRecategorise(false);
    setFeedbackText('');
    setFeedbackSent(false);
  }, [state.phase === 'idle' || state.phase === 'loading' ? -1 : (state as { index: number }).index]);

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
            return (
              <div className="flex items-center text-base text-neutral-500 mb-2">
                <span className="inline-flex items-center gap-1">
                  <CatIcon className="h-4 w-4" />
                  {catLabel}
                  <button
                    onClick={() => setShowRecategorise(true)}
                    className="ml-1 text-blue-600 underline underline-offset-2 text-base hover:text-blue-800"
                  >
                    Wrong?
                  </button>
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

              {/* Next question */}
              <button
                onClick={onNext}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 text-white px-4 py-3 text-base font-semibold shadow transition-colors hover:bg-neutral-800"
              >
                <ArrowRight className="h-4 w-4" />
                Next
              </button>

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

      {/* Feedback link — always visible when question shown */}
      <button
        onClick={() => setShowFeedback(true)}
        className="w-full text-center text-blue-600 underline underline-offset-2 text-base hover:text-blue-800 mt-3"
      >
        Something wrong with this question?
      </button>

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

      {/* Feedback modal */}
      {showFeedback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-lg font-semibold">Feedback on this question</p>
              <button
                onClick={() => { setShowFeedback(false); setFeedbackSent(false); }}
                className="rounded-md p-1 hover:bg-neutral-100 transition-colors"
              >
                <X className="h-5 w-5 text-neutral-500" />
              </button>
            </div>
            {feedbackSent ? (
              <p className="text-base text-neutral-600">Thanks for the feedback!</p>
            ) : (
              <>
                <textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder="e.g. The options don't make sense, the answer is wrong..."
                  className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 mb-4"
                />
                <button
                  onClick={onSubmitFeedback}
                  disabled={!feedbackText.trim()}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 text-white px-4 py-3 text-base font-semibold shadow transition-colors hover:bg-neutral-800 disabled:opacity-50 disabled:pointer-events-none"
                >
                  Submit feedback
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
