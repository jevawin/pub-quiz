import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getArticleText, searchArticles } from '../../src/lib/wikipedia.js';

const userAgent = 'TestAgent/1.0';

describe('Wikipedia helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('getArticleText', () => {
    it('returns article extract text', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          query: {
            pages: [
              {
                pageid: 12345,
                title: 'Albert Einstein',
                extract: 'Albert Einstein was a German-born theoretical physicist.',
              },
            ],
          },
        }),
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const result = await getArticleText('Albert Einstein', userAgent);
      expect(result).toBe('Albert Einstein was a German-born theoretical physicist.');
    });

    it('returns null for missing pages', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          query: {
            pages: [
              {
                title: 'Nonexistent Page',
                missing: true,
              },
            ],
          },
        }),
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const result = await getArticleText('Nonexistent Page', userAgent);
      expect(result).toBeNull();
    });

    it('truncates content to maxLength', async () => {
      const longText = 'A'.repeat(5000);
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          query: {
            pages: [{ pageid: 1, title: 'Long', extract: longText }],
          },
        }),
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const result = await getArticleText('Long', userAgent, 100);
      expect(result).not.toBeNull();
      expect(result!.length).toBe(100);
    });

    it('includes User-Agent header', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          query: { pages: [{ pageid: 1, title: 'Test', extract: 'text' }] },
        }),
      } as unknown as Response);

      await getArticleText('Test', userAgent);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const url = fetchSpy.mock.calls[0][0] as string;
      const options = fetchSpy.mock.calls[0][1] as RequestInit;
      expect(options.headers).toHaveProperty('User-Agent', userAgent);
      expect(url).toContain('formatversion=2');
    });
  });

  describe('searchArticles', () => {
    it('returns array of titles from search results', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          query: {
            search: [
              { title: 'Physics' },
              { title: 'Physics Today' },
              { title: 'Outline of physics' },
            ],
          },
        }),
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const result = await searchArticles('Physics', userAgent, 3);
      expect(result).toEqual(['Physics', 'Physics Today', 'Outline of physics']);
    });

    it('includes User-Agent header and formatversion=2', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          query: { search: [] },
        }),
      } as unknown as Response);

      await searchArticles('Test', userAgent, 5);

      const url = fetchSpy.mock.calls[0][0] as string;
      const options = fetchSpy.mock.calls[0][1] as RequestInit;
      expect(options.headers).toHaveProperty('User-Agent', userAgent);
      expect(url).toContain('formatversion=2');
    });
  });
});
