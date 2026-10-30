import { z } from 'zod';

export const MIN_VISIBLE_QUESTIONS = 10;
export const MAX_DEPTH = 5;

export interface TaxNode {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  depth: number;
  distinctPublished: number;
  hidden: boolean;
  hiddenReason: string | null;
  protected: boolean;
  childIds: string[];
}

export interface TaxTree {
  byId: Map<string, TaxNode>;
  bySlug: Map<string, TaxNode>;
  /** alias slug -> categoryId */
  aliases: Map<string, string>;
  /** Owner flags (category_flags): normalised name -> display name, newest first. Absent = none loaded. */
  flags?: Map<string, string>;
}

export interface TaxPlan {
  merges: { survivor: string; absorbed: string[]; why: string }[];
  hides: { slug: string; why: string }[];
  creates: { slug: string; name: string; parent: string; why: string }[];
  rehomes: { questionId: string; from: string; to: string }[];
  duplicates: { keep: string; flag: string; why: string }[];
}

export interface Rejection {
  kind: keyof TaxPlan;
  item: unknown;
  reason: string;
}

// Model output is untrusted: missing arrays default to empty, extra keys are stripped.
export const TaxPlanSchema: z.ZodType<TaxPlan, z.ZodTypeDef, unknown> = z.object({
  merges: z
    .array(z.object({ survivor: z.string(), absorbed: z.array(z.string()), why: z.string().default('') }))
    .default([]),
  hides: z.array(z.object({ slug: z.string(), why: z.string().default('') })).default([]),
  creates: z
    .array(z.object({ slug: z.string(), name: z.string(), parent: z.string(), why: z.string().default('') }))
    .default([]),
  rehomes: z.array(z.object({ questionId: z.string(), from: z.string(), to: z.string() })).default([]),
  duplicates: z
    .array(z.object({ keep: z.string(), flag: z.string(), why: z.string().default('') }))
    .default([]),
});
