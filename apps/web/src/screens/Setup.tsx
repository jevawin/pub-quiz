import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Heart, Play, GraduationCap, Square, CheckSquare, Shuffle, Smile, Flame, Skull, Dice1, Dice3, Dice5, Dice6 } from 'lucide-react';
import { CATEGORY_OPTIONS, QUESTION_COUNTS, isValidCategory, isValidCount } from '@/config/categories';
import { UI_DIFFICULTIES, type UiDifficulty } from '@/lib/difficulty';
import { fetchRandomQuestions, countAvailableQuestions, fetchCountsByRootCategory, type CategoryCounts } from '@/lib/questions';
import { totalPlayed, clearAll as clearSeenMemory } from '@/lib/seen-store';
import type { QuestionCount } from '@/config/categories';

// All non-general category slugs
const ALL_CATEGORY_SLUGS = CATEGORY_OPTIONS.filter((c) => c.slug !== 'general').map((c) => c.slug);

const DEFAULT_DIFFICULTY: UiDifficulty = 'Mixed';
const DEFAULT_COUNT: QuestionCount = 10;

/** Read the question count for one root slug at the current UI difficulty. */
function countForSlug(counts: CategoryCounts | null, slug: string, diff: UiDifficulty): number | null {
  if (!counts) return null;
  const bucket = counts[slug];
  if (!bucket) return 0;
  if (diff === 'Mixed') return bucket.total;
  const key = diff === 'Easy' ? 'easy' : diff === 'Medium' ? 'normal' : 'hard';
  return bucket[key];
}

export function Setup() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set(ALL_CATEGORY_SLUGS));
  const [difficulty, setDifficulty] = useState<UiDifficulty>(DEFAULT_DIFFICULTY);
  const [count, setCount] = useState<QuestionCount>(DEFAULT_COUNT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [played, setPlayed] = useState(() => totalPlayed());
  const [availableUnseen, setAvailableUnseen] = useState<number | null>(null);
  const [availableTotal, setAvailableTotal] = useState<number | null>(null);
  const [catCounts, setCatCounts] = useState<CategoryCounts | null>(null);

  const allSelected = selectedCategories.size === ALL_CATEGORY_SLUGS.length;

  const toggleCategory = (slug: string) => {
    setSelectedCategories((prev) => {
      if (prev.size === ALL_CATEGORY_SLUGS.length) {
        return new Set([slug]);
      }
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
    setSelectedCategories(new Set(ALL_CATEGORY_SLUGS));
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
    setPlayed(totalPlayed());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch per-category counts once on mount. One RPC call; totals derived locally.
  useEffect(() => {
    let cancelled = false;
    fetchCountsByRootCategory()
      .then((c) => { if (!cancelled) setCatCounts(c); })
      .catch(() => { if (!cancelled) setCatCounts(null); });
    return () => { cancelled = true; };
  }, []);

  // Recount available questions whenever the user's filter choices change.
  useEffect(() => {
    let cancelled = false;
    const slugs = allSelected ? ['general'] : Array.from(selectedCategories);
    if (slugs.length === 0) {
      setAvailableUnseen(0);
      setAvailableTotal(0);
      return;
    }
    Promise.all([
      countAvailableQuestions(difficulty, slugs, true),
      countAvailableQuestions(difficulty, slugs, false),
    ])
      .then(([unseen, total]) => {
        if (cancelled) return;
        setAvailableUnseen(unseen);
        setAvailableTotal(total);
      })
      .catch(() => {
        if (cancelled) return;
        setAvailableUnseen(null);
        setAvailableTotal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [difficulty, selectedCategories, allSelected, played]);

  const onPlay = async () => {
    setLoading(true);
    setError(null);
    try {
      const slugs = allSelected ? ['general'] : Array.from(selectedCategories);
      const questions = await fetchRandomQuestions(difficulty, slugs, count);
      // Use the actual number of questions returned as the authoritative count
      // so End screens and progress show the real denominator, not the request.
      const actualCount = questions.length;
      navigate('/play', {
        state: {
          questions,
          config: { category: slugs.join(','), difficulty, count: actualCount },
          startedAt: Date.now(),
        },
      });
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load questions');
    } finally {
      setLoading(false);
    }
  };

  // Sum of published-question counts across currently selected categories at the
  // active difficulty. Null until catCounts loads; stays null if the fetch fails.
  const selectionPoolCount = catCounts
    ? (allSelected ? ALL_CATEGORY_SLUGS : Array.from(selectedCategories))
        .reduce((sum, slug) => sum + (countForSlug(catCounts, slug, difficulty) ?? 0), 0)
    : null;

  // Derive pool-size warning message for the current filter choices.
  let poolWarning: string | null = null;
  if (availableTotal !== null && availableUnseen !== null) {
    if (availableTotal === 0) {
      poolWarning = 'No questions match these filters yet. Try another category or difficulty.';
    } else if (availableTotal < count) {
      poolWarning = `Only ${availableTotal} question${availableTotal === 1 ? '' : 's'} match these filters — the quiz will be shorter.`;
    } else if (availableUnseen < count) {
      poolWarning = `Only ${availableUnseen} unseen question${availableUnseen === 1 ? '' : 's'} left — some may repeat.`;
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="mb-2 text-3xl font-bold tracking-tight flex items-center gap-2">
        <GraduationCap className="h-8 w-8" />
        Trivia Quiz
      </h1>
      <p className="mb-6 text-base text-neutral-600">
        I'm making a quiz website and app! Please play as much as you can and give feedback. Jamie <Heart className="inline h-4 w-4 text-red-500 fill-red-500" />
      </p>

      {error && (
        <p className="mb-4 text-base text-red-800">{error}</p>
      )}

      {poolWarning && (
        <p className="mb-4 text-base text-amber-700">{poolWarning}</p>
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
        disabled={loading || selectedCategories.size === 0 && !allSelected || (availableTotal !== null && availableTotal === 0)}
        className="w-full mb-8 inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 text-white px-6 py-4 text-lg font-semibold shadow transition-colors hover:bg-green-700 disabled:opacity-50 disabled:pointer-events-none"
      >
        <Play className="h-5 w-5 fill-current" />
        {loading ? 'Loading...' : 'Play'}
      </button>

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Categories</CardTitle>
          {selectionPoolCount !== null && (
            <span className="text-sm font-normal text-neutral-500">{selectionPoolCount} in pool</span>
          )}
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
              const active = !allSelected && selectedCategories.has(c.slug);
              const CatIcon = c.icon;
              const pillCount = countForSlug(catCounts, c.slug, difficulty);
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
                  <span className="ml-1 inline-block min-w-[2.5ch] text-right tabular-nums text-xs">
                    {pillCount === null ? (
                      <span
                        className={`inline-block h-3 w-5 rounded animate-pulse ${
                          active ? 'bg-neutral-700' : 'bg-neutral-200'
                        }`}
                      />
                    ) : (
                      <span className={active ? 'text-neutral-300' : 'text-neutral-500'}>
                        {pillCount}
                      </span>
                    )}
                  </span>
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
              const Icon = d === 'Mixed' ? Shuffle : d === 'Easy' ? Smile : d === 'Medium' ? Flame : Skull;
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

      {poolWarning && (
        <p className="mb-4 text-base text-amber-700">{poolWarning}</p>
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
        disabled={loading || selectedCategories.size === 0 && !allSelected || (availableTotal !== null && availableTotal === 0)}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 text-white px-6 py-4 text-lg font-semibold shadow transition-colors hover:bg-green-700 disabled:opacity-50 disabled:pointer-events-none"
      >
        <Play className="h-5 w-5 fill-current" />
        {loading ? 'Loading...' : 'Play'}
      </button>

      {played > 0 && (
        <p className="mt-4 text-center text-sm text-neutral-400">
          {played} {played === 1 ? 'question' : 'questions'} played and hidden.{' '}
          <button
            onClick={() => { clearSeenMemory(); setPlayed(0); }}
            className="underline underline-offset-2 hover:text-neutral-600"
          >
            Clear memory.
          </button>
        </p>
      )}
    </div>
  );
}
