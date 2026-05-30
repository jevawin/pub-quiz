import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recordView, getSeenIds, getViewCounts, totalPlayed, clearAll } from './seen-store';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('seen-store', () => {
  it('records a view and excludes the id on next read', () => {
    recordView('q1');
    expect(getSeenIds()).toContain('q1');
    expect(getViewCounts(['q1', 'q2'])).toEqual({ q1: 1, q2: 0 });
    expect(totalPlayed()).toBe(1);
  });

  it('does not throw when localStorage.setItem fails (Safari private/ITP/quota)', () => {
    // Regression for FB21: a failed write must not throw into the caller.
    // Previously save() let the exception escape onConfirm, corrupting the
    // seen set and letting the question repeat.
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

    expect(() => recordView('q1')).not.toThrow();
    spy.mockRestore();
  });

  it('clearAll removes all seen data', () => {
    recordView('q1');
    clearAll();
    expect(getSeenIds()).toEqual([]);
    expect(totalPlayed()).toBe(0);
  });
});
