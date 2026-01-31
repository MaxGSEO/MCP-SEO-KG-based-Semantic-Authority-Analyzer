/**
 * seo_extract_relations Tool
 *
 * MCP tool to extract typed relations from content blocks using NuExtract 2.0.
 * Uses two-pass extraction: entities first, then relations between found entities.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getNuExtractClient } from '../services/nuextract-client.js';
import { RelationExtractor } from '../extraction/relation-extractor.js';
import { ContentBlock } from '../services/crawl4ai-client.js';

// ============================================
// INPUT SCHEMA
// ============================================

const ContentBlockSchema = z.object({
  id: z.string(),
  type: z.string(),
  text: z.string(),
  headingPath: z.array(z.string()),
  position: z.number(),
  charStart: z.number(),
  charEnd: z.number(),
  wordCount: z.number(),
  parentId: z.string().optional()
});

export const ExtractRelationsInputSchema = z.object({
  blocks: z.array(ContentBlockSchema).describe(
    'Content blocks from seo_crawl_page. ' +
    'Each block has id, type, text, headingPath, position, charStart, charEnd, wordCount.'
  ),
  sourceUrl: z.string().url().describe(
    'Source URL for provenance tracking. ' +
    'This should be the URL that was crawled to get the blocks.'
  )
});

export type ExtractRelationsInput = z.infer<typeof ExtractRelationsInputSchema>;

// ============================================
// TOOL REGISTRATION
// ============================================

export function registerRelationsTool(server: McpServer): void {
  server.tool(
    'seo_extract_relations',
    `Extract typed relations from content blocks using NuExtract 2.0.

TWO-PASS EXTRACTION:
1. First extracts entities with evidence spans
2. Then extracts relations between found entities

This prevents hallucinated relations by only creating relations
between entities actually found in the text.

CONTROLLED PREDICATES:
Relations use a controlled vocabulary to ensure consistency:
• defines, includes, requires, causes, improves
• compares_to, uses, part_of, located_in, measures
• created_by, affects, enables, prevents, produces

PROVENANCE:
All outputs include full provenance:
• sourceUrl: Original URL
• blockId: Content block where found
• headingPath: Section hierarchy
• evidence: Verbatim text supporting the extraction

INPUT:
• blocks: Content blocks from seo_crawl_page
• sourceUrl: URL for provenance

OUTPUT:
{
  entities: [{ id, name, type, confidence, mentions, provenance }],
  relations: [{ subject, predicate, object, evidence, polarity, modality }],
  stats: { sectionsProcessed, entitiesFound, relationsFound, ... }
}

WORKFLOW:
1. Call seo_crawl_page to get structured blocks
2. Call seo_extract_relations with those blocks
3. Use entities and relations to build the knowledge graph

REQUIRES:
• HuggingFace token (NUEXTRACT_HF_TOKEN or HF_TOKEN env var)
• OR local vLLM server (NUEXTRACT_VLLM_URL env var)`,
    ExtractRelationsInputSchema.shape,
    {
      title: 'Extract Relations',
      readOnlyHint: true,
      openWorldHint: true // Calls external API (HuggingFace or vLLM)
    },
    async (args: ExtractRelationsInput) => {
      try {
        const client = getNuExtractClient();
        const extractor = new RelationExtractor(client);

        // Check if NuExtract is available
        const isAvailable = await client.isAvailable();
        if (!isAvailable) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'NuExtract service is not available. ' +
                       'Please set NUEXTRACT_HF_TOKEN (or HF_TOKEN) for HuggingFace mode, ' +
                       'or start a vLLM server and set NUEXTRACT_VLLM_URL.'
              }, null, 2)
            }],
            isError: true
          };
        }

        // Convert to ContentBlock type
        const blocks: ContentBlock[] = args.blocks.map((b) => ({
          id: b.id,
          type: b.type,
          text: b.text,
          headingPath: b.headingPath,
          position: b.position,
          charStart: b.charStart,
          charEnd: b.charEnd,
          wordCount: b.wordCount,
          parentId: b.parentId
        }));

        // Perform extraction
        const result = await extractor.extractFromBlocks(blocks, args.sourceUrl);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              sourceUrl: args.sourceUrl,
              entities: result.entities,
              relations: result.relations,
              stats: result.stats
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
              error: `Relation extraction failed: ${message}`,
              sourceUrl: args.sourceUrl
            }, null, 2)
          }],
          isError: true
        };
      }
    }
  );
}

// ============================================
// SIMPLE TEXT EXTRACTION (Alternative)
// ============================================

export const ExtractRelationsFromTextInputSchema = z.object({
  text: z.string().min(50).describe(
    'Text to extract relations from. Should be at least 50 characters.'
  ),
  sourceUrl: z.string().url().optional().describe(
    'Optional source URL for provenance.'
  )
});

type ExtractRelationsFromTextInput = z.infer<typeof ExtractRelationsFromTextInputSchema>;

export function registerRelationsFromTextTool(server: McpServer): void {
  server.tool(
    'seo_extract_relations_text',
    `Extract relations from plain text (without content blocks).

Simpler alternative to seo_extract_relations when you don't have
structured blocks from seo_crawl_page.

Note: Using seo_crawl_page + seo_extract_relations is preferred
as it provides better provenance tracking.`,
    ExtractRelationsFromTextInputSchema.shape,
    {
      title: 'Extract Relations from Text',
      readOnlyHint: true,
      openWorldHint: true
    },
    async (args: ExtractRelationsFromTextInput) => {
      try {
        const client = getNuExtractClient();

        // Extract entities first
        const entityResult = await client.extractEntities(args.text);

        // Then extract relations
        const relationResult = await client.extractRelations(args.text);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              sourceUrl: args.sourceUrl || 'unknown',
              entities: entityResult.entities || [],
              relations: relationResult.relations || []
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
              error: `Extraction failed: ${message}`
            }, null, 2)
          }],
          isError: true
        };
      }
    }
  );
}
