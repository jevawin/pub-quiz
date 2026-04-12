const STORAGE_KEY = 'pq_seen_questions';

type SeenMap = Record<string, number>;

function load(): SeenMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SeenMap) : {};
  } catch {
    return {};
  }
}

function save(map: SeenMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

/** Record a view for a question. */
export function recordView(questionId: string): void {
  const map = load();
  map[questionId] = (map[questionId] ?? 0) + 1;
  save(map);
}

/** Get view counts for a list of question IDs. Returns 0 for unseen. */
export function getViewCounts(ids: string[]): Record<string, number> {
  const map = load();
  const result: Record<string, number> = {};
  for (const id of ids) {
    result[id] = map[id] ?? 0;
  }
  return result;
}

/** Total number of unique questions played. */
export function totalPlayed(): number {
  return Object.keys(load()).length;
}

/** Clear all seen data. */
export function clearAll(): void {
  localStorage.removeItem(STORAGE_KEY);
}
