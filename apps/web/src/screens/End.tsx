import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Smile, Meh, Frown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ensureSessionId } from '@/lib/auth';
import { recordQuizSession, type QuizSessionRow } from '@/lib/plays';
import { uiToDbDifficulty, type UiDifficulty } from '@/lib/difficulty';
import { buildShareUrl } from '@/lib/shareUrl';

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

  const onShare = async () => {
    const url = buildShareUrl(config);
    await navigator.clipboard.writeText(url);
  };

  const onPlayAgain = () => {
    navigate('/');
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <h1 className="text-3xl font-bold text-center mb-2">
        You scored {score} / {config.count}
      </h1>

      <p className="text-center text-muted-foreground mb-8">
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
            <p className="text-sm font-medium mb-3">How was that?</p>
            <div className="flex gap-3 justify-center">
              {RATINGS.map(({ value, label, icon: Icon }) => (
                <Button
                  key={value}
                  variant={rating === value ? 'default' : 'outline'}
                  className="flex flex-col items-center gap-1 h-auto py-3 px-5"
                  onClick={() => setRating(value)}
                >
                  <Icon className="h-6 w-6" />
                  <span>{label}</span>
                </Button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="feedback"
              className="text-sm font-medium block mb-2"
            >
              Anything to tell us?
            </label>
            <textarea
              id="feedback"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
            />
          </div>

          <Button
            onClick={onSubmit}
            disabled={submitting}
            className="w-full"
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </Button>
        </div>
      ) : (
        <p className="text-center text-muted-foreground mb-8">
          Thanks for the feedback!
        </p>
      )}

      <div className="flex gap-3 mt-8 justify-center">
        <Button variant="outline" onClick={onShare}>
          Share
        </Button>
        <Button onClick={onPlayAgain}>Play Again</Button>
      </div>
    </div>
  );
}
