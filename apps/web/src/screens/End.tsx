import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Smile, Meh, Frown, Play } from 'lucide-react';
import { ensureSessionId } from '@/lib/auth';
import { recordQuizSession, type QuizSessionRow } from '@/lib/plays';
import { uiToDbDifficulty, type UiDifficulty } from '@/lib/difficulty';

type EndState = {
  score: number;
  config: {
    category: string;
    difficulty: UiDifficulty;
    count: number;
  };
  startedAt: number;
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

  const { score, config, startedAt } = state;

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      const sessionId = await ensureSessionId();
      const row: QuizSessionRow = {
        session_id: sessionId,
        category_slug: config.category,
        difficulty: uiToDbDifficulty(config.difficulty),
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
    <div className="mx-auto max-w-lg px-4 py-12">
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
