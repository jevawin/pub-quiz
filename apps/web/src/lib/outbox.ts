export type OutboxKey = 'question_plays' | 'quiz_sessions';
export const MAX_OUTBOX = 500;
const KEY_PREFIX = 'pub-quiz:outbox:';
const KEY_SUFFIX = ':v1';

type Entry<T> = { payload: T; enqueuedAt: number };

function storageKey(k: OutboxKey) {
  return `${KEY_PREFIX}${k}${KEY_SUFFIX}`;
}

function loadQueue<T>(k: OutboxKey): Entry<T>[] {
  try {
    const raw = localStorage.getItem(storageKey(k));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue<T>(k: OutboxKey, q: Entry<T>[]) {
  localStorage.setItem(storageKey(k), JSON.stringify(q));
}

export function enqueue<T>(k: OutboxKey, payload: T): void {
  const q = loadQueue<T>(k);
  q.push({ payload, enqueuedAt: Date.now() });
  while (q.length > MAX_OUTBOX) q.shift();
  saveQueue(k, q);
}

export function peek<T>(k: OutboxKey): T[] {
  return loadQueue<T>(k).map((e) => e.payload);
}

export function size(k: OutboxKey): number {
  return loadQueue(k).length;
}

const flushing = new Map<OutboxKey, boolean>();

export async function flushOutbox<T>(
  k: OutboxKey,
  insert: (row: T) => Promise<{ error: unknown }>,
): Promise<void> {
  if (flushing.get(k)) return;
  flushing.set(k, true);
  try {
    const queue = loadQueue<T>(k);
    if (queue.length === 0) return;
    const remaining: Entry<T>[] = [];
    let stopped = false;
    for (const entry of queue) {
      if (stopped) {
        remaining.push(entry);
        continue;
      }
      const { error } = await insert(entry.payload);
      if (error) {
        remaining.push(entry);
        stopped = true;
      }
    }
    saveQueue(k, remaining);
  } finally {
    flushing.set(k, false);
  }
}

// Test helper
export function __resetFlushing() {
  flushing.clear();
}
