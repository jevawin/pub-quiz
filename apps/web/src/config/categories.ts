// The 12 seed category slugs from supabase/seed.sql + the virtual 'general' option.
// If a slug here does not match the DB, the RPC will return zero rows -- keep in sync.

import type { LucideIcon } from 'lucide-react';
import {
  LayoutGrid, Atom, Landmark, Globe, Clapperboard, Music,
  Gamepad2, Trophy, UtensilsCrossed, BookOpen, Palette, Cpu, TreePine,
} from 'lucide-react';

export type CategoryOption = { slug: string; label: string; icon: LucideIcon };

export const CATEGORY_OPTIONS: readonly CategoryOption[] = [
  { slug: 'general', label: 'General', icon: LayoutGrid },
  { slug: 'science', label: 'Science', icon: Atom },
  { slug: 'history', label: 'History', icon: Landmark },
  { slug: 'geography', label: 'Geography', icon: Globe },
  { slug: 'movies-and-tv', label: 'Movies and TV', icon: Clapperboard },
  { slug: 'music', label: 'Music', icon: Music },
  { slug: 'gaming', label: 'Gaming', icon: Gamepad2 },
  { slug: 'sports', label: 'Sports', icon: Trophy },
  { slug: 'food-and-drink', label: 'Food and Drink', icon: UtensilsCrossed },
  { slug: 'literature', label: 'Literature', icon: BookOpen },
  { slug: 'art-and-design', label: 'Art and Design', icon: Palette },
  { slug: 'technology', label: 'Technology', icon: Cpu },
  { slug: 'nature-and-animals', label: 'Nature and Animals', icon: TreePine },
];

export const CATEGORY_MAP = new Map(CATEGORY_OPTIONS.map((c) => [c.slug, c]));

/** Given any slug (including subcategory), return the best matching category option. */
export function findCategory(slug: string): CategoryOption {
  // Exact match
  const exact = CATEGORY_MAP.get(slug);
  if (exact) return exact;
  // Fallback: format slug as label, use LayoutGrid as icon
  const label = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { slug, label, icon: LayoutGrid };
}

export const DEFAULT_CATEGORY = 'general';
export const QUESTION_COUNTS = [5, 10, 15, 20] as const;
export type QuestionCount = (typeof QUESTION_COUNTS)[number];

export function isValidCategory(slug: string): boolean {
  return CATEGORY_OPTIONS.some((c) => c.slug === slug);
}

export function isValidCount(n: number): n is QuestionCount {
  return (QUESTION_COUNTS as readonly number[]).includes(n);
}
