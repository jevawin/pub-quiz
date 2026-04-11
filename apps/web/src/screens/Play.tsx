import { useReducer, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { quizReducer, initialQuizState, selectScore } from '@/state/quiz';
import type { LoadedQuestion } from '@/state/quiz';
import { createActiveTimer } from '@/lib/activeTimer';
import { recordQuestionPlay } from '@/lib/plays';
import { ensureSessionId } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ThumbsUp, ThumbsDown, HelpCircle, CheckCircle, XCircle, LogOut } from 'lucide-react';

type LocationState = {
  questions: LoadedQuestion[];
  config: { categorySlug: string; difficulty: string };
  startedAt: number;
};

export function Play() {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(quizReducer, initialQuizState);
  const timerRef = useRef<ReturnType<typeof createActiveTimer> | null>(null);
  const initialised = useRef(false);

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
    async (reaction: 'good' | 'bad' | 'confusing' | null) => {
      if (state.phase !== 'revealed') return;
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

  // Don't render anything while redirecting or loading
  if (state.phase === 'idle' || state.phase === 'loading' || state.phase === 'finished') {
    return null;
  }

  const question = state.questions[state.index]!;
  const questionNumber = state.index + 1;
  const totalQuestions = state.questions.length;
  const lastAnswer = state.phase === 'revealed' ? state.answers[state.answers.length - 1] : null;
  const isCorrect = lastAnswer?.isCorrect ?? false;

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-base text-neutral-600">
          Question {questionNumber} of {totalQuestions}
        </span>
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

              {/* Feedback + next */}
              <p className="text-base font-medium">Feedback + next question</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => onFeedback('good')}
                  className="inline-flex items-center justify-center rounded-md border-2 border-green-600 text-green-700 bg-green-50 px-4 py-3 text-base font-medium hover:bg-green-100 transition-colors w-full min-[500px]:w-auto"
                >
                  <ThumbsUp className="mr-1.5 h-4 w-4" />
                  Good: next question →
                </button>
                <button
                  onClick={() => onFeedback('bad')}
                  className="inline-flex items-center justify-center rounded-md border-2 border-red-600 text-red-700 bg-red-50 px-4 py-3 text-base font-medium hover:bg-red-100 transition-colors w-full min-[500px]:w-auto"
                >
                  <ThumbsDown className="mr-1.5 h-4 w-4" />
                  Bad: next question →
                </button>
                <button
                  onClick={() => onFeedback('confusing')}
                  className="inline-flex items-center justify-center rounded-md border-2 border-amber-600 text-amber-700 bg-amber-50 px-4 py-3 text-base font-medium hover:bg-amber-100 transition-colors w-full min-[500px]:w-auto"
                >
                  <HelpCircle className="mr-1.5 h-4 w-4" />
                  Confusing: next question →
                </button>
              </div>
              <p className="text-base text-neutral-500">
                Feedback based on how interesting the question was; how accurately it fit the category choice; and, how well it suits your chosen difficulty.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
