/**
 * seo_crawl_page Tool
 *
 * MCP tool to crawl a URL using Crawl4AI microservice.
 * Returns fit_markdown (boilerplate-free) and structured content blocks.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  getCrawl4AIClient,
  CrawlResult,
  ContentBlock,
  CrawlOptions
} from '../services/crawl4ai-client.js';

// ============================================
// INPUT SCHEMA
// ============================================

export const CrawlPageInputSchema = z.object({
  url: z.string().url().describe('URL to crawl'),
  query: z.string().optional().describe(
    'Optional BM25 query for focused extraction. ' +
    'Content relevant to the query will be prioritized.'
  ),
  useStealth: z.boolean().default(false).describe(
    'Enable stealth mode for anti-bot protected sites. ' +
    'Uses realistic browser fingerprinting and delays.'
  ),
  cacheMode: z.enum(['enabled', 'disabled', 'read_only', 'write_only', 'bypass'])
    .default('enabled')
    .describe(
      'Cache behavior: ' +
      'enabled (default, use and update cache), ' +
      'disabled (no caching), ' +
      'read_only (use cache but don\'t update), ' +
      'write_only (update cache but don\'t read), ' +
      'bypass (skip cache for this request)'
    )
});

export type CrawlPageInput = z.infer<typeof CrawlPageInputSchema>;

// ============================================
// OUTPUT FORMATTING
// ============================================

interface CrawlToolOutput {
  success: boolean;
  url: string;
  title: string;
  description: string;
  fitMarkdown: string;
  blocks: ContentBlock[];
  stats: {
    wordCount: number;
    blockCount: number;
    paragraphCount: number;
    headingCount: number;
    internalLinks: number;
    externalLinks: number;
  };
  links: {
    internal: string[];
    external: string[];
  };
  media: {
    images: Array<{ src: string; alt?: string }>;
    videos: Array<{ src: string; type?: string }>;
  };
  error?: string;
}

function formatOutput(result: CrawlResult): CrawlToolOutput {
  // Calculate stats
  const paragraphBlocks = result.blocks.filter(b => b.type === 'paragraph');
  const headingBlocks = result.blocks.filter(b => b.type.match(/^h[1-6]$/));
  const totalWordCount = result.blocks.reduce((sum, b) => sum + b.wordCount, 0);

  return {
    success: true,
    url: result.url,
    title: result.title,
    description: result.description,
    fitMarkdown: result.fitMarkdown,
    blocks: result.blocks,
    stats: {
      wordCount: totalWordCount,
      blockCount: result.blocks.length,
      paragraphCount: paragraphBlocks.length,
      headingCount: headingBlocks.length,
      internalLinks: result.links.internal.length,
      externalLinks: result.links.external.length
    },
    links: result.links,
    media: result.media
  };
}

// ============================================
// TOOL REGISTRATION
// ============================================

export function registerCrawlTool(server: McpServer): void {
  server.tool(
    'seo_crawl_page',
    `Crawl a URL using Crawl4AI and return cleaned, structured content.

RETURNS:
• fitMarkdown: Boilerplate-free main content (nav, footer, ads removed)
• blocks: Structured content blocks with heading hierarchy for provenance
• stats: Word count, block count, link counts
• links: Internal and external links found
• media: Images and videos extracted

USE THIS TOOL:
• BEFORE seo_extract_entities for cleaner, more focused extraction
• To get structured content blocks required for provenance tracking
• When you need both text content AND document structure

CONTENT BLOCKS:
Each block has:
• id: Unique identifier (e.g., "h2_3", "p_5")
• type: "h1", "h2", "h3", "paragraph", etc.
• text: The block's content
• headingPath: Section hierarchy (e.g., ["H2:Technical SEO", "H3:Core Web Vitals"])
• position: Order in document
• charStart/charEnd: Character positions for evidence spans

STEALTH MODE:
Enable useStealth for sites with anti-bot protection:
• Realistic browser fingerprinting
• Human-like delays
• Cookie handling

CACHE MODES:
• enabled: Normal caching (default)
• disabled: No cache, always fresh crawl
• read_only: Use cache if exists, don't update
• bypass: Skip cache for this request only

REQUIRES: Crawl4AI microservice running at CRAWL4AI_URL (default: http://localhost:8000)`,
    CrawlPageInputSchema.shape,
    {
      title: 'Crawl Page',
      readOnlyHint: true,
      openWorldHint: true // Makes external network requests
    },
    async (args: CrawlPageInput) => {
      try {
        const client = getCrawl4AIClient();

        // Check if service is available
        const isHealthy = await client.healthCheck();
        if (!isHealthy) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'Crawl4AI microservice is not available. ' +
                       'Please start it with: cd crawl4ai-service && python main.py',
                url: args.url
              }, null, 2)
            }],
            isError: true
          };
        }

        // Execute crawl
        const options: CrawlOptions = {
          query: args.query,
          useStealth: args.useStealth,
          cacheMode: args.cacheMode
        };

        const result = await client.crawl(args.url, options);
        const output = formatOutput(result);

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Crawl failed: ${message}`,
              url: args.url
            }, null, 2)
          }],
          isError: true
        };
      }
    }
  );
}

// ============================================
// BATCH CRAWL TOOL (Optional utility)
// ============================================

export const BatchCrawlInputSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(20).describe(
    'URLs to crawl (max 20). Rate limited automatically.'
  ),
  query: z.string().optional().describe('BM25 query for focused extraction')
});

type BatchCrawlInput = z.infer<typeof BatchCrawlInputSchema>;

export function registerBatchCrawlTool(server: McpServer): void {
  server.tool(
    'seo_batch_crawl',
    `Crawl multiple URLs using Crawl4AI with rate limiting.

Use for SERP analysis when you need to analyze multiple competitor pages.
Limited to 20 URLs per batch to prevent abuse.

Returns array of results with fit_markdown and blocks for each URL.`,
    BatchCrawlInputSchema.shape,
    {
      title: 'Batch Crawl Pages',
      readOnlyHint: true,
      openWorldHint: true
    },
    async (args: BatchCrawlInput) => {
      try {
        const client = getCrawl4AIClient();

        // Check if service is available
        const isHealthy = await client.healthCheck();
        if (!isHealthy) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'Crawl4AI microservice is not available.',
                urls: args.urls
              }, null, 2)
            }],
            isError: true
          };
        }

        const results = await client.batchCrawl(args.urls, args.query);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              totalUrls: args.urls.length,
              successfulCrawls: results.filter(r => r.success).length,
              failedCrawls: results.filter(r => !r.success).length,
              results
            }, null, 2)
          }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Batch crawl failed: ${message}`,
              urls: args.urls
            }, null, 2)
          }],
          isError: true
        };
      }
    }
  );
}
