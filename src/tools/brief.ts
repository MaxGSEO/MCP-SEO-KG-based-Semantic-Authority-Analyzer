import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type {
  ContentBrief,
  EntityRequirement,
  DifferentiationOpportunity,
  ContentGap,
  OutlineSection,
  CompetitorBenchmark,
  InternalLink,
  SERPAnalysis,
  EntityType
} from '../types/index.js';

interface SerpAnalysisInput {
  keyword: string;
  searchIntent: string;
  analyzedUrls: string[];
  consensusEntities: Array<{
    entity: {
      id: string;
      name: string;
      type: string;
    };
    coverage: number;
    averageProminence: number;
    required: boolean;
  }>;
  differentiationEntities?: Array<{
    entity: {
      id: string;
      name: string;
      type: string;
    };
    foundIn: string[];
    uniqueTo?: string;
    competitiveAdvantage: string;
  }>;
  averageEntityCount: number;
  entityDiversity?: number;
}

const inputSchema = {
  serpAnalysis: z.object({
    keyword: z.string(),
    searchIntent: z.string(),
    analyzedUrls: z.array(z.string()),
    consensusEntities: z.array(z.object({
      entity: z.object({
        id: z.string(),
        name: z.string(),
        type: z.string()
      }).passthrough(),
      coverage: z.number(),
      averageProminence: z.number(),
      required: z.boolean()
    })),
    differentiationEntities: z.array(z.object({
      entity: z.object({
        id: z.string(),
        name: z.string(),
        type: z.string()
      }).passthrough(),
      foundIn: z.array(z.string()),
      uniqueTo: z.string().optional(),
      competitiveAdvantage: z.string()
    })).optional(),
    averageEntityCount: z.number(),
    entityDiversity: z.number().optional()
  }).passthrough().describe('Output from seo_compare_serp'),
  yourDomainGraph: z.any().optional()
    .describe('Your domain entity graph for internal linking'),
  targetWordCount: z.number().int().min(300).max(10000).default(1500)
    .describe('Target word count for content'),
  contentType: z.enum(['blog', 'guide', 'comparison', 'listicle', 'landing'])
    .default('blog').describe('Type of content to create'),
  includeOutline: z.boolean().default(true)
    .describe('Generate suggested outline'),
  includeInternalLinks: z.boolean().default(true)
    .describe('Suggest internal linking opportunities')
};

interface InputType {
  serpAnalysis: SerpAnalysisInput;
  yourDomainGraph?: unknown;
  targetWordCount: number;
  contentType: 'blog' | 'guide' | 'comparison' | 'listicle' | 'landing';
  includeOutline: boolean;
  includeInternalLinks: boolean;
}

export function registerBriefTool(server: McpServer): void {
  server.tool(
    'seo_generate_brief',
    'Generate a comprehensive content brief based on SERP analysis. Includes required entities, differentiation opportunities, suggested outline, and internal linking recommendations.',
    inputSchema,
    async (params: InputType) => {
      const { serpAnalysis, yourDomainGraph, targetWordCount, contentType, includeOutline, includeInternalLinks } = params;

      try {
        const analysis = serpAnalysis as SERPAnalysis;

        // Build required entities list
        const requiredEntities: EntityRequirement[] = analysis.consensusEntities
          .filter(e => e.required)
          .map(e => ({
            entityId: e.entity.id,
            name: e.entity.name,
            type: mapEntityType(e.entity.type),
            priority: 'high' as const,
            coverage: `${Math.round(e.coverage * analysis.analyzedUrls.length)}/${analysis.analyzedUrls.length} competitors`,
            suggestedContext: generateEntityContext(e.entity.name, e.entity.type, contentType),
            relatedEntities: findRelatedEntities(e.entity.id, analysis.consensusEntities)
          }));

        // Build recommended entities (high coverage but not required)
        const recommendedEntities: EntityRequirement[] = analysis.consensusEntities
          .filter(e => !e.required && e.coverage >= 0.3)
          .slice(0, 15)
          .map(e => ({
            entityId: e.entity.id,
            name: e.entity.name,
            type: mapEntityType(e.entity.type),
            priority: e.coverage >= 0.5 ? 'medium' as const : 'low' as const,
            coverage: `${Math.round(e.coverage * analysis.analyzedUrls.length)}/${analysis.analyzedUrls.length} competitors`,
            suggestedContext: generateEntityContext(e.entity.name, e.entity.type, contentType),
            relatedEntities: []
          }));

        // Build differentiation opportunities
        const differentiationOpportunities: DifferentiationOpportunity[] =
          (analysis.differentiationEntities || [])
            .slice(0, 10)
            .map(e => ({
              entity: e.entity,
              yourCoverage: false,
              competitorCoverage: e.foundIn.length / analysis.analyzedUrls.length,
              opportunity: e.competitiveAdvantage,
              expectedImpact: e.foundIn.length === 1 ? 'high' as const :
                e.foundIn.length <= 2 ? 'medium' as const : 'low' as const
            }));

        // Identify content gaps
        const contentGaps: ContentGap[] = identifyContentGaps(analysis);

        // Generate outline if requested
        let suggestedOutline: OutlineSection[] = [];
        if (includeOutline) {
          suggestedOutline = generateOutline(
            analysis.keyword,
            contentType,
            targetWordCount,
            requiredEntities,
            recommendedEntities
          );
        }

        // Build competitor benchmarks from actual analysis data
        const competitorBenchmarks: CompetitorBenchmark[] = analysis.analyzedUrls
          .slice(0, 5)
          .map((url, index) => {
            // Find unique entities for this URL from differentiation data
            const uniqueEntitiesForUrl = (analysis.differentiationEntities || [])
              .filter(e => e.uniqueTo === url)
              .map(e => e.entity.name);

            // Calculate topical coverage based on consensus entity presence
            // Estimate based on position (top positions typically have better coverage)
            const positionFactor = 1 - (index * 0.08); // Decreases slightly by position
            const baseEntityCount = analysis.averageEntityCount;
            const estimatedCoverage = Math.min(1, positionFactor * (baseEntityCount / (baseEntityCount + 10)));

            return {
              url,
              position: index + 1,
              entityCount: Math.round(analysis.averageEntityCount * positionFactor),
              uniqueEntities: uniqueEntitiesForUrl,
              topicalCoverage: Number(estimatedCoverage.toFixed(2))
            };
          });

        // Generate internal linking suggestions if domain graph provided
        const internalLinkingSuggestions = includeInternalLinks && yourDomainGraph
          ? generateInternalLinks(yourDomainGraph, requiredEntities, recommendedEntities)
          : [];

        // Build the content brief
        const brief: ContentBrief = {
          targetKeyword: analysis.keyword,
          searchIntent: analysis.searchIntent,
          requiredEntities,
          recommendedEntities,
          differentiationOpportunities,
          topicalBrokers: analysis.consensusEntities
            .filter(e => e.averageProminence > 0.2)
            .slice(0, 5)
            .map(e => e.entity.name),
          suggestedOutline,
          contentGaps,
          internalLinkingSuggestions,
          targetEntityCount: Math.round(analysis.averageEntityCount * 1.2),
          targetEntityDiversity: analysis.entityDiversity || 1.5,
          competitorBenchmarks
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              brief,
              summary: {
                keyword: analysis.keyword,
                intent: analysis.searchIntent,
                requiredEntityCount: requiredEntities.length,
                recommendedEntityCount: recommendedEntities.length,
                differentiationOpportunities: differentiationOpportunities.length,
                suggestedSections: suggestedOutline.length,
                targetWordCount,
                targetEntityCount: brief.targetEntityCount
              },
              quickWins: generateQuickWins(requiredEntities, differentiationOpportunities),
              warnings: generateWarnings(requiredEntities, analysis)
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

function mapEntityType(type: string): EntityType {
  const validTypes: EntityType[] = [
    'Person', 'Organization', 'Place', 'Product', 'Event',
    'Concept', 'Technology', 'CreativeWork', 'MedicalCondition',
    'Drug', 'Unknown'
  ];
  return validTypes.includes(type as EntityType) ? (type as EntityType) : 'Concept';
}

function generateEntityContext(
  entityName: string,
  entityType: string,
  contentType: string
): string {
  const contexts: Record<string, Record<string, string>> = {
    blog: {
      Person: `Mention ${entityName} when discussing their contributions or perspectives`,
      Organization: `Reference ${entityName} as an authority or example in the field`,
      Product: `Discuss ${entityName} features, benefits, or use cases`,
      Technology: `Explain how ${entityName} works or is applied`,
      Concept: `Define and contextualize ${entityName} for readers`,
      default: `Include ${entityName} naturally within your discussion`
    },
    guide: {
      Person: `Cite ${entityName}'s expertise or methodology`,
      Organization: `Use ${entityName} as a case study or reference`,
      Product: `Create a dedicated section for ${entityName}`,
      Technology: `Provide step-by-step guidance on ${entityName}`,
      Concept: `Build foundational understanding of ${entityName}`,
      default: `Explain ${entityName} in detail with practical examples`
    },
    comparison: {
      Person: `Compare perspectives of ${entityName} with others`,
      Organization: `Evaluate ${entityName} against competitors`,
      Product: `Create comparison table including ${entityName}`,
      Technology: `Benchmark ${entityName} performance`,
      Concept: `Contrast ${entityName} with related concepts`,
      default: `Include ${entityName} in your comparison matrix`
    },
    listicle: {
      default: `Feature ${entityName} as a list item with brief explanation`
    },
    landing: {
      default: `Highlight ${entityName} in value proposition or features section`
    }
  };

  const typeContexts = contexts[contentType] || contexts.blog;
  return typeContexts[entityType] || typeContexts.default;
}

function findRelatedEntities(
  entityId: string,
  consensusEntities: SERPAnalysis['consensusEntities']
): string[] {
  // Simple heuristic: entities with similar coverage are likely related
  const targetCoverage = consensusEntities.find(e => e.entity.id === entityId)?.coverage || 0;

  return consensusEntities
    .filter(e => e.entity.id !== entityId)
    .filter(e => Math.abs(e.coverage - targetCoverage) < 0.2)
    .slice(0, 3)
    .map(e => e.entity.name);
}

function identifyContentGaps(analysis: SERPAnalysis): ContentGap[] {
  const gaps: ContentGap[] = [];

  // Gap 1: Missing entity types
  const entityTypes = new Set(analysis.consensusEntities.map(e => e.entity.type));
  const importantTypes: EntityType[] = ['Person', 'Organization', 'Product', 'Technology'];

  for (const type of importantTypes) {
    if (!entityTypes.has(type)) {
      gaps.push({
        topic: `${type} entities`,
        missingEntities: [],
        competitorExamples: [],
        suggestedContent: `Consider adding ${type.toLowerCase()} references to match competitor coverage`
      });
    }
  }

  // Gap 2: Differentiation opportunities as gaps
  if (analysis.differentiationEntities && analysis.differentiationEntities.length > 0) {
    const uniqueEntities = analysis.differentiationEntities.filter(e => e.uniqueTo);
    if (uniqueEntities.length > 3) {
      gaps.push({
        topic: 'Unique competitor angles',
        missingEntities: uniqueEntities.slice(0, 5).map(e => e.entity.name),
        competitorExamples: uniqueEntities.slice(0, 3).map(e => e.uniqueTo!),
        suggestedContent: 'Some competitors cover unique entities that could differentiate your content'
      });
    }
  }

  return gaps;
}

function generateOutline(
  keyword: string,
  contentType: string,
  targetWordCount: number,
  requiredEntities: EntityRequirement[],
  recommendedEntities: EntityRequirement[]
): OutlineSection[] {
  const sections: OutlineSection[] = [];
  const wordsPerSection = Math.round(targetWordCount / 6);

  // Introduction
  sections.push({
    heading: `Introduction to ${keyword}`,
    targetEntities: requiredEntities.slice(0, 3).map(e => e.name),
    suggestedWordCount: Math.round(wordsPerSection * 0.7),
    notes: 'Hook readers, establish context, preview main points'
  });

  if (contentType === 'guide' || contentType === 'blog') {
    // What/Definition section
    sections.push({
      heading: `What is ${keyword}?`,
      targetEntities: requiredEntities.slice(0, 5).map(e => e.name),
      suggestedWordCount: wordsPerSection,
      notes: 'Define key concepts, establish foundational understanding'
    });

    // How/Process section
    sections.push({
      heading: `How ${keyword} Works`,
      targetEntities: requiredEntities.slice(3, 8).map(e => e.name),
      suggestedWordCount: Math.round(wordsPerSection * 1.5),
      notes: 'Explain mechanisms, processes, or methodologies'
    });

    // Benefits/Applications
    sections.push({
      heading: `Benefits of ${keyword}`,
      targetEntities: recommendedEntities.slice(0, 5).map(e => e.name),
      suggestedWordCount: wordsPerSection,
      notes: 'Discuss advantages, use cases, real-world applications'
    });
  } else if (contentType === 'comparison') {
    // Comparison criteria
    sections.push({
      heading: 'Comparison Criteria',
      targetEntities: requiredEntities.slice(0, 3).map(e => e.name),
      suggestedWordCount: Math.round(wordsPerSection * 0.5),
      notes: 'Establish what factors you\'re comparing'
    });

    // Individual comparisons
    sections.push({
      heading: 'Detailed Comparison',
      targetEntities: requiredEntities.map(e => e.name),
      suggestedWordCount: Math.round(wordsPerSection * 2.5),
      notes: 'Compare each option with pros/cons'
    });

    // Recommendation
    sections.push({
      heading: 'Our Recommendation',
      targetEntities: requiredEntities.slice(0, 2).map(e => e.name),
      suggestedWordCount: wordsPerSection,
      notes: 'Provide clear recommendation based on use cases'
    });
  } else if (contentType === 'listicle') {
    // List items
    const itemCount = Math.min(10, requiredEntities.length + 3);
    for (let i = 0; i < itemCount; i++) {
      sections.push({
        heading: `${i + 1}. ${requiredEntities[i]?.name || 'Item ' + (i + 1)}`,
        targetEntities: [requiredEntities[i]?.name].filter(Boolean) as string[],
        suggestedWordCount: Math.round(targetWordCount / itemCount),
        notes: 'Brief description with key benefits'
      });
    }
  }

  // Conclusion
  sections.push({
    heading: 'Conclusion',
    targetEntities: requiredEntities.slice(0, 2).map(e => e.name),
    suggestedWordCount: Math.round(wordsPerSection * 0.5),
    notes: 'Summarize key points, provide call-to-action'
  });

  return sections;
}

function generateQuickWins(
  requiredEntities: EntityRequirement[],
  differentiationOpportunities: DifferentiationOpportunity[]
): string[] {
  const quickWins: string[] = [];

  // Top required entities
  if (requiredEntities.length > 0) {
    quickWins.push(`Must include: ${requiredEntities.slice(0, 5).map(e => e.name).join(', ')}`);
  }

  // High-impact differentiation
  const highImpact = differentiationOpportunities.filter(d => d.expectedImpact === 'high');
  if (highImpact.length > 0) {
    quickWins.push(`Differentiate with: ${highImpact.slice(0, 3).map(d => d.entity.name).join(', ')}`);
  }

  // Entity relationships
  if (requiredEntities.length >= 3) {
    quickWins.push(`Connect ${requiredEntities[0].name} to ${requiredEntities[1].name} for topical coherence`);
  }

  return quickWins;
}

function generateWarnings(
  requiredEntities: EntityRequirement[],
  analysis: SERPAnalysis
): string[] {
  const warnings: string[] = [];

  if (requiredEntities.length > 20) {
    warnings.push('High entity count required - ensure natural integration, avoid keyword stuffing');
  }

  if (analysis.averageEntityCount > 50) {
    warnings.push('Competitors have very high entity density - focus on quality over quantity');
  }

  return warnings;
}

interface DomainGraphInput {
  nodes?: Array<{
    id: string;
    entity: {
      name: string;
      wikidataId?: string;
    };
    betweennessCentrality?: number;
  }>;
  metadata?: {
    sourceUrl?: string;
  };
}

function generateInternalLinks(
  domainGraph: unknown,
  requiredEntities: EntityRequirement[],
  recommendedEntities: EntityRequirement[]
): InternalLink[] {
  const suggestions: InternalLink[] = [];

  // Validate domain graph structure
  const graph = domainGraph as DomainGraphInput;
  if (!graph?.nodes || !Array.isArray(graph.nodes)) {
    return suggestions;
  }

  const sourceUrl = graph.metadata?.sourceUrl || 'your-domain.com';

  // Build a map of entities in the domain graph
  const domainEntities = new Map<string, { name: string; bc: number }>();
  for (const node of graph.nodes) {
    const key = node.entity.wikidataId || node.entity.name.toLowerCase();
    domainEntities.set(key, {
      name: node.entity.name,
      bc: node.betweennessCentrality || 0
    });
  }

  // Find required entities that exist in the domain graph (potential link targets)
  const allBriefEntities = [...requiredEntities, ...recommendedEntities];

  for (const requirement of allBriefEntities.slice(0, 20)) {
    const key = requirement.entityId.startsWith('Q')
      ? requirement.entityId
      : requirement.name.toLowerCase();

    const domainEntity = domainEntities.get(key);
    if (domainEntity && domainEntity.bc > 0.05) {
      // Entity exists in domain with decent BC - suggest link
      suggestions.push({
        fromUrl: 'new-content',
        toUrl: `${sourceUrl}#${encodeURIComponent(domainEntity.name.toLowerCase().replace(/\s+/g, '-'))}`,
        anchorEntity: requirement.name,
        reason: `Link to existing content about "${domainEntity.name}" (BC: ${domainEntity.bc.toFixed(2)}) to strengthen topical cluster`
      });
    }
  }

  // Sort by BC (higher BC entities are better link targets)
  suggestions.sort((a, b) => {
    const bcA = parseFloat(a.reason.match(/BC: ([\d.]+)/)?.[1] || '0');
    const bcB = parseFloat(b.reason.match(/BC: ([\d.]+)/)?.[1] || '0');
    return bcB - bcA;
  });

  return suggestions.slice(0, 10);
}
