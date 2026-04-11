// The 12 seed category slugs from supabase/seed.sql + the virtual 'general' option.
// If a slug here does not match the DB, the RPC will return zero rows -- keep in sync.

export type CategoryOption = { slug: string; label: string };

export const CATEGORY_OPTIONS: readonly CategoryOption[] = [
  { slug: 'general', label: 'General' },
  { slug: 'science', label: 'Science' },
  { slug: 'history', label: 'History' },
  { slug: 'geography', label: 'Geography' },
  { slug: 'movies-and-tv', label: 'Movies and TV' },
  { slug: 'music', label: 'Music' },
  { slug: 'gaming', label: 'Gaming' },
  { slug: 'sports', label: 'Sports' },
  { slug: 'food-and-drink', label: 'Food and Drink' },
  { slug: 'literature', label: 'Literature' },
  { slug: 'art-and-design', label: 'Art and Design' },
  { slug: 'technology', label: 'Technology' },
  { slug: 'nature-and-animals', label: 'Nature and Animals' },
];

export const DEFAULT_CATEGORY = 'general';
export const QUESTION_COUNTS = [5, 10, 15, 20] as const;
export type QuestionCount = (typeof QUESTION_COUNTS)[number];

export function isValidCategory(slug: string): boolean {
  return CATEGORY_OPTIONS.some((c) => c.slug === slug);
}

export function isValidCount(n: number): n is QuestionCount {
  return (QUESTION_COUNTS as readonly number[]).includes(n);
}
