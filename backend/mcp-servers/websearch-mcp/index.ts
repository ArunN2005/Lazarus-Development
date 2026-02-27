// ============================================================================
// LAZARUS — Web Search MCP Server
// ECS Fargate container / Lambda: Tavily + DuckDuckGo fallback
// ============================================================================

import type { SearchRequest, SearchResponse, SearchResult } from '../../shared/types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TAVILY_API_KEY = process.env['TAVILY_API_KEY'] ?? '';
const TAVILY_URL = 'https://api.tavily.com/search';
const DDG_URL = 'https://api.duckduckgo.com/';

// ---------------------------------------------------------------------------
// Main handler (works as both Lambda and ECS entrypoint)
// ---------------------------------------------------------------------------

export async function handler(
  event: SearchRequest
): Promise<SearchResponse> {
  const { queries, maxResultsPerQuery = 3, tokenBudget = 10000 } = event;
  const allResults: SearchResult[] = [];
  let totalTokensUsed = 0;

  console.log(JSON.stringify({
    level: 'info',
    message: 'Web search starting',
    queries: queries.length,
    tokenBudget,
  }));

  for (const query of queries) {
    if (totalTokensUsed >= tokenBudget) {
      console.log(JSON.stringify({
        level: 'info',
        message: 'Token budget exhausted, stopping',
        totalTokensUsed,
      }));
      break;
    }

    try {
      const results = TAVILY_API_KEY
        ? await searchTavily(query, maxResultsPerQuery)
        : await searchDuckDuckGo(query, maxResultsPerQuery);

      for (const result of results) {
        const tokenEstimate = Math.ceil(result.content.length / 4);
        if (totalTokensUsed + tokenEstimate > tokenBudget) break;

        allResults.push(result);
        totalTokensUsed += tokenEstimate;
      }
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Search failed for query',
        query,
        error: String(error),
      }));

      // Try DuckDuckGo as fallback
      if (TAVILY_API_KEY) {
        try {
          const fallbackResults = await searchDuckDuckGo(query, maxResultsPerQuery);
          for (const result of fallbackResults) {
            const tokenEstimate = Math.ceil(result.content.length / 4);
            if (totalTokensUsed + tokenEstimate > tokenBudget) break;
            allResults.push(result);
            totalTokensUsed += tokenEstimate;
          }
        } catch (fallbackError) {
          console.error(JSON.stringify({
            level: 'error',
            message: 'Fallback search also failed',
            query,
            error: String(fallbackError),
          }));
        }
      }
    }
  }

  console.log(JSON.stringify({
    level: 'info',
    message: 'Web search complete',
    totalResults: allResults.length,
    totalTokensUsed,
  }));

  return { results: allResults, totalTokensUsed };
}

// ---------------------------------------------------------------------------
// Tavily Search (primary — returns actual page content)
// ---------------------------------------------------------------------------

async function searchTavily(
  query: string,
  maxResults: number
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'advanced',
        max_results: maxResults,
        include_raw_content: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      results: Array<{
        title: string;
        url: string;
        content: string;
        raw_content?: string;
        score?: number;
      }>;
    };

    return (data.results ?? []).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      content: truncateContent(r.raw_content ?? r.content ?? '', 2000),
      relevance: r.score ?? 0.5,
    }));
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// DuckDuckGo Search (fallback — no API key needed)
// ---------------------------------------------------------------------------

async function searchDuckDuckGo(
  query: string,
  maxResults: number
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const url = `${DDG_URL}?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`DuckDuckGo API error: ${response.status}`);
    }

    const data = await response.json() as {
      Abstract?: string;
      AbstractURL?: string;
      AbstractSource?: string;
      RelatedTopics?: Array<{
        Text?: string;
        FirstURL?: string;
      }>;
    };

    const results: SearchResult[] = [];

    // Main abstract
    if (data.Abstract) {
      results.push({
        title: data.AbstractSource ?? 'DuckDuckGo Result',
        url: data.AbstractURL ?? '',
        content: truncateContent(data.Abstract, 2000),
        relevance: 0.8,
      });
    }

    // Related topics
    for (const topic of (data.RelatedTopics ?? []).slice(0, maxResults - results.length)) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.substring(0, 100),
          url: topic.FirstURL,
          content: truncateContent(topic.Text, 1000),
          relevance: 0.5,
        });
      }
    }

    return results;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.substring(0, maxChars) + '...';
}

// ---------------------------------------------------------------------------
// ECS Entrypoint
// ---------------------------------------------------------------------------

if (process.env['ECS_CONTAINER_METADATA_URI']) {
  // Running as ECS task — read input from env
  const input: SearchRequest = {
    queries: JSON.parse(process.env['SEARCH_QUERIES'] ?? '[]'),
    maxResultsPerQuery: parseInt(process.env['MAX_RESULTS_PER_QUERY'] ?? '3', 10),
    tokenBudget: parseInt(process.env['TOKEN_BUDGET'] ?? '10000', 10),
  };

  handler(input)
    .then((result) => {
      console.log(JSON.stringify({ type: 'result', data: result }));
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal:', err);
      process.exit(1);
    });
}
