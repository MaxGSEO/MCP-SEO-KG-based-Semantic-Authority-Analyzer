import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TextRazorClient, extractEntitiesFromTextRazor } from '../services/textrazor.js';
import { crawlUrl } from '../services/crawler.js';
import { buildCooccurrenceGraph } from '../graph/cooccurrence.js';
import { computeAllCentralities } from '../graph/centrality.js';
import type { Entity, SERPAnalysis, ConsensusEntity, DifferentiationEntity, EntityCoverageMatrix, TopicalCluster } from '../types/index.js';

interface PageAnalysis {
  url: string;
  entities: Entity[];
  entityIds: Set<string>;
  cleanedText: string;
  bcMap: Map<string, number>;
}

const inputSchema = {
  keyword: z.string().min(1).describe('Target keyword'),
  urls: z.array(z.string().url()).min(2).max(20)
    .describe('URLs of top SERP results to analyze'),
  yourUrl: z.string().url().optional()
    .describe('Your page URL (for comparison)'),
  minEntityCoverage: z.number().min(0).max(1).default(0.5)
    .describe('Minimum coverage for consensus entities'),
  extractRelations: z.boolean().default(false)
    .describe('Also extract relations (slower)')
};

interface InputType {
  keyword: string;
  urls: string[];
  yourUrl?: string;
  minEntityCoverage: number;
  extractRelations: boolean;
}

export function registerCompareTool(server: McpServer): void {
  server.tool(
    'seo_compare_serp',
    'Analyze and compare entity coverage across top SERP results for a keyword. Identifies consensus entities (what competitors all cover), differentiation opportunities (unique entities), and entity gaps.',
    inputSchema,
    async (params: InputType) => {
      const { keyword, urls, yourUrl, minEntityCoverage } = params;

      try {
        const client = new TextRazorClient();
        const pageAnalyses: PageAnalysis[] = [];
        const errors: string[] = [];

        // Analyze all URLs
        console.error(`Analyzing ${urls.length} URLs for keyword: ${keyword}`);

        for (const url of urls) {
          try {
            const crawlResult = await crawlUrl(url);
            if (!crawlResult.success) {
              errors.push(`Failed to crawl ${url}: ${crawlResult.error}`);
              continue;
            }

            if (crawlResult.content.length < 100) {
              errors.push(`Content too short for ${url}`);
              continue;
            }

            const { entities, cleanedText } = await extractEntitiesFromTextRazor(
              client,
              crawlResult.content,
              'text',
              0.3 // Lower threshold for comparison
            );

            const graph = buildCooccurrenceGraph(entities, cleanedText, { minWeight: 1 });
            const centralities = computeAllCentralities(graph);

            pageAnalyses.push({
              url,
              entities,
              entityIds: new Set(entities.map(e => e.id)),
              cleanedText,
              bcMap: centralities.betweenness
            });
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`Error analyzing ${url}: ${msg}`);
          }
        }

        // Analyze your URL if provided
        let yourAnalysis: PageAnalysis | null = null;
        if (yourUrl) {
          try {
            const crawlResult = await crawlUrl(yourUrl);
            if (crawlResult.success && crawlResult.content.length >= 100) {
              const { entities, cleanedText } = await extractEntitiesFromTextRazor(
                client,
                crawlResult.content,
                'text',
                0.3
              );
              const graph = buildCooccurrenceGraph(entities, cleanedText, { minWeight: 1 });
              const centralities = computeAllCentralities(graph);
              yourAnalysis = {
                url: yourUrl,
                entities,
                entityIds: new Set(entities.map(e => e.id)),
                cleanedText,
                bcMap: centralities.betweenness
              };
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`Error analyzing your URL: ${msg}`);
          }
        }

        if (pageAnalyses.length < 2) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: 'Need at least 2 successfully analyzed pages for comparison',
                errors
              }, null, 2)
            }],
            isError: true
          };
        }

        // Build entity frequency map across all pages
        const entityFrequency = new Map<string, { entity: Entity; count: number; urls: string[]; totalBC: number }>();

        for (const page of pageAnalyses) {
          for (const entity of page.entities) {
            const existing = entityFrequency.get(entity.id);
            const bc = page.bcMap.get(entity.id) || 0;

            if (existing) {
              existing.count++;
              existing.urls.push(page.url);
              existing.totalBC += bc;
              // Keep highest relevance entity
              if (entity.relevance > existing.entity.relevance) {
                existing.entity = entity;
              }
            } else {
              entityFrequency.set(entity.id, {
                entity,
                count: 1,
                urls: [page.url],
                totalBC: bc
              });
            }
          }
        }

        // Identify consensus entities
        const totalPages = pageAnalyses.length;
        const consensusEntities: ConsensusEntity[] = [];
        const differentiationEntities: DifferentiationEntity[] = [];

        for (const [, data] of entityFrequency) {
          const coverage = data.count / totalPages;
          const avgBC = data.totalBC / data.count;

          if (coverage >= minEntityCoverage) {
            consensusEntities.push({
              entity: data.entity,
              coverage,
              averageProminence: avgBC,
              required: coverage >= 0.7
            });
          } else if (data.count === 1) {
            // Unique to one page
            differentiationEntities.push({
              entity: data.entity,
              foundIn: data.urls,
              uniqueTo: data.urls[0],
              competitiveAdvantage: `Only found in one competitor - potential differentiation opportunity`
            });
          } else if (coverage < 0.3) {
            // Rare entities
            differentiationEntities.push({
              entity: data.entity,
              foundIn: data.urls,
              competitiveAdvantage: `Found in only ${data.count} of ${totalPages} competitors`
            });
          }
        }

        // Sort by coverage/prominence
        consensusEntities.sort((a, b) => b.coverage - a.coverage || b.averageProminence - a.averageProminence);
        differentiationEntities.sort((a, b) => a.foundIn.length - b.foundIn.length);

        // Build coverage matrix
        const allEntityIds = Array.from(entityFrequency.keys()).slice(0, 50);
        const coverageMatrix: EntityCoverageMatrix = {
          entities: allEntityIds,
          pages: pageAnalyses.map(p => p.url),
          coverage: allEntityIds.map(entityId =>
            pageAnalyses.map(page => page.entityIds.has(entityId))
          ),
          prominence: allEntityIds.map(entityId =>
            pageAnalyses.map(page => page.bcMap.get(entityId) || 0)
          )
        };

        // Calculate your gaps if yourUrl was provided
        let yourGaps: string[] = [];
        let yourUnique: string[] = [];

        if (yourAnalysis) {
          const requiredEntities = consensusEntities.filter(e => e.required);
          yourGaps = requiredEntities
            .filter(e => !yourAnalysis!.entityIds.has(e.entity.id))
            .map(e => e.entity.name);

          yourUnique = yourAnalysis.entities
            .filter(e => !entityFrequency.has(e.id) || entityFrequency.get(e.id)!.count === 1)
            .map(e => e.name)
            .slice(0, 10);
        }

        // Infer search intent
        const searchIntent = inferSearchIntent(keyword, consensusEntities);

        // Build topical clusters (simplified)
        const topicalClusters: TopicalCluster[] = [
          {
            id: 0,
            label: 'Core Topic',
            coreEntities: consensusEntities.slice(0, 5).map(e => e.entity.name),
            coverage: 1,
            importance: 1
          }
        ];

        // Calculate average entity count
        const avgEntityCount = pageAnalyses.reduce((sum, p) => sum + p.entities.length, 0) / pageAnalyses.length;

        const analysis: SERPAnalysis = {
          keyword,
          searchIntent,
          analyzedUrls: pageAnalyses.map(p => p.url),
          consensusEntities: consensusEntities.slice(0, 30),
          differentiationEntities: differentiationEntities.slice(0, 20),
          entityCoverageMatrix: coverageMatrix,
          topicalClusters,
          averageEntityCount: avgEntityCount,
          entityDiversity: entityFrequency.size / avgEntityCount
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              keyword,
              analysis,
              yourAnalysis: yourAnalysis ? {
                entityCount: yourAnalysis.entities.length,
                missingRequired: yourGaps,
                uniqueEntities: yourUnique,
                coverageScore: yourGaps.length === 0 ? 100 :
                  Math.round((1 - yourGaps.length / consensusEntities.filter(e => e.required).length) * 100)
              } : null,
              summary: {
                pagesAnalyzed: pageAnalyses.length,
                consensusEntitiesFound: consensusEntities.length,
                requiredEntities: consensusEntities.filter(e => e.required).length,
                differentiationOpportunities: differentiationEntities.length,
                averageEntityCount: Math.round(avgEntityCount)
              },
              errors: errors.length > 0 ? errors : undefined
            }, null, 2)
          }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: message
            }, null, 2)
          }],
          isError: true
        };
      }
    }
  );
}

function inferSearchIntent(
  keyword: string,
  consensusEntities: ConsensusEntity[]
): 'informational' | 'commercial' | 'transactional' | 'navigational' {
  const lowerKeyword = keyword.toLowerCase();

  // Transactional indicators
  if (/buy|price|cheap|deal|discount|order|purchase|shop/.test(lowerKeyword)) {
    return 'transactional';
  }

  // Commercial investigation indicators
  if (/best|top|review|compare|vs|versus|alternative/.test(lowerKeyword)) {
    return 'commercial';
  }

  // Navigational indicators
  if (/login|sign in|official|website/.test(lowerKeyword)) {
    return 'navigational';
  }

  // Check entity types for hints
  const productCount = consensusEntities.filter(e => e.entity.type === 'Product').length;
  const conceptCount = consensusEntities.filter(e => e.entity.type === 'Concept').length;

  if (productCount > conceptCount * 2) {
    return 'commercial';
  }

  // Default to informational
  return 'informational';
}
