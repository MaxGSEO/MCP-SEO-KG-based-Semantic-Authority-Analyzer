import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TextRazorClient, extractEntitiesFromTextRazor } from '../services/textrazor.js';
import { crawlUrl } from '../services/crawler.js';
import type { Entity } from '../types/index.js';
import type {
  GapAnalysisResult,
  MissingEntity,
  UniqueEntity,
  EntityPriority,
  CoverageMatrix
} from '../types/addon.js';

const inputSchema = {
  yourUrl: z.string().url().describe('Your page URL to analyze'),
  competitorUrls: z.array(z.string().url())
    .min(2).max(20)
    .describe('2-20 competitor URLs to compare against'),
  minCoverage: z.number().min(0).max(1).default(0.3)
    .describe('Minimum fraction of competitors that must have entity (0-1)'),
  includeYourUniqueEntities: z.boolean().default(false)
    .describe('Also return entities only YOU have (competitive advantages)')
};

interface InputType {
  yourUrl: string;
  competitorUrls: string[];
  minCoverage: number;
  includeYourUniqueEntities: boolean;
}

interface PageEntities {
  url: string;
  entities: Entity[];
  entityIds: Set<string>;
}

export function registerEntityGapsTool(server: McpServer): void {
  server.tool(
    'seo_find_entity_gaps',
    `Compare your page against competitors to find missing entities.

Returns entities that competitors have but you don't, ranked by:
- Coverage score (what fraction of competitors have it)
- Priority (critical/high/medium/low)
- Suggested context for incorporation

Optionally shows your unique entities (competitive advantages).`,
    inputSchema,
    async (params: InputType) => {
      const { yourUrl, competitorUrls, minCoverage, includeYourUniqueEntities } = params;

      try {
        const client = new TextRazorClient();
        const errors: string[] = [];

        // Analyze your URL
        console.error(`Analyzing your URL: ${yourUrl}`);
        let yourAnalysis: PageEntities | null = null;

        try {
          const crawlResult = await crawlUrl(yourUrl);
          if (crawlResult.success && crawlResult.content.length >= 100) {
            const { entities } = await extractEntitiesFromTextRazor(
              client,
              crawlResult.content,
              'text',
              0.3
            );
            yourAnalysis = {
              url: yourUrl,
              entities,
              entityIds: new Set(entities.map(e => e.id))
            };
          } else {
            throw new Error(crawlResult.error || 'Content too short');
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: `Failed to analyze your URL: ${msg}`
              }, null, 2)
            }],
            isError: true
          };
        }

        // Analyze competitor URLs
        const competitorAnalyses: PageEntities[] = [];
        console.error(`Analyzing ${competitorUrls.length} competitor URLs...`);

        for (const url of competitorUrls) {
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

            const { entities } = await extractEntitiesFromTextRazor(
              client,
              crawlResult.content,
              'text',
              0.3
            );

            competitorAnalyses.push({
              url,
              entities,
              entityIds: new Set(entities.map(e => e.id))
            });
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`Error analyzing ${url}: ${msg}`);
          }
        }

        if (competitorAnalyses.length < 2) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: 'Need at least 2 successfully analyzed competitor pages',
                errors
              }, null, 2)
            }],
            isError: true
          };
        }

        // Build entity frequency map across competitors
        const entityFrequency = new Map<string, {
          entity: Entity;
          count: number;
          urls: string[];
        }>();

        for (const analysis of competitorAnalyses) {
          for (const entity of analysis.entities) {
            const existing = entityFrequency.get(entity.id);
            if (existing) {
              existing.count++;
              existing.urls.push(analysis.url);
              // Keep highest relevance
              if (entity.relevance > existing.entity.relevance) {
                existing.entity = entity;
              }
            } else {
              entityFrequency.set(entity.id, {
                entity,
                count: 1,
                urls: [analysis.url]
              });
            }
          }
        }

        // Find missing entities (in competitors but not yours)
        const totalCompetitors = competitorAnalyses.length;
        const missingEntities: MissingEntity[] = [];

        for (const [entityId, data] of entityFrequency) {
          const coverage = data.count / totalCompetitors;

          if (coverage >= minCoverage && !yourAnalysis.entityIds.has(entityId)) {
            const priority = determinePriority(coverage);
            missingEntities.push({
              entity: data.entity,
              coverageScore: coverage,
              competitorCount: data.count,
              competitors: data.urls,
              priority,
              suggestedContext: generateContext(data.entity, priority)
            });
          }
        }

        // Sort by coverage score
        missingEntities.sort((a, b) => b.coverageScore - a.coverageScore);

        // Find your unique entities if requested
        let yourUniqueEntities: UniqueEntity[] | undefined;
        if (includeYourUniqueEntities) {
          yourUniqueEntities = [];
          for (const entity of yourAnalysis.entities) {
            const competitorData = entityFrequency.get(entity.id);
            if (!competitorData || competitorData.count === 0) {
              yourUniqueEntities.push({
                entity,
                uniquenessScore: 1,
                competitiveAdvantage: 'Only your page covers this entity'
              });
            } else if (competitorData.count / totalCompetitors < 0.3) {
              yourUniqueEntities.push({
                entity,
                uniquenessScore: 1 - (competitorData.count / totalCompetitors),
                competitiveAdvantage: `Only ${competitorData.count} of ${totalCompetitors} competitors cover this`
              });
            }
          }
          yourUniqueEntities.sort((a, b) => b.uniquenessScore - a.uniquenessScore);
        }

        // Build coverage matrix
        const allEntityIds = Array.from(entityFrequency.keys()).slice(0, 50);
        const allUrls = [yourUrl, ...competitorAnalyses.map(a => a.url)];
        const allAnalyses = [yourAnalysis, ...competitorAnalyses];

        const coverageMatrix: CoverageMatrix = {
          entities: allEntityIds.map(id => entityFrequency.get(id)?.entity.name || id),
          urls: allUrls,
          matrix: allEntityIds.map(entityId =>
            allAnalyses.map(analysis => analysis.entityIds.has(entityId))
          )
        };

        // Calculate overall gap score
        const requiredEntities = missingEntities.filter(e => e.coverageScore >= 0.7);
        const overallGapScore = requiredEntities.length === 0 ? 1 :
          Math.max(0, 1 - (requiredEntities.length / 20));

        // Generate recommendations
        const recommendations = generateRecommendations(missingEntities, yourUniqueEntities);

        const result: GapAnalysisResult = {
          yourUrl,
          competitorUrls: competitorAnalyses.map(a => a.url),
          missingEntities: missingEntities.slice(0, 30),
          yourUniqueEntities: yourUniqueEntities?.slice(0, 15),
          coverageMatrix,
          overallGapScore,
          recommendations
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              result,
              summary: {
                yourEntityCount: yourAnalysis.entities.length,
                competitorsAnalyzed: competitorAnalyses.length,
                missingCount: missingEntities.length,
                criticalMissing: missingEntities.filter(e => e.priority === 'critical').length,
                uniqueCount: yourUniqueEntities?.length || 0,
                gapScore: `${Math.round(overallGapScore * 100)}%`
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

function determinePriority(coverage: number): EntityPriority {
  if (coverage >= 0.9) return 'critical';
  if (coverage >= 0.7) return 'high';
  if (coverage >= 0.5) return 'medium';
  return 'low';
}

function generateContext(entity: Entity, priority: EntityPriority): string {
  const urgency = priority === 'critical' ? 'Must' :
    priority === 'high' ? 'Should' : 'Consider';

  const typeContexts: Record<string, string> = {
    Person: `${urgency} mention ${entity.name}'s expertise, contributions, or perspectives`,
    Organization: `${urgency} reference ${entity.name} as an authority or example`,
    Product: `${urgency} discuss ${entity.name}'s features, benefits, or use cases`,
    Technology: `${urgency} explain how ${entity.name} works or is applied`,
    Concept: `${urgency} define and contextualize ${entity.name}`,
    Place: `${urgency} incorporate ${entity.name} geographically or contextually`,
    Event: `${urgency} reference ${entity.name} and its significance`,
    CreativeWork: `${urgency} cite or reference ${entity.name}`
  };

  return typeContexts[entity.type] || `${urgency} include ${entity.name} in your content`;
}

function generateRecommendations(
  missing: MissingEntity[],
  unique?: UniqueEntity[]
): string[] {
  const recommendations: string[] = [];

  const critical = missing.filter(e => e.priority === 'critical');
  if (critical.length > 0) {
    recommendations.push(
      `Critical gaps: ${critical.slice(0, 5).map(e => e.entity.name).join(', ')}`
    );
  }

  const high = missing.filter(e => e.priority === 'high');
  if (high.length > 0) {
    recommendations.push(
      `High-priority additions: ${high.slice(0, 5).map(e => e.entity.name).join(', ')}`
    );
  }

  if (missing.length > 10) {
    recommendations.push(
      `You're missing ${missing.length} entities that competitors cover. ` +
      `Focus on the critical and high priority ones first.`
    );
  }

  if (unique && unique.length > 0) {
    recommendations.push(
      `Competitive advantage: You uniquely cover ${unique.slice(0, 3).map(e => e.entity.name).join(', ')}`
    );
  }

  if (missing.length === 0) {
    recommendations.push(
      'Great coverage! Your page includes all commonly-used competitor entities.'
    );
  }

  return recommendations;
}
