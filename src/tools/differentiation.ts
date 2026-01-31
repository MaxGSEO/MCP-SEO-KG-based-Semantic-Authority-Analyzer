import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TextRazorClient, extractEntitiesFromTextRazor } from '../services/textrazor.js';
import { crawlUrl } from '../services/crawler.js';
import type { Entity } from '../types/index.js';
import type {
  DifferentiationResult,
  DifferentiatingEntity,
  TopicRole,
  ImpactLevel
} from '../types/addon.js';

const inputSchema = {
  keyword: z.string().min(1).describe('Target keyword'),
  serpUrls: z.array(z.string().url())
    .min(3).max(20)
    .describe('SERP URLs in rank order (position 1 first)'),
  focusPosition: z.number().int().min(1).default(1)
    .describe('Which position to analyze for uniqueness (default: 1)')
};

interface InputType {
  keyword: string;
  serpUrls: string[];
  focusPosition: number;
}

interface PageEntities {
  url: string;
  position: number;
  entities: Entity[];
  entityIds: Set<string>;
}

export function registerDifferentiationTool(server: McpServer): void {
  server.tool(
    'seo_differentiation_analysis',
    `Analyze what makes top-ranking pages unique.

For a keyword, compares entities across SERP results to identify:
- Unique entities only the focus position has
- Consensus entities (everyone has them)
- Shared entities among top 3

Helps understand what differentiates winners.`,
    inputSchema,
    async (params: InputType) => {
      const { keyword, serpUrls, focusPosition } = params;

      try {
        const client = new TextRazorClient();
        const errors: string[] = [];
        const pageAnalyses: PageEntities[] = [];

        console.error(`Analyzing ${serpUrls.length} SERP URLs for keyword: ${keyword}`);

        // Analyze all SERP URLs
        for (let i = 0; i < serpUrls.length; i++) {
          const url = serpUrls[i];
          const position = i + 1;

          try {
            const crawlResult = await crawlUrl(url);
            if (!crawlResult.success) {
              errors.push(`Failed to crawl position ${position}: ${crawlResult.error}`);
              continue;
            }

            if (crawlResult.content.length < 100) {
              errors.push(`Content too short for position ${position}`);
              continue;
            }

            const { entities } = await extractEntitiesFromTextRazor(
              client,
              crawlResult.content,
              'text',
              0.3
            );

            pageAnalyses.push({
              url,
              position,
              entities,
              entityIds: new Set(entities.map(e => e.id))
            });
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`Error analyzing position ${position}: ${msg}`);
          }
        }

        if (pageAnalyses.length < 3) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: 'Need at least 3 successfully analyzed pages',
                errors
              }, null, 2)
            }],
            isError: true
          };
        }

        // Find the focus page
        const focusPage = pageAnalyses.find(p => p.position === focusPosition);
        if (!focusPage) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: `Position ${focusPosition} was not successfully analyzed`,
                errors
              }, null, 2)
            }],
            isError: true
          };
        }

        // Build entity presence map
        const entityPresence = new Map<string, {
          entity: Entity;
          positions: number[];
        }>();

        for (const page of pageAnalyses) {
          for (const entity of page.entities) {
            const existing = entityPresence.get(entity.id);
            if (existing) {
              existing.positions.push(page.position);
              if (entity.relevance > existing.entity.relevance) {
                existing.entity = entity;
              }
            } else {
              entityPresence.set(entity.id, {
                entity,
                positions: [page.position]
              });
            }
          }
        }

        const totalPages = pageAnalyses.length;

        // Find unique entities (only focus page has them)
        const uniqueEntities: DifferentiatingEntity[] = [];
        for (const entity of focusPage.entities) {
          const presence = entityPresence.get(entity.id);
          if (presence && presence.positions.length === 1) {
            uniqueEntities.push({
              entity,
              exclusivityScore: 1,
              topicRole: determineTopicRole(entity, 1),
              potentialImpact: determineImpact(entity, 1, totalPages)
            });
          }
        }

        // Find entities shared among top 3
        const top3Positions = pageAnalyses.slice(0, 3).map(p => p.position);
        const sharedWithTop3: Entity[] = [];
        for (const [, data] of entityPresence) {
          const inTop3 = data.positions.filter(p => top3Positions.includes(p)).length;
          if (inTop3 >= 2 && data.positions.length < totalPages * 0.7) {
            sharedWithTop3.push(data.entity);
          }
        }

        // Find consensus entities (present in 70%+ of pages)
        const sharedWithAll: Entity[] = [];
        for (const [, data] of entityPresence) {
          if (data.positions.length >= totalPages * 0.7) {
            sharedWithAll.push(data.entity);
          }
        }

        // Calculate differentiation score
        const differentiationScore = Math.min(1,
          uniqueEntities.length / Math.max(1, focusPage.entities.length * 0.3)
        );

        // Generate insights
        const insights = generateInsights(
          focusPage,
          uniqueEntities,
          sharedWithTop3,
          sharedWithAll,
          totalPages
        );

        // Sort unique entities by impact
        uniqueEntities.sort((a, b) => {
          const impactOrder = { high: 3, medium: 2, low: 1 };
          return impactOrder[b.potentialImpact] - impactOrder[a.potentialImpact];
        });

        const result: DifferentiationResult = {
          focusUrl: focusPage.url,
          focusPosition,
          uniqueEntities: uniqueEntities.slice(0, 20),
          sharedWithTop3: sharedWithTop3.slice(0, 15),
          sharedWithAll: sharedWithAll.slice(0, 15),
          differentiationScore,
          insights
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              keyword,
              result,
              summary: {
                pagesAnalyzed: pageAnalyses.length,
                focusEntityCount: focusPage.entities.length,
                uniqueEntityCount: uniqueEntities.length,
                consensusEntityCount: sharedWithAll.length,
                differentiationScore: `${Math.round(differentiationScore * 100)}%`
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

function determineTopicRole(entity: Entity, exclusivityCount: number): TopicRole {
  if (exclusivityCount === 1 && entity.relevance > 0.7) {
    return 'differentiator';
  }
  if (entity.relevance > 0.5) {
    return 'core';
  }
  return 'supporting';
}

function determineImpact(
  entity: Entity,
  exclusivityCount: number,
  _totalPages: number
): ImpactLevel {
  // Unique + high relevance = high impact
  if (exclusivityCount === 1 && entity.relevance > 0.6) {
    return 'high';
  }

  // Rare + moderate relevance = medium impact
  if (exclusivityCount <= 2 && entity.relevance > 0.4) {
    return 'medium';
  }

  return 'low';
}

function generateInsights(
  focusPage: PageEntities,
  unique: DifferentiatingEntity[],
  top3: Entity[],
  consensus: Entity[],
  _totalPages: number
): string[] {
  const insights: string[] = [];

  // Unique entity analysis
  if (unique.length === 0) {
    insights.push(
      `Position ${focusPage.position} has no unique entities - content closely matches competitors.`
    );
  } else if (unique.length <= 3) {
    insights.push(
      `Position ${focusPage.position} has ${unique.length} unique entities: ` +
      `${unique.map(u => u.entity.name).join(', ')}`
    );
  } else {
    const highImpact = unique.filter(u => u.potentialImpact === 'high');
    insights.push(
      `Position ${focusPage.position} has ${unique.length} unique entities, ` +
      `${highImpact.length} with high differentiation potential.`
    );
  }

  // Top 3 shared analysis
  if (top3.length > 0) {
    insights.push(
      `Top 3 positions share these entities not found everywhere: ` +
      `${top3.slice(0, 5).map(e => e.name).join(', ')}`
    );
  }

  // Consensus analysis
  if (consensus.length > 0) {
    insights.push(
      `${consensus.length} consensus entities appear in 70%+ of results - ` +
      `these are table stakes for this keyword.`
    );
  }

  // Strategic recommendations
  if (focusPage.position === 1) {
    if (unique.length > 5) {
      insights.push(
        'The #1 result differentiates through unique entity coverage. ' +
        'To compete, consider incorporating similar unique angles.'
      );
    } else {
      insights.push(
        'The #1 result closely matches consensus entities. ' +
        'Other factors (authority, UX, freshness) may drive rankings.'
      );
    }
  }

  return insights;
}
