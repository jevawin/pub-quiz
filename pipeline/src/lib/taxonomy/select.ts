import { isGeneralKnowledgeOrUnder, isProtectedOrUnder } from './rules.js';
import type { TaxTree } from './types.js';

export interface LinkRow {
  question_id: string;
  category_id: string;
}

const DAY_MS = 86_400_000;
const REHOME_COOLDOWN_DAYS = 28;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function isStrictDescendant(tree: TaxTree, ancestorId: string, id: string): boolean {
  const seen = new Set<string>();
  let n = tree.byId.get(id);
  while (n && n.parentId && !seen.has(n.id)) {
    seen.add(n.id);
    if (n.parentId === ancestorId) return true;
    n = tree.byId.get(n.parentId);
  }
  return false;
}

function groupByQuestion(links: LinkRow[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const l of links) {
    const a = m.get(l.question_id);
    if (a) a.push(l.category_id);
    else m.set(l.question_id, [l.category_id]);
  }
  return m;
}

/** A question's LEAF categories: those with no other link of the same question strictly below them. */
function leafCategories(tree: TaxTree, cats: string[]): string[] {
  return [...new Set(cats)].filter((c) => !cats.some((o) => o !== c && isStrictDescendant(tree, c, o)));
}

/**
 * Questions whose leaf is this category: linked to it, and none of their other links is a strict
 * descendant of it. Chain tagging links every question to all its ancestors, so a plain link
 * count (or the subtree count) is NOT "questions filed here".
 */
export function leafQuestionIds(tree: TaxTree, categoryId: string, links: LinkRow[]): string[] {
  const out: string[] = [];
  for (const [qid, cats] of groupByQuestion(links)) {
    if (cats.includes(categoryId) && leafCategories(tree, cats).includes(categoryId)) out.push(qid);
  }
  return out.sort();
}

/** The "direct count" of every category: how many questions have it as a leaf. */
export function directCounts(tree: TaxTree, links: LinkRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const cats of groupByQuestion(links).values()) {
    for (const c of leafCategories(tree, cats)) out.set(c, (out.get(c) ?? 0) + 1);
  }
  return out;
}

const time = (iso: string | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};

/** Least recently assessed roots first (never assessed = oldest), ties alphabetical. `last` = slug -> ISO time. */
export function pickWeeklyRoots(roots: string[], last: Record<string, string>, n: number): string[] {
  return [...new Set(roots)]
    .sort((a, b) => {
      const ta = time(last[a]);
      const tb = time(last[b]);
      return ta === tb ? cmp(a, b) : ta < tb ? -1 : 1;
    })
    .slice(0, Math.max(0, n));
}

/**
 * Top-N categories by direct count for re-homing. Excludes roots, general-knowledge (and anything under it), hidden, protected
 * (and anything beneath a protected node), empty ones, and any classified in the last 28 days
 * (`classified` = slug -> ISO time, the persisted state).
 */
export function pickRehomeCategories(
  tree: TaxTree,
  direct: Map<string, number>,
  classified: Record<string, string>,
  n: number,
  now: Date,
): string[] {
  const cutoff = now.getTime() - REHOME_COOLDOWN_DAYS * DAY_MS;
  return [...tree.byId.values()]
    .filter(
      (x) =>
        x.parentId !== null &&
        !isGeneralKnowledgeOrUnder(tree, x.slug) &&
        !x.hidden &&
        !isProtectedOrUnder(tree, x.slug) &&
        (direct.get(x.id) ?? 0) > 0 &&
        !(time(classified[x.slug]) >= cutoff),
    )
    .sort((a, b) => (direct.get(b.id) ?? 0) - (direct.get(a.id) ?? 0) || cmp(a.slug, b.slug))
    .slice(0, Math.max(0, n))
    .map((x) => x.slug);
}
