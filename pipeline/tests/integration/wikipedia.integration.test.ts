import { describe, it, expect } from 'vitest';
import { getArticleText, searchArticles } from '../../src/lib/wikipedia.js';

const userAgent = 'PubQuizPipelineTest/1.0 (https://github.com/pub-quiz; testing)';

describe.skipIf(process.env.CI === 'true')('Wikipedia Integration (real API)', () => {
  it('searchArticles returns at least 1 result for a known query', async () => {
    const results = await searchArticles('Albert Einstein', userAgent, 3);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]).toBeTruthy();
  });

  it('getArticleText returns non-null string for a known article', async () => {
    const text = await getArticleText('Albert Einstein', userAgent, 500);
    expect(text).not.toBeNull();
    expect(typeof text).toBe('string');
    expect(text!.length).toBeGreaterThan(0);
    expect(text!.length).toBeLessThanOrEqual(500);
  });
});
