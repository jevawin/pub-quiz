// Using MediaWiki Action API per D-09. Action API provides full article text
// extraction and is the long-term stable choice.

const BASE_URL = 'https://en.wikipedia.org/w/api.php';

interface WikiQueryResponse {
  query: {
    pages: Array<{
      pageid?: number;
      missing?: boolean;
      title: string;
      extract?: string;
    }>;
    search?: Array<{
      title: string;
    }>;
  };
}

export async function getArticleText(
  title: string,
  userAgent: string,
  maxLength: number = 3000,
): Promise<string | null> {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    explaintext: '1',
    titles: title,
    format: 'json',
    formatversion: '2',
  });

  const response = await fetch(`${BASE_URL}?${params.toString()}`, {
    headers: { 'User-Agent': userAgent },
  });

  if (!response.ok) {
    throw new Error(`Wikipedia API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as WikiQueryResponse;
  const page = data.query.pages[0];

  if (!page || page.missing || !page.extract) {
    return null;
  }

  return page.extract.slice(0, maxLength);
}

export async function searchArticles(
  query: string,
  userAgent: string,
  limit: number = 10,
): Promise<string[]> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: String(limit),
    format: 'json',
    formatversion: '2',
  });

  const response = await fetch(`${BASE_URL}?${params.toString()}`, {
    headers: { 'User-Agent': userAgent },
  });

  if (!response.ok) {
    throw new Error(`Wikipedia API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as WikiQueryResponse;

  return (data.query.search ?? []).map((result) => result.title);
}
