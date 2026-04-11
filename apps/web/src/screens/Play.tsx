import { useReducer, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { quizReducer, initialQuizState, selectScore } from '@/state/quiz';
import type { LoadedQuestion } from '@/state/quiz';
import { createActiveTimer } from '@/lib/activeTimer';
import { recordQuestionPlay } from '@/lib/plays';
import { ensureSessionId } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ThumbsUp, ThumbsDown, HelpCircle, CheckCircle, XCircle } from 'lucide-react';

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
      <div className="mb-4 text-sm text-muted-foreground">
        Question {questionNumber} of {totalQuestions}
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
                <p className="text-sm text-muted-foreground">
                  The correct answer was: <strong>{question.options[question.correctIndex]}</strong>
                </p>
              )}

              {/* Explanation */}
              {question.explanation && (
                <p className="text-sm text-muted-foreground">
                  {question.explanation}
                </p>
              )}

              {/* Feedback + next */}
              <p className="text-sm font-medium">Feedback + next question</p>
              <div className="flex flex-wrap gap-2 sm:gap-2 gap-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onFeedback('good')}
                >
                  <ThumbsUp className="mr-1 h-4 w-4" />
                  good: next question →
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onFeedback('bad')}
                >
                  <ThumbsDown className="mr-1 h-4 w-4" />
                  bad: next question →
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onFeedback('confusing')}
                >
                  <HelpCircle className="mr-1 h-4 w-4" />
                  confusing: next question →
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
