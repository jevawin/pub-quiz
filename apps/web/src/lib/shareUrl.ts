import type { UiDifficulty } from './difficulty';

export type SetupConfig = {
  category: string;
  difficulty: UiDifficulty;
  count: number;
};

export function buildShareUrl(
  config: SetupConfig,
  origin: string = window.location.origin,
): string {
  const params = new URLSearchParams({
    cat: config.category,
    diff: config.difficulty,
    n: String(config.count),
  });
  return `${origin}/?${params.toString()}`;
}

export function parseShareParams(search: string): Partial<SetupConfig> {
  const p = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  );
  const out: Partial<SetupConfig> = {};
  const cat = p.get('cat');
  if (cat) out.category = cat;
  const diff = p.get('diff');
  if (diff === 'Easy' || diff === 'Medium' || diff === 'Hard')
    out.difficulty = diff;
  const n = p.get('n');
  if (n && !Number.isNaN(Number(n))) out.count = Number(n);
  return out;
}
