import { describe, it, expect } from 'vitest';
import { runPool } from '../pool.js';

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

describe('runPool', () => {
  it('processes every item and never exceeds the limit', async () => {
    let active = 0, peak = 0; const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => { active++; peak = Math.max(peak, active); await tick(3); seen.push(n); active--; });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });
  it('actually overlaps work (limit 3 reaches 3 in flight)', async () => {
    let active = 0, peak = 0;
    await runPool([1, 2, 3], 3, async () => { active++; peak = Math.max(peak, active); await tick(5); active--; });
    expect(peak).toBe(3);
  });
  it('after a rejection starts no new items, awaits in-flight ones, and rethrows the first error', async () => {
    const started: number[] = []; const finished: number[] = [];
    await expect(runPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      started.push(n);
      if (n === 2) throw new Error('stop');
      await tick(10); finished.push(n);
    })).rejects.toThrow('stop');
    expect(started).not.toContain(6);
    expect(finished).toContain(1);
  });
  it('handles an empty list and a limit larger than the list', async () => {
    await runPool([], 3, async () => { throw new Error('never'); });
    const seen: number[] = [];
    await runPool([1], 8, async (n) => { seen.push(n); });
    expect(seen).toEqual([1]);
  });
});
