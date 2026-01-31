import axios from 'axios';
import * as cheerio from 'cheerio';
import Bottleneck from 'bottleneck';
import { getCrawl4AIClient, type ContentBlock } from './crawl4ai-client.js';

export interface CrawlResult {
  url: string;
  title: string;
  metaDescription?: string;
  h1?: string;
  content: string;
  wordCount: number;
  success: boolean;
  error?: string;
  fitMarkdown?: string;
  rawMarkdown?: string;
  blocks?: ContentBlock[];
  crawlMethod?: 'crawl4ai' | 'legacy';
  warnings?: string[];
}

// Rate limiter for crawling
const crawlLimiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 500
});

const USER_AGENT = 'Mozilla/5.0 (compatible; SEOSemanticMCP/1.0; +https://github.com/seo-semantic-mcp)';

export async function crawlUrl(url: string): Promise<CrawlResult> {
  return crawlLimiter.schedule(() => fetchAndParse(url));
}

async function fetchAndParse(url: string): Promise<CrawlResult> {
  try {
    const warnings: string[] = [];

    // Prefer Crawl4AI if available
    const crawl4aiEnabled = process.env.CRAWL4AI_DISABLE !== 'true';
    if (crawl4aiEnabled) {
      const crawl4ai = getCrawl4AIClient();
      const isHealthy = await crawl4ai.healthCheck();

      if (isHealthy) {
        try {
          const result = await crawl4ai.crawl(url, { parseBlocks: true });
          const content = result.fitMarkdown || result.rawMarkdown || '';
          const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
          const h1Block = result.blocks.find(b => b.type === 'h1');

          return {
            url,
            title: result.title || '',
            metaDescription: result.description || undefined,
            h1: h1Block?.text,
            content,
            wordCount,
            success: true,
            fitMarkdown: result.fitMarkdown,
            rawMarkdown: result.rawMarkdown,
            blocks: result.blocks,
            crawlMethod: 'crawl4ai'
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          warnings.push(`Crawl4AI failed, falling back to legacy crawler: ${message}`);
        }
      } else {
        warnings.push('Crawl4AI service unavailable, falling back to legacy crawler');
      }
    }

    const response = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      timeout: 15000,
      maxRedirects: 5
    });

    const $ = cheerio.load(response.data);

    // Remove unwanted elements
    $('script, style, nav, footer, header, aside, .nav, .footer, .header, .sidebar, .advertisement, .ad, [role="navigation"], [role="banner"]').remove();

    // Extract metadata
    const title = $('title').text().trim() || $('h1').first().text().trim() || '';
    const metaDescription = $('meta[name="description"]').attr('content')?.trim();
    const h1 = $('h1').first().text().trim();

    // Extract main content
    let content = '';

    // Try to find main content area
    const mainSelectors = ['main', 'article', '[role="main"]', '.content', '.post-content', '.entry-content', '#content'];
    for (const selector of mainSelectors) {
      const main = $(selector);
      if (main.length > 0) {
        content = main.text();
        break;
      }
    }

    // Fallback to body if no main content found
    if (!content) {
      content = $('body').text();
    }

    // Clean up content
    content = cleanText(content);
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

    return {
      url,
      title,
      metaDescription,
      h1,
      content,
      wordCount,
      success: true,
      crawlMethod: 'legacy',
      warnings: warnings.length > 0 ? warnings : undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      url,
      title: '',
      content: '',
      wordCount: 0,
      success: false,
      error: message
    };
  }
}

function cleanText(text: string): string {
  return text
    // Replace multiple whitespace with single space
    .replace(/\s+/g, ' ')
    // Remove non-printable characters
    .replace(/[\x00-\x1F\x7F]/g, '')
    // Trim
    .trim();
}

export async function crawlMultipleUrls(urls: string[]): Promise<CrawlResult[]> {
  const results: CrawlResult[] = [];

  for (const url of urls) {
    const result = await crawlUrl(url);
    results.push(result);
  }

  return results;
}

export function extractTextContent(html: string): string {
  const $ = cheerio.load(html);

  // Remove unwanted elements
  $('script, style, nav, footer, header, aside').remove();

  return cleanText($('body').text());
}
