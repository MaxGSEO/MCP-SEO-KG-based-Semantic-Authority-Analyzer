import { z } from 'zod';

// ============================================
// ENTITY SCHEMAS
// ============================================

export const EntityTypeSchema = z.enum([
  'Person', 'Organization', 'Place', 'Product', 'Event',
  'Concept', 'Technology', 'CreativeWork', 'MedicalCondition',
  'Drug', 'Unknown'
]);

export const EntityMentionSchema = z.object({
  startPosition: z.number().int().min(0),
  endPosition: z.number().int().min(0),
  text: z.string(),
  sentenceIndex: z.number().int().min(0),
  context: z.string().optional()
});

export const EntitySchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  type: EntityTypeSchema,
  wikidataId: z.string().regex(/^Q\d+$/).optional(),
  wikipediaUrl: z.string().url().optional(),
  confidence: z.number().min(0).max(1),
  relevance: z.number().min(0).max(1),
  mentions: z.array(EntityMentionSchema),
  dbpediaTypes: z.array(z.string()).optional(),
  freebaseId: z.string().optional()
});

// ============================================
// RELATION SCHEMAS
// ============================================

export const RelationTypeSchema = z.enum([
  'IS_A', 'PART_OF', 'LOCATED_IN', 'WORKS_FOR', 'FOUNDED_BY',
  'CEO_OF', 'PRODUCES', 'COMPETES_WITH', 'RELATED_TO',
  'SIMILAR_TO', 'COMPARED_TO', 'ALTERNATIVE_TO', 'PRICED_AT',
  'FEATURE_OF', 'INTEGRATES_WITH', 'REQUIRES', 'SUPPORTS'
]);

export const EvidenceSpanSchema = z.object({
  text: z.string(),
  startPosition: z.number().int().min(0),
  endPosition: z.number().int().min(0),
  sourceUrl: z.string().url().optional()
});

export const TripleSchema = z.object({
  subject: z.string(),
  predicate: RelationTypeSchema,
  object: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceSpanSchema),
  source: z.enum(['extracted', 'inferred'])
});

// ============================================
// GRAPH SCHEMAS
// ============================================

export const GraphNodeSchema = z.object({
  id: z.string(),
  entity: EntitySchema,
  betweennessCentrality: z.number().min(0).max(1).optional(),
  degreeCentrality: z.number().min(0).max(1).optional(),
  closenessCentrality: z.number().min(0).max(1).optional(),
  eigenvectorCentrality: z.number().min(0).max(1).optional(),
  diversivity: z.number().min(0).optional(),
  cluster: z.number().int().min(0).optional(),
  clusterLabel: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  size: z.number().optional(),
  color: z.string().optional()
});

export const GraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  weight: z.number().min(0).optional(),
  type: z.enum(['cooccurrence', 'relation']).optional(),
  relationType: z.union([RelationTypeSchema, z.string()]).optional(),
  evidence: z.array(EvidenceSpanSchema).optional()
});

export const GraphMetadataSchema = z.object({
  sourceUrl: z.string().url().optional(),
  extractedAt: z.string(),
  entityCount: z.number().int().min(0),
  edgeCount: z.number().int().min(0),
  title: z.string().optional(),
  modularity: z.number().optional(),
  density: z.number().min(0).max(1).optional(),
  averageClustering: z.number().min(0).max(1).optional(),
  diameter: z.number().int().min(0).optional(),
  topicalBrokers: z.array(z.string()).optional(),
  hubConcepts: z.array(z.string()).optional(),
  structuralGaps: z.array(z.any()).optional()
});

export const EntityGraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  metadata: GraphMetadataSchema
});

// ============================================
// TOOL INPUT SCHEMAS
// ============================================

export const ExtractEntitiesInputSchema = z.object({
  source: z.string().describe('URL or text to analyze'),
  sourceType: z.enum(['url', 'text']).default('url')
    .describe('Whether source is a URL or raw text'),
  minConfidence: z.number().min(0).max(1).default(0.5)
    .describe('Minimum entity confidence threshold'),
  includeTypes: z.array(EntityTypeSchema).optional()
    .describe('Filter to specific entity types'),
  maxEntities: z.number().int().min(1).max(200).default(100)
    .describe('Maximum entities to return')
});

export const BuildEntityGraphInputSchema = z.object({
  entities: z.array(z.object({
    id: z.string(),
    name: z.string(),
    mentions: z.array(z.object({
      startPosition: z.number(),
      endPosition: z.number()
    }))
  })).describe('Entities from seo_extract_entities'),
  sourceText: z.string().describe('Original text for co-occurrence calculation'),
  windowSize: z.number().int().min(2).max(20).default(5)
    .describe('Word window for co-occurrence (default 5)'),
  minEdgeWeight: z.number().int().min(1).default(2)
    .describe('Minimum co-occurrences to create edge'),
  computeMetrics: z.boolean().default(true)
    .describe('Whether to compute centrality metrics')
});

export const AnalyzeCentralityInputSchema = z.object({
  graph: z.object({
    nodes: z.array(z.object({
      id: z.string(),
      entity: z.any()
    })),
    edges: z.array(z.object({
      source: z.string(),
      target: z.string(),
      weight: z.number()
    }))
  }).describe('Entity graph from seo_build_entity_graph'),
  topN: z.number().int().min(1).max(50).default(10)
    .describe('Number of top entities to return per metric'),
  includeDiversivity: z.boolean().default(true)
    .describe('Calculate diversivity (BC/Degree) for gateway detection')
});

export const DetectGapsInputSchema = z.object({
  graph: z.object({
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
    metadata: z.object({
      modularity: z.number().optional()
    }).optional()
  }).describe('Entity graph with computed clusters'),
  minGapDistance: z.number().min(0).max(1).default(0.3)
    .describe('Minimum inter-cluster distance to consider a gap'),
  maxGaps: z.number().int().min(1).max(20).default(5)
    .describe('Maximum gaps to return'),
  suggestBridges: z.boolean().default(true)
    .describe('Suggest entities that could bridge gaps')
});

export const CompareSerpInputSchema = z.object({
  keyword: z.string().min(1).describe('Target keyword'),
  urls: z.array(z.string().url()).min(2).max(20)
    .describe('URLs of top SERP results to analyze'),
  yourUrl: z.string().url().optional()
    .describe('Your page URL (for comparison)'),
  minEntityCoverage: z.number().min(0).max(1).default(0.5)
    .describe('Minimum coverage for consensus entities'),
  extractRelations: z.boolean().default(false)
    .describe('Also extract relations (slower)')
});

export const GenerateBriefInputSchema = z.object({
  serpAnalysis: z.any().describe('Output from seo_compare_serp'),
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
});

export const VisualizeGraphInputSchema = z.object({
  graph: z.any().describe('Entity graph from seo_build_entity_graph'),
  title: z.string().default('Entity Graph').describe('Visualization title'),
  width: z.number().int().min(400).max(2000).default(1200)
    .describe('Canvas width'),
  height: z.number().int().min(300).max(1500).default(800)
    .describe('Canvas height'),
  showLabels: z.boolean().default(true)
    .describe('Show entity name labels'),
  highlightBrokers: z.boolean().default(true)
    .describe('Highlight topical brokers'),
  outputPath: z.string().default('entity_graph.html')
    .describe('Output file path')
});

// Type exports for input schemas
export type ExtractEntitiesInput = z.infer<typeof ExtractEntitiesInputSchema>;
export type BuildEntityGraphInput = z.infer<typeof BuildEntityGraphInputSchema>;
export type AnalyzeCentralityInput = z.infer<typeof AnalyzeCentralityInputSchema>;
export type DetectGapsInput = z.infer<typeof DetectGapsInputSchema>;
export type CompareSerpInput = z.infer<typeof CompareSerpInputSchema>;
export type GenerateBriefInput = z.infer<typeof GenerateBriefInputSchema>;
export type VisualizeGraphInput = z.infer<typeof VisualizeGraphInputSchema>;
