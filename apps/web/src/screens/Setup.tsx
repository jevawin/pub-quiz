import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Heart, Play, GraduationCap } from 'lucide-react';
import { CATEGORY_OPTIONS, QUESTION_COUNTS, isValidCategory, isValidCount } from '@/config/categories';
import { UI_DIFFICULTIES, type UiDifficulty } from '@/lib/difficulty';
import { fetchRandomQuestions } from '@/lib/questions';
import type { QuestionCount } from '@/config/categories';

// All non-general category slugs
const ALL_CATEGORY_SLUGS = CATEGORY_OPTIONS.filter((c) => c.slug !== 'general').map((c) => c.slug);

const DEFAULT_DIFFICULTY: UiDifficulty = 'Easy';
const DEFAULT_COUNT: QuestionCount = 10;

export function Setup() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set(ALL_CATEGORY_SLUGS));
  const [difficulty, setDifficulty] = useState<UiDifficulty>(DEFAULT_DIFFICULTY);
  const [count, setCount] = useState<QuestionCount>(DEFAULT_COUNT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = selectedCategories.size === ALL_CATEGORY_SLUGS.length;

  const toggleCategory = (slug: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedCategories(new Set());
    } else {
      setSelectedCategories(new Set(ALL_CATEGORY_SLUGS));
    }
  };

  useEffect(() => {
    const catParam = searchParams.get('cat');
    if (catParam) {
      const slugs = catParam.split(',').filter(isValidCategory);
      if (slugs.length > 0) {
        setSelectedCategories(new Set(slugs.filter((s) => s !== 'general')));
      }
    }

    const diffParam = searchParams.get('diff');
    if (diffParam && (UI_DIFFICULTIES as readonly string[]).includes(diffParam)) {
      setDifficulty(diffParam as UiDifficulty);
    }

    const nParam = searchParams.get('n');
    if (nParam) {
      const parsed = parseInt(nParam, 10);
      if (!isNaN(parsed) && isValidCount(parsed)) {
        setCount(parsed);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onPlay = async () => {
    setLoading(true);
    setError(null);
    try {
      const slugs = allSelected ? ['general'] : Array.from(selectedCategories);
      const questions = await fetchRandomQuestions(difficulty, slugs, count);
      navigate('/play', {
        state: {
          questions,
          config: { category: slugs.join(','), difficulty, count },
          startedAt: Date.now(),
        },
      });
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load questions');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="mb-2 text-3xl font-bold tracking-tight flex items-center gap-2">
        <GraduationCap className="h-8 w-8" />
        Self-learning quiz
      </h1>
      <p className="mb-6 text-base text-neutral-600">
        Learns and improves questions based on answers and feedback. Please play as much as you like to help me develop it! Jamie <Heart className="inline h-4 w-4 text-red-500 fill-red-500" />
      </p>

      {error && (
        <p className="mb-4 text-base text-red-700">{error}</p>
      )}

      <button
        onClick={onPlay}
        disabled={loading}
        className="w-full mb-8 inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 text-white px-6 py-4 text-lg font-semibold shadow transition-colors hover:bg-neutral-800 disabled:opacity-50 disabled:pointer-events-none"
      >
        <Play className="h-5 w-5 fill-current" />
        {loading ? 'Loading...' : 'Play'}
      </button>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Categories</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={toggleAll}
              className={`rounded-lg border-2 px-4 py-2.5 text-base font-medium transition-colors ${
                allSelected
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400'
              }`}
            >
              All
            </button>
            {CATEGORY_OPTIONS.filter((c) => c.slug !== 'general').map((c) => {
              const active = selectedCategories.has(c.slug);
              return (
                <button
                  type="button"
                  key={c.slug}
                  onClick={() => toggleCategory(c.slug)}
                  className={`rounded-lg border-2 px-4 py-2.5 text-base font-medium transition-colors ${
                    active
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Difficulty</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup value={difficulty} onValueChange={(v) => setDifficulty(v as UiDifficulty)}>
            {UI_DIFFICULTIES.map((d) => (
              <div key={d} className="flex items-center space-x-2">
                <RadioGroupItem value={d} id={`diff-${d}`} />
                <Label htmlFor={`diff-${d}`}>{d}</Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Number of questions</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={String(count)}
            onValueChange={(v) => setCount(parseInt(v, 10) as QuestionCount)}
          >
            {QUESTION_COUNTS.map((n) => (
              <div key={n} className="flex items-center space-x-2">
                <RadioGroupItem value={String(n)} id={`count-${n}`} />
                <Label htmlFor={`count-${n}`}>{n}</Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <p className="mb-6 text-base text-neutral-600">
        We log which answers you pick to improve questions. No personal data.
      </p>

      <button
        onClick={onPlay}
        disabled={loading}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 text-white px-6 py-4 text-lg font-semibold shadow transition-colors hover:bg-neutral-800 disabled:opacity-50 disabled:pointer-events-none"
      >
        <Play className="h-5 w-5 fill-current" />
        {loading ? 'Loading...' : 'Play'}
      </button>
    </div>
  );
}
