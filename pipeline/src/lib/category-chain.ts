/**
 * Phase 999.22 — chain tagging support.
 *
 * Given a slug→parent_slug map and a list of leaf slugs, return the deduplicated
 * set of slugs covering each leaf and all its ancestors up to root. Used by the
 * chain-tagging calibrator to know which `question_categories` rows to emit per
 * question (one per ancestor in the chain).
 *
 * Robustness:
 * - Slug missing from tree → returned as-is (graceful fallback).
 * - Slug with undefined parent entry → treated as root (no further walk).
 * - Cycles → guarded by visited-set (defensive; tree should be acyclic).
 */
export function expandSlugsToChain(
  parentMap: Map<string, string | null | undefined>,
  leafSlugs: readonly string[],
): string[] {
  const out = new Set<string>();

  for (const leaf of leafSlugs) {
    let cur: string | null | undefined = leaf;
    const seenInPath = new Set<string>();
    while (cur && !seenInPath.has(cur)) {
      seenInPath.add(cur);
      out.add(cur);
      const parent = parentMap.get(cur);
      // null parent (explicit root) or undefined (slug not in map / missing entry)
      // → stop walking. The slug itself is included; ancestors above unknown.
      if (parent === null || parent === undefined) break;
      cur = parent;
    }
  }

  return Array.from(out);
}
