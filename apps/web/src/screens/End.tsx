import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Smile, Meh, Frown, Play, Check, X } from 'lucide-react';
import { ensureSessionId } from '@/lib/auth';
import { recordQuizSession, type QuizSessionRow } from '@/lib/plays';
import type { UiDifficulty } from '@/lib/difficulty';
import type { LoadedQuestion, AnswerRecord } from '@/state/quiz';

type EndState = {
  score: number;
  config: {
    category: string;
    difficulty: UiDifficulty;
    count: number;
  };
  startedAt: number;
  questions: LoadedQuestion[];
  answers: AnswerRecord[];
};

type Rating = 'good' | 'okay' | 'bad';

const RATINGS: { value: Rating; label: string; icon: typeof Smile }[] = [
  { value: 'good', label: 'Good', icon: Smile },
  { value: 'okay', label: 'Okay', icon: Meh },
  { value: 'bad', label: 'Bad', icon: Frown },
];

export function End() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as EndState | null;

  const [rating, setRating] = useState<Rating | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!state) {
    return <Navigate to="/" replace />;
  }

  const { score, config, startedAt, questions, answers } = state;
  const recap =
    questions && answers && questions.length === answers.length
      ? questions.map((q, i) => ({ q, a: answers[i]! }))
      : [];

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      const sessionId = await ensureSessionId();
      const row: QuizSessionRow = {
        session_id: sessionId,
        category_slug: config.category,
        difficulty: config.difficulty === 'Mixed' ? 'mixed' : config.difficulty === 'Easy' ? 'easy' : config.difficulty === 'Medium' ? 'normal' : 'hard',
        num_questions: config.count as 5 | 10 | 15 | 20,
        score,
        overall_rating: rating,
        feedback_text: feedbackText.trim() ? feedbackText.trim() : null,
        started_at: new Date(startedAt).toISOString(),
      };
      await recordQuizSession(row);
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  const onPlayAgain = () => {
    navigate('/');
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold text-center mb-2">
        You scored {score} / {config.count}
      </h1>

      <p className="text-center text-neutral-600 mb-8">
        {score === config.count
          ? 'Perfect score!'
          : score >= config.count * 0.7
            ? 'Well done!'
            : score >= config.count * 0.4
              ? 'Not bad!'
              : 'Better luck next time!'}
      </p>

      {recap.length > 0 && (
        <ol className="space-y-4 mb-8">
          {recap.map(({ q, a }, i) => {
            const correctText = q.options[q.correctIndex]!;
            const chosenText = q.options[a.chosenIndex] ?? '—';
            return (
              <li
                key={q.id}
                className={`rounded-lg border-l-4 bg-white p-4 ${
                  a.isCorrect ? 'border-green-600' : 'border-red-600'
                }`}
              >
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-base font-semibold text-neutral-500">{i + 1}.</span>
                  {a.isCorrect ? (
                    <Check className="h-5 w-5 text-green-600 shrink-0 mt-0.5" aria-label="Correct" />
                  ) : (
                    <X className="h-5 w-5 text-red-600 shrink-0 mt-0.5" aria-label="Incorrect" />
                  )}
                  <p className="text-base font-medium text-neutral-900 leading-snug">
                    {q.question_text}
                  </p>
                </div>
                <dl className="text-sm text-neutral-700 space-y-1 pl-7">
                  <div className="flex gap-2">
                    <dt className="text-neutral-500 shrink-0">Your answer:</dt>
                    <dd className={a.isCorrect ? 'text-green-700 font-medium' : 'text-red-700'}>
                      {chosenText}
                    </dd>
                  </div>
                  {!a.isCorrect && (
                    <div className="flex gap-2">
                      <dt className="text-neutral-500 shrink-0">Correct answer:</dt>
                      <dd className="text-green-700 font-medium">{correctText}</dd>
                    </div>
                  )}
                </dl>
              </li>
            );
          })}
        </ol>
      )}

      {!submitted ? (
        <div className="space-y-6">
          <div>
            <p className="text-base font-medium mb-3">How was that?</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {RATINGS.map(({ value, label, icon: Icon }) => {
                const active = rating === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRating(value)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border-2 px-5 py-2.5 text-base font-medium transition-colors ${
                      active
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="feedback"
              className="text-base font-medium block mb-2"
            >
              Anything to tell us?
            </label>
            <textarea
              id="feedback"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
            />
          </div>

          <button
            onClick={onSubmit}
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 text-white px-6 py-4 text-lg font-semibold shadow transition-colors hover:bg-neutral-800 disabled:opacity-50 disabled:pointer-events-none"
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      ) : (
        <p className="text-center text-neutral-600 mb-8">
          Thanks for the feedback!
        </p>
      )}

      <button
        onClick={onPlayAgain}
        className="w-full mt-8 inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 text-white px-6 py-4 text-lg font-semibold shadow transition-colors hover:bg-neutral-800"
      >
        <Play className="h-5 w-5 fill-current" />
        Play Again
      </button>
    </div>
  );
}
