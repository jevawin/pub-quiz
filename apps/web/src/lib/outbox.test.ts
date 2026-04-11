import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  enqueue,
  peek,
  flushOutbox,
  MAX_OUTBOX,
  size,
  __resetFlushing,
} from './outbox';

type TestPayload = { id: string; value: number };

describe('outbox', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetFlushing();
  });

  it('enqueue adds a row; peek returns it', () => {
    enqueue<TestPayload>('question_plays', { id: 'a', value: 1 });
    const items = peek<TestPayload>('question_plays');
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ id: 'a', value: 1 });
  });

  it('FIFO — enqueue A, B, C then flush: insert called in order A, B, C', async () => {
    enqueue('question_plays', 'A');
    enqueue('question_plays', 'B');
    enqueue('question_plays', 'C');

    const order: string[] = [];
    const insert = vi.fn(async (row: string) => {
      order.push(row);
      return { error: null };
    });

    await flushOutbox<string>('question_plays', insert);
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('cap at 500 — enqueuing the 501st drops the oldest', () => {
    for (let i = 0; i < MAX_OUTBOX + 1; i++) {
      enqueue('question_plays', { id: `item-${i}` });
    }
    expect(size('question_plays')).toBe(MAX_OUTBOX);
    const items = peek<{ id: string }>('question_plays');
    // First item should be item-1 (item-0 was dropped)
    expect(items[0].id).toBe('item-1');
    expect(items[items.length - 1].id).toBe(`item-${MAX_OUTBOX}`);
  });

  it('flush stops on first failure and keeps remaining entries', async () => {
    enqueue('question_plays', 'A');
    enqueue('question_plays', 'B');
    enqueue('question_plays', 'C');

    const insert = vi.fn(async (row: string) => {
      if (row === 'B') return { error: 'network error' };
      return { error: null };
    });

    await flushOutbox<string>('question_plays', insert);
    // B and C should remain
    const remaining = peek<string>('question_plays');
    expect(remaining).toEqual(['B', 'C']);
  });

  it('flush empties the queue on full success', async () => {
    enqueue('question_plays', 'X');
    enqueue('question_plays', 'Y');

    const insert = vi.fn(async () => ({ error: null }));
    await flushOutbox<string>('question_plays', insert);
    expect(size('question_plays')).toBe(0);
  });

  it('concurrent flushes — second call returns immediately', async () => {
    enqueue('question_plays', 'slow');

    let resolveInsert!: () => void;
    const insertPromise = new Promise<void>((r) => {
      resolveInsert = r;
    });

    const insert = vi.fn(async () => {
      await insertPromise;
      return { error: null };
    });

    const flush1 = flushOutbox<string>('question_plays', insert);
    // Second flush should bail immediately
    const flush2 = flushOutbox<string>('question_plays', insert);

    resolveInsert();
    await Promise.all([flush1, flush2]);

    // insert should only be called once (from the first flush)
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('bad JSON in localStorage is treated as empty queue', () => {
    localStorage.setItem('pub-quiz:outbox:question_plays:v1', '{not valid json!!!');
    const items = peek('question_plays');
    expect(items).toEqual([]);
    // Should not throw, and enqueue should work fine after
    enqueue('question_plays', 'recovery');
    expect(peek('question_plays')).toHaveLength(1);
  });
});
