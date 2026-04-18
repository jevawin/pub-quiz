import { supabase } from './supabase';
import { shuffle } from './shuffle';
import { uiToDbDifficulties, type UiDifficulty, type DbDifficulty } from './difficulty';
import { getViewCounts, getSeenIds } from './seen-store';
import type { LoadedQuestion } from '@/state/quiz';

export type CategoryCounts = Record<string, { easy: number; normal: number; hard: number; total: number }>;

/** Fetch per-root-category question counts, keyed by root slug, per difficulty. */
export async function fetchCountsByRootCategory(): Promise<CategoryCounts> {
  const { data, error } = await supabase.rpc('counts_by_root_category');
  if (error) throw error;
  const rows = (data ?? []) as Array<{ root_slug: string; difficulty: DbDifficulty; question_count: number }>;
  const out: CategoryCounts = {};
  for (const r of rows) {
    const bucket = out[r.root_slug] ?? { easy: 0, normal: 0, hard: 0, total: 0 };
    bucket[r.difficulty] = r.question_count;
    out[r.root_slug] = bucket;
  }
  for (const slug of Object.keys(out)) {
    const b = out[slug]!;
    b.total = b.easy + b.normal + b.hard;
  }
  return out;
}

type RpcRow = {
  id: string;
  question_text: string;
  correct_answer: string;
  distractors: string[];
  explanation: string | null;
  category_id: string;
  category_slug: string;
};

function toLoadedQuestion(r: RpcRow): LoadedQuestion {
  const distractors = Array.isArray(r.distractors) ? r.distractors : [];
  const options = shuffle([r.correct_answer, ...distractors]);
  if (options.length !== 4) {
    throw new Error(
      `Question ${r.id} has ${options.length} options (expected 4). ` +
      `Correct: "${r.correct_answer}", distractors: ${JSON.stringify(r.distractors)}`
    );
  }
  const correctIndex = options.indexOf(r.correct_answer);
  return {
    id: r.id,
    question_text: r.question_text,
    options,
    correctIndex,
    explanation: r.explanation,
    category_slug: r.category_slug ?? 'general',
  };
}

/** Fetch rows for one difficulty + category slug combo, excluding seen IDs server-side. */
async function fetchForDifficulty(
  dbDifficulty: string,
  categorySlug: string,
  limit: number,
  excludeIds: string[],
): Promise<RpcRow[]> {
  const { data, error } = await supabase.rpc('random_published_questions_excluding', {
    p_difficulty: dbDifficulty,
    p_category_slug: categorySlug,
    p_limit: limit,
    p_exclude_ids: excludeIds,
  });
  if (error) throw error;
  return (data ?? []) as RpcRow[];
}

/** Count available questions across difficulties + slugs, excluding seen IDs. */
export async function countAvailableQuestions(
  uiDifficulty: UiDifficulty,
  categorySlugs: string[],
  excludeSeen: boolean,
): Promise<number> {
  const dbDifficulties = uiToDbDifficulties(uiDifficulty);
  const allSelected = categorySlugs.length === 0 || categorySlugs.includes('general');
  const slugs = allSelected ? ['general'] : categorySlugs;
  const excludeIds = excludeSeen ? getSeenIds() : [];

  const counts = await Promise.all(
    dbDifficulties.flatMap((diff) =>
      slugs.map(async (slug) => {
        const { data, error } = await supabase.rpc('count_available_questions', {
          p_difficulty: diff,
          p_category_slug: slug,
          p_exclude_ids: excludeIds,
        });
        if (error) throw error;
        return (data as number) ?? 0;
      }),
    ),
  );

  return counts.reduce((sum, c) => sum + c, 0);
}

/** Dedupe, then prefer questions with fewest views. Within same view-count tier, shuffle. */
function dedupeAndPickFreshest(batches: RpcRow[][], n: number): RpcRow[] {
  const seen = new Set<string>();
  const all: RpcRow[] = [];
  for (const rows of batches) {
    for (const row of rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        all.push(row);
      }
    }
  }

  const views = getViewCounts(all.map((r) => r.id));

  // Group by view count, shuffle within each group, then flatten lowest-first
  const byCount = new Map<number, RpcRow[]>();
  for (const row of all) {
    const c = views[row.id] ?? 0;
    if (!byCount.has(c)) byCount.set(c, []);
    byCount.get(c)!.push(row);
  }

  const sorted = [...byCount.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, rows]) => shuffle(rows));

  return sorted.slice(0, n);
}

export async function fetchRandomQuestions(
  uiDifficulty: UiDifficulty,
  categorySlugs: string[],
  n: number,
): Promise<LoadedQuestion[]> {
  const dbDifficulties = uiToDbDifficulties(uiDifficulty);
  const allSelected = categorySlugs.length === 0 || categorySlugs.includes('general');
  const slugs = allSelected ? ['general'] : categorySlugs;

  // Server-side exclusion: ask DB to skip questions the user has already seen.
  const excludeIds = getSeenIds();

  // Over-fetch 2x (smaller factor now that server filters seen) so we still have
  // some choice between options for within-batch ordering.
  const overFetch = n * 2;
  const perCombo = Math.max(1, Math.ceil(overFetch / (dbDifficulties.length * slugs.length)) + 2);
  let batches = await Promise.all(
    dbDifficulties.flatMap((diff) =>
      slugs.map((slug) => fetchForDifficulty(diff, slug, perCombo, excludeIds)),
    ),
  );

  let limited = dedupeAndPickFreshest(batches, n);

  // Fallback: if the pool of unseen questions is too small to meet the request,
  // refetch WITHOUT the exclusion so the user still gets a full-length quiz
  // (repeats preferred to a short quiz). Pool-size warnings at Setup make this
  // rare, but we retry defensively anyway.
  if (limited.length < n && excludeIds.length > 0) {
    batches = await Promise.all(
      dbDifficulties.flatMap((diff) =>
        slugs.map((slug) => fetchForDifficulty(diff, slug, perCombo, [])),
      ),
    );
    limited = dedupeAndPickFreshest(batches, n);
  }

  if (limited.length === 0) throw new Error('No questions found — try a different category or difficulty');
  return limited.map(toLoadedQuestion);
}
