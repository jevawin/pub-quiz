import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Heart, Play, GraduationCap, Square, CheckSquare, Smile, Flame, Skull, Dice1, Dice3, Dice5, Dice6 } from 'lucide-react';
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
        Trivia Quiz
      </h1>
      <p className="mb-6 text-base text-neutral-600">
        My prototype quiz. I'm collecting feedback to improve it. Please play as much as you can!
        <span className="block mt-1">Jamie <Heart className="inline h-4 w-4 text-red-500 fill-red-500" /></span>
      </p>

      {error && (
        <p className="mb-4 text-base text-red-700">{error}</p>
      )}

      <p className="mb-2 text-base text-neutral-500">
        {allSelected ? 'All categories' : `${selectedCategories.size} ${selectedCategories.size === 1 ? 'category' : 'categories'}`}
        {' · '}
        {difficulty}
        {' · '}
        {count} questions
      </p>

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
              className={`inline-flex items-center gap-1.5 rounded-lg border-2 px-4 py-2.5 text-base font-medium transition-colors ${
                allSelected
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400'
              }`}
            >
              {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              All
            </button>
            {CATEGORY_OPTIONS.filter((c) => c.slug !== 'general').map((c) => {
              const active = selectedCategories.has(c.slug);
              const CatIcon = c.icon;
              return (
                <button
                  type="button"
                  key={c.slug}
                  onClick={() => toggleCategory(c.slug)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border-2 px-4 py-2.5 text-base font-medium transition-colors ${
                    active
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400'
                  }`}
                >
                  {active ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  <CatIcon className="h-4 w-4" />
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
          <div className="flex flex-wrap gap-2">
            {UI_DIFFICULTIES.map((d) => {
              const active = difficulty === d;
              const Icon = d === 'Easy' ? Smile : d === 'Medium' ? Flame : Skull;
              return (
                <button
                  type="button"
                  key={d}
                  onClick={() => setDifficulty(d)}
                  role="radio"
                  aria-checked={active}
                  className={`inline-flex items-center gap-1.5 rounded-lg border-2 px-4 py-2.5 text-base font-medium transition-colors ${
                    active
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {d}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Number of questions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {QUESTION_COUNTS.map((n) => {
              const active = count === n;
              const Icon = n === 5 ? Dice1 : n === 10 ? Dice3 : n === 15 ? Dice5 : Dice6;
              return (
                <button
                  type="button"
                  key={n}
                  onClick={() => setCount(n)}
                  role="radio"
                  aria-checked={active}
                  className={`inline-flex items-center gap-1.5 rounded-lg border-2 px-4 py-2.5 text-base font-medium transition-colors ${
                    active
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {n}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <p className="mb-6 text-base text-neutral-600">
        We log which answers you pick to improve questions. No personal data.
      </p>

      <p className="mb-2 text-base text-neutral-500">
        {allSelected ? 'All categories' : `${selectedCategories.size} ${selectedCategories.size === 1 ? 'category' : 'categories'}`}
        {' · '}
        {difficulty}
        {' · '}
        {count} questions
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
