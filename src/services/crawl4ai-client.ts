/**
 * Crawl4AI Microservice Client
 *
 * HTTP client for the Crawl4AI Python microservice.
 * Provides fit_markdown (boilerplate-free) content and structured blocks.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import Bottleneck from 'bottleneck';

// ============================================
// CONTENT BLOCK TYPES
// ============================================

export interface ContentBlock {
  /** Unique block ID */
  id: string;
  /** Block type: h1, h2, h3, h4, h5, h6, paragraph, list, table */
  type: string;
  /** Block content text */
  text: string;
  /** Heading hierarchy path, e.g. ["H2:Technical SEO", "H3:Core Web Vitals"] */
  headingPath: string[];
  /** Position in document (0-indexed) */
  position: number;
  /** Character start position in original markdown */
  charStart: number;
  /** Character end position in original markdown */
  charEnd: number;
  /** Word count in this block */
  wordCount: number;
  /** Parent block ID (if nested under a heading) */
  parentId?: string;
}

// ============================================
// CRAWL RESULT TYPES
// ============================================

export interface CrawlResult {
  /** Crawled URL */
  url: string;
  /** Page title */
  title: string;
  /** Meta description */
  description: string;
  /** Boilerplate-free markdown content */
  fitMarkdown: string;
  /** Full markdown content (including boilerplate) */
  rawMarkdown: string;
  /** Structured content blocks with heading hierarchy */
  blocks: ContentBlock[];
  /** Extracted links */
  links: {
    internal: string[];
    external: string[];
  };
  /** Extracted media */
  media: {
    images: Array<{ src: string; alt?: string }>;
    videos: Array<{ src: string; type?: string }>;
  };
  /** Page metadata */
  metadata: Record<string, unknown>;
}

export interface CrawlOptions {
  /** BM25 query for focused content extraction */
  query?: string;
  /** Enable stealth mode for anti-bot sites */
  useStealth?: boolean;
  /** Cache behavior */
  cacheMode?: 'enabled' | 'disabled' | 'read_only' | 'write_only' | 'bypass';
  /** Parse into structured blocks (default: true) */
  parseBlocks?: boolean;
}

export interface BatchCrawlResult {
  url: string;
  success: boolean;
  fitMarkdown?: string;
  blocks?: ContentBlock[];
  error?: string;
}

// ============================================
// CRAWL4AI CLIENT
// ============================================

export class Crawl4AIClient {
  private client: AxiosInstance;
  private limiter: Bottleneck;

  constructor(
    baseUrl: string = process.env.CRAWL4AI_URL || 'http://localhost:8000',
    options: {
      timeout?: number;
      maxConcurrent?: number;
      minTime?: number;
    } = {}
  ) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: options.timeout ?? 60000, // 60 second timeout for slow pages
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Rate limiter to avoid overwhelming the microservice
    this.limiter = new Bottleneck({
      maxConcurrent: options.maxConcurrent ?? 2,
      minTime: options.minTime ?? 1000 // At least 1 second between requests
    });
  }

  /**
   * Crawl a single URL and return fit_markdown + structured blocks.
   *
   * @param url - Target URL to crawl
   * @param options - Crawl options (query, stealth mode, cache)
   * @returns CrawlResult with fit_markdown and content blocks
   */
  async crawl(url: string, options: CrawlOptions = {}): Promise<CrawlResult> {
    return this.limiter.schedule(() => this.executeCrawl(url, options));
  }

  private async executeCrawl(url: string, options: CrawlOptions): Promise<CrawlResult> {
    try {
      const response = await this.client.post('/crawl', {
        url,
        query: options.query,
        use_stealth: options.useStealth ?? false,
        cache_mode: options.cacheMode ?? 'enabled',
        parse_blocks: options.parseBlocks ?? true
      });

      const data = response.data;

      return {
        url: data.url,
        title: data.title || '',
        description: data.description || '',
        fitMarkdown: data.fit_markdown || data.fitMarkdown || '',
        rawMarkdown: data.raw_markdown || data.rawMarkdown || '',
        blocks: this.transformBlocks(data.blocks || []),
        links: {
          internal: data.links?.internal || [],
          external: data.links?.external || []
        },
        media: {
          images: data.media?.images || [],
          videos: data.media?.videos || []
        },
        metadata: data.metadata || {}
      };
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.code === 'ECONNREFUSED') {
          throw new Error(
            `Crawl4AI microservice not available at ${this.client.defaults.baseURL}. ` +
            'Please start the service with: cd crawl4ai-service && python main.py'
          );
        }
        if (error.response) {
          throw new Error(
            `Crawl failed (${error.response.status}): ${error.response.data?.detail || error.message}`
          );
        }
      }
      throw error;
    }
  }

  /**
   * Transform blocks from Python snake_case to TypeScript camelCase.
   */
  private transformBlocks(blocks: unknown[]): ContentBlock[] {
    return blocks.map((raw) => {
      const b = raw as Record<string, unknown>;
      return {
        id: String(b.id || ''),
        type: String(b.type || 'paragraph'),
        text: String(b.text || ''),
        headingPath: (b.heading_path || b.headingPath || []) as string[],
        position: Number(b.position || 0),
        charStart: Number(b.char_start ?? b.charStart ?? 0),
        charEnd: Number(b.char_end ?? b.charEnd ?? 0),
        wordCount: Number(b.word_count ?? b.wordCount ?? 0),
        parentId: b.parent_id ? String(b.parent_id) : (b.parentId ? String(b.parentId) : undefined)
      };
    });
  }

  /**
   * Crawl multiple URLs with rate limiting.
   *
   * @param urls - Array of URLs to crawl
   * @param query - Optional BM25 query for focused extraction
   * @returns Array of crawl results
   */
  async batchCrawl(urls: string[], query?: string): Promise<BatchCrawlResult[]> {
    try {
      const response = await this.client.post('/batch-crawl', urls, {
        params: { query },
        timeout: 300000 // 5 minutes for batch operations
      });

      return (response.data.results || []).map((r: Record<string, unknown>) => ({
        url: String(r.url),
        success: Boolean(r.success),
        fitMarkdown: r.fit_markdown ? String(r.fit_markdown) : undefined,
        blocks: r.blocks ? this.transformBlocks(r.blocks as unknown[]) : undefined,
        error: r.error ? String(r.error) : undefined
      }));
    } catch (error) {
      if (error instanceof AxiosError && error.code === 'ECONNREFUSED') {
        throw new Error(
          `Crawl4AI microservice not available at ${this.client.defaults.baseURL}. ` +
          'Please start the service with: cd crawl4ai-service && python main.py'
        );
      }
      throw error;
    }
  }

  /**
   * Check if the Crawl4AI microservice is healthy.
   *
   * @returns true if service is running and healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health', { timeout: 5000 });
      return response.data?.status === 'healthy';
    } catch {
      return false;
    }
  }

  /**
   * Get service version and capabilities.
   */
  async getServiceInfo(): Promise<{ version: string; status: string }> {
    try {
      const response = await this.client.get('/health', { timeout: 5000 });
      return {
        version: response.data?.version || 'unknown',
        status: response.data?.status || 'unknown'
      };
    } catch {
      return { version: 'unavailable', status: 'offline' };
    }
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let clientInstance: Crawl4AIClient | null = null;

/**
 * Get the singleton Crawl4AI client instance.
 * Creates a new instance if one doesn't exist.
 */
export function getCrawl4AIClient(): Crawl4AIClient {
  if (!clientInstance) {
    clientInstance = new Crawl4AIClient();
  }
  return clientInstance;
}

/**
 * Create a new Crawl4AI client with custom configuration.
 */
export function createCrawl4AIClient(
  baseUrl?: string,
  options?: { timeout?: number; maxConcurrent?: number; minTime?: number }
): Crawl4AIClient {
  return new Crawl4AIClient(baseUrl, options);
}

// Default export
export const crawl4aiClient = getCrawl4AIClient();
