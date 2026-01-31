import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TextRazorClient, extractEntitiesFromTextRazor } from '../services/textrazor.js';
import { crawlUrl, type CrawlResult } from '../services/crawler.js';
import type { ContentBlock } from '../services/crawl4ai-client.js';
import type { EntityType, ExtractionResult } from '../types/index.js';

const EntityTypeSchema = z.enum([
  'Person', 'Organization', 'Place', 'Product', 'Event',
  'Concept', 'Technology', 'CreativeWork', 'MedicalCondition',
  'Drug', 'Unknown'
]);

const inputSchema = {
  source: z.string().describe('URL or text to analyze'),
  sourceType: z.enum(['url', 'text']).default('url')
    .describe('Whether source is a URL or raw text'),
  minConfidence: z.number().min(0).max(1).default(0.5)
    .describe('Minimum entity confidence threshold'),
  includeTypes: z.array(EntityTypeSchema).optional()
    .describe('Filter to specific entity types'),
  maxEntities: z.number().int().min(1).max(200).default(100)
    .describe('Maximum entities to return')
};

type InputType = z.infer<z.ZodObject<typeof inputSchema>>;

export function registerExtractTool(server: McpServer): void {
  server.tool(
    'seo_extract_entities',
    'Extract named entities from a URL or text. Returns disambiguated entities with Wikidata IDs, confidence scores, and evidence spans. Use for analyzing semantic content of web pages.',
    inputSchema,
    async (params: InputType) => {
      const { source, sourceType, minConfidence, includeTypes, maxEntities } = params;
      const startTime = Date.now();

      try {
        const client = new TextRazorClient();
        let textContent = source;
        let sourceUrl: string | undefined;
        let crawlResult: CrawlResult | null = null;

        // If source is URL, crawl it first
        if (sourceType === 'url') {
          sourceUrl = source;
          crawlResult = await crawlUrl(source);

          if (!crawlResult.success) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  error: `Failed to crawl URL: ${crawlResult.error}`,
                  sourceUrl: source
                }, null, 2)
              }],
              isError: true
            };
          }

          textContent = crawlResult.content;

          if (textContent.length < 50) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  error: 'Page content too short for analysis (< 50 characters)',
                  sourceUrl: source
                }, null, 2)
              }],
              isError: true
            };
          }
        }

        // Extract entities using TextRazor
        const { entities, topics, cleanedText } = await extractEntitiesFromTextRazor(
          client,
          textContent,
          'text',
          minConfidence
        );

        if (sourceType === 'url' && crawlResult?.blocks?.length) {
          attachBlockProvenance(entities, crawlResult.blocks);
        }

        // Filter by entity types if specified
        let filteredEntities = entities;
        if (includeTypes && includeTypes.length > 0) {
          const typeSet = new Set(includeTypes as EntityType[]);
          filteredEntities = entities.filter(e => typeSet.has(e.type));
        }

        // Limit to maxEntities
        filteredEntities = filteredEntities.slice(0, maxEntities);

        const result: ExtractionResult = {
          success: true,
          sourceUrl,
          sourceText: cleanedText.slice(0, 500) + (cleanedText.length > 500 ? '...' : ''),
          sourceTextFull: cleanedText,
          fitMarkdown: crawlResult?.fitMarkdown,
          blocks: crawlResult?.blocks,
          crawlMethod: crawlResult?.crawlMethod,
          warnings: crawlResult?.warnings,
          entities: filteredEntities,
          triples: [],
          topics,
          questionsAnswered: [],
          extractionTime: Date.now() - startTime
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: message,
              suggestion: getSuggestion(error)
            }, null, 2)
          }],
          isError: true
        };
      }
    }
  );
}

function getSuggestion(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('rate limit')) {
      return 'Wait a moment and retry, or reduce batch size';
    }
    if (error.message.includes('TEXTRAZOR_API_KEY')) {
      return 'Set TEXTRAZOR_API_KEY environment variable. Get a free key at https://www.textrazor.com/';
    }
    if (error.message.includes('timeout')) {
      return 'Try a smaller document or increase timeout';
    }
    if (error.message.includes('too large')) {
      return 'Document is too large. Try extracting a specific section or summarizing first.';
    }
  }
  return 'Check input parameters and try again';
}

function attachBlockProvenance(
  entities: ExtractionResult['entities'],
  blocks: ContentBlock[]
): void {
  if (!blocks || blocks.length === 0) return;

  const lowerBlocks = blocks.map(b => ({
    block: b,
    textLower: b.text.toLowerCase()
  }));

  for (const entity of entities) {
    for (const mention of entity.mentions) {
      let matched = blocks.find(
        b =>
          mention.startPosition >= b.charStart &&
          mention.startPosition < b.charEnd
      );

      if (!matched && mention.text) {
        const mentionLower = mention.text.toLowerCase();
        const found = lowerBlocks.find(b => b.textLower.includes(mentionLower));
        matched = found?.block;
      }

      if (matched) {
        mention.blockId = matched.id;
        mention.headingPath = matched.headingPath;
      }
    }
  }
}
