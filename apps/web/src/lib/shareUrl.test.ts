import { describe, it, expect } from 'vitest';
import { buildShareUrl, parseShareParams } from './shareUrl';

describe('shareUrl', () => {
  it('buildShareUrl returns a URL with cat, diff, and n params', () => {
    const url = buildShareUrl(
      { category: 'science-and-nature', difficulty: 'Hard', count: 10 },
      'https://example.com',
    );
    expect(url).toBe(
      'https://example.com/?cat=science-and-nature&diff=Hard&n=10',
    );
  });

  it('parseShareParams extracts config from a query string', () => {
    const config = parseShareParams('?cat=science-and-nature&diff=Hard&n=10');
    expect(config).toEqual({
      category: 'science-and-nature',
      difficulty: 'Hard',
      count: 10,
    });
  });

  it('round-trip preserves values', () => {
    const original = { category: 'history', difficulty: 'Easy' as const, count: 5 };
    const url = buildShareUrl(original, 'https://example.com');
    const parsed = parseShareParams(new URL(url).search);
    expect(parsed).toEqual(original);
  });

  it('buildShareUrl uses window.location.origin as default base', () => {
    // jsdom sets window.location.origin to 'http://localhost:3000' or similar
    const url = buildShareUrl({ category: 'general', difficulty: 'Medium', count: 15 });
    expect(url).toMatch(/^http:\/\/localhost/);
    expect(url).toContain('cat=general');
    expect(url).toContain('diff=Medium');
    expect(url).toContain('n=15');
  });

  it('parseShareParams returns partial when params are missing', () => {
    const config = parseShareParams('?cat=music');
    expect(config).toEqual({ category: 'music' });
  });

  it('parseShareParams rejects invalid difficulty values', () => {
    const config = parseShareParams('?diff=Extreme&n=10');
    expect(config).toEqual({ count: 10 });
    expect(config.difficulty).toBeUndefined();
  });
});
