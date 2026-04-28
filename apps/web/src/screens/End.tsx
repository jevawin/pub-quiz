import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Smile, Meh, Frown, Play, Send, Lightbulb, Eye, EyeOff } from 'lucide-react';
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

const RATINGS: {
  value: Rating;
  label: string;
  icon: typeof Smile;
  activeClass: string;
}[] = [
  {
    value: 'good',
    label: 'Good',
    icon: Smile,
    activeClass: 'border-green-600 bg-green-50 text-green-800',
  },
  {
    value: 'okay',
    label: 'Okay',
    icon: Meh,
    activeClass: 'border-orange-500 bg-orange-50 text-orange-800',
  },
  {
    value: 'bad',
    label: 'Bad',
    icon: Frown,
    activeClass: 'border-red-600 bg-red-50 text-red-800',
  },
];

export function End() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as EndState | null;

  const [rating, setRating] = useState<Rating | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showFacts, setShowFacts] = useState(false);

  if (!state) {
    return <Navigate to="/" replace />;
  }

  const { score, config, startedAt, questions, answers } = state;
  const recap =
    questions && answers && questions.length === answers.length
      ? questions.map((q, i) => ({ q, a: answers[i]! }))
      : [];
  const anyFunFacts = recap.some(({ q }) => Boolean(q.fun_fact));

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

      {!submitted ? (
        <div className="space-y-6">
          <div>
            <p className="text-base font-medium mb-3">How was that?</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {RATINGS.map(({ value, label, icon: Icon, activeClass }) => {
                const active = rating === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRating(value)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border-2 px-5 py-2.5 text-base font-medium transition-colors ${
                      active
                        ? activeClass
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
              Feedback?
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
            <Send className="h-5 w-5" />
            {submitting ? 'Submitting...' : 'Submit feedback'}
          </button>
        </div>
      ) : (
        <p className="text-center text-neutral-600 mb-8">
          Thanks for the feedback!
        </p>
      )}

      <button
        onClick={onPlayAgain}
        className="w-full mt-8 inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 text-white px-6 py-4 text-lg font-semibold shadow transition-colors hover:bg-green-700"
      >
        <Play className="h-5 w-5 fill-current" />
        Play Again
      </button>

      {recap.length > 0 && (
        <section className="mt-12">
          <h2 className="text-xl font-semibold mb-4">Round summary</h2>
          {anyFunFacts && (
            <button
              type="button"
              onClick={() => setShowFacts((v) => !v)}
              className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-blue-100 bg-blue-50 px-3 py-1.5 text-base text-blue-800 hover:bg-blue-100 transition-colors"
              aria-pressed={showFacts}
            >
              {showFacts ? <EyeOff className="h-4 w-4 text-blue-600" /> : <Eye className="h-4 w-4 text-blue-600" />}
              {showFacts ? 'Hide facts' : 'Show facts'}
            </button>
          )}
          <ol className="space-y-2">
            {recap.map(({ q, a }, i) => {
              const correctText = q.options[q.correctIndex]!;
              const chosenText = q.options[a.chosenIndex] ?? '—';
              return (
                <li
                  key={q.id}
                  className={`border-l-[6px] bg-white pl-3 py-2 pr-2 ${
                    a.isCorrect ? 'border-green-600' : 'border-red-600'
                  }`}
                >
                  <p className="text-base font-medium text-neutral-900 leading-snug">
                    <span className="font-semibold mr-1">{i + 1}.</span>
                    {q.question_text}
                  </p>
                  <p className="mt-1 text-base flex flex-wrap gap-x-2">
                    {a.isCorrect ? (
                      <span className="text-green-800 font-medium">{chosenText}</span>
                    ) : (
                      <>
                        <span className="line-through text-red-800">{chosenText}</span>
                        <span className="text-green-800 font-medium">{correctText}</span>
                      </>
                    )}
                  </p>
                  {showFacts && q.fun_fact && (
                    <div className="mt-2 flex gap-3 rounded-lg bg-blue-50 border border-blue-100 p-3">
                      <Lightbulb className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                      <p className="text-base text-blue-800">{q.fun_fact}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
