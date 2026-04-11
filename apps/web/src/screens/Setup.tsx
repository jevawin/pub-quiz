import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { CATEGORY_OPTIONS, QUESTION_COUNTS, isValidCategory, isValidCount } from '@/config/categories';
import { UI_DIFFICULTIES, type UiDifficulty } from '@/lib/difficulty';
import { fetchRandomQuestions } from '@/lib/questions';
import type { QuestionCount } from '@/config/categories';

const DEFAULT_CATEGORY = 'general';
const DEFAULT_DIFFICULTY: UiDifficulty = 'Easy';
const DEFAULT_COUNT: QuestionCount = 10;

export function Setup() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [difficulty, setDifficulty] = useState<UiDifficulty>(DEFAULT_DIFFICULTY);
  const [count, setCount] = useState<QuestionCount>(DEFAULT_COUNT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const catParam = searchParams.get('cat');
    if (catParam && isValidCategory(catParam)) {
      setCategory(catParam);
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
      const questions = await fetchRandomQuestions(difficulty, category, count);
      navigate('/play', {
        state: {
          questions,
          config: { category, difficulty, count },
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
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Pub Quiz</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Category</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup value={category} onValueChange={setCategory}>
            {CATEGORY_OPTIONS.map((c) => (
              <div key={c.slug} className="flex items-center space-x-2">
                <RadioGroupItem value={c.slug} id={`cat-${c.slug}`} />
                <Label htmlFor={`cat-${c.slug}`}>{c.label}</Label>
              </div>
            ))}
          </RadioGroup>
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

      <p className="mb-6 text-sm text-neutral-500">
        We log which answers you pick to improve questions. No personal data.
      </p>

      {error && (
        <p className="mb-4 text-sm text-red-600">{error}</p>
      )}

      <Button onClick={onPlay} disabled={loading} size="lg" className="w-full">
        {loading ? 'Loading...' : 'Play'}
      </Button>
    </div>
  );
}
