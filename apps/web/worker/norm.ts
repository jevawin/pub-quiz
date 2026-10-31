// Port of normCategoryName from pipeline/src/lib/taxonomy/flags.ts. Flags written here must match the
// pipeline CLI's exactly (category_flags.norm is the unique key), so keep the two in step; the test in
// __tests__/api-write.test.ts pins ten sample outputs.
const STOP_WORDS = new Set(['the', 'a', 'an', 'of']);

export function normCategoryName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP_WORDS.has(w) && w !== 'and')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join('-');
}
