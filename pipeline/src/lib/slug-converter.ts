export function jsonKeyToSlug(key: string): string {
  return key.replace(/_/g, '-');
}

export function slugToJsonKey(slug: string): string {
  return slug.replace(/-/g, '_');
}

/**
 * Re-key a model's score object so every expected slug's JSON key is present when the model
 * wrote a close variant (case, hyphen vs underscore, dropped leading "the_"). Exact keys win.
 */
export function reconcileScoreKeys(
  scores: Record<string, number>,
  expectedSlugs: string[],
): Record<string, number> {
  const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const stripThe = (k: string) => k.replace(/^the_/, '');
  const out = { ...scores };
  for (const slug of expectedSlugs) {
    const want = slugToJsonKey(slug);
    if (want in out) continue;
    const hit = Object.keys(scores).find(
      k => norm(k) === norm(want) || stripThe(norm(k)) === stripThe(norm(want)),
    );
    if (hit !== undefined) out[want] = scores[hit];
  }
  return out;
}
