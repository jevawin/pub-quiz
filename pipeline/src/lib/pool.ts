/**
 * Run `fn` over `items` with at most `limit` in flight. On the first rejection no NEW item is
 * started; items already in flight are awaited (their calls were paid for) and the first error is
 * rethrown afterwards. Used to overlap the per-question `claude -p` calls, which are dominated by
 * process start-up rather than model time.
 */
export async function runPool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let firstError: unknown;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (err) {
        if (!failed) { failed = true; firstError = err; }
      }
    }
  };
  const n = Math.max(1, Math.min(Math.floor(limit), items.length));
  await Promise.all(Array.from({ length: n }, worker));
  if (failed) throw firstError;
}
