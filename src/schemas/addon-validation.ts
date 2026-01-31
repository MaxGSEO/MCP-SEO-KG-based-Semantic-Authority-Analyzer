import { z } from 'zod';

// ============================================================
// seo_find_entity_gaps
// ============================================================

export const FindEntityGapsInputSchema = z.object({
  yourUrl: z.string().url().describe('Your page URL to analyze'),
  competitorUrls: z.array(z.string().url())
    .min(2).max(20)
    .describe('2-20 competitor URLs to compare against'),
  minCoverage: z.number().min(0).max(1).default(0.3)
    .describe('Minimum fraction of competitors that must have entity (0-1)'),
  includeYourUniqueEntities: z.boolean().default(false)
    .describe('Also return entities only YOU have (competitive advantages)')
});

export type FindEntityGapsInput = z.infer<typeof FindEntityGapsInputSchema>;

// ============================================================
// seo_differentiation_analysis
// ============================================================

export const DifferentiationAnalysisInputSchema = z.object({
  keyword: z.string().min(1).describe('Target keyword'),
  serpUrls: z.array(z.string().url())
    .min(3).max(20)
    .describe('SERP URLs in rank order (position 1 first)'),
  focusPosition: z.number().int().min(1).default(1)
    .describe('Which position to analyze for uniqueness (default: 1)')
});

export type DifferentiationAnalysisInput = z.infer<typeof DifferentiationAnalysisInputSchema>;

// ============================================================
// seo_entity_salience_map
// ============================================================

export const SalienceWeightsSchema = z.object({
  betweenness: z.number().min(0).max(1).default(0.4),
  relevance: z.number().min(0).max(1).default(0.3),
  frequency: z.number().min(0).max(1).default(0.3)
}).refine(
  data => Math.abs(data.betweenness + data.relevance + data.frequency - 1) < 0.01,
  { message: 'Weights must sum to 1.0' }
);

export const EntitySalienceMapInputSchema = z.object({
  graph: z.any().describe('EntityGraph object from seo_build_entity_graph'),
  title: z.string().optional().describe('Title for the visualization'),
  outputPath: z.string().describe('Path to save HTML file'),
  weights: SalienceWeightsSchema.optional()
    .describe('Custom salience weights (must sum to 1.0)'),
  highlightTop: z.number().int().min(1).max(50).default(10)
    .describe('Number of top entities to highlight')
});

export type EntitySalienceMapInput = z.infer<typeof EntitySalienceMapInputSchema>;

// ============================================================
// seo_entity_velocity
// ============================================================

export const EntityVelocityInputSchema = z.object({
  url: z.string().url().describe('URL to track'),
  action: z.enum(['snapshot', 'compare', 'trend'])
    .describe('snapshot: save current state, compare: diff two snapshots, trend: analyze over time'),

  // For snapshot action - optional graph to save
  graph: z.any().optional()
    .describe('For snapshot: EntityGraph to save (if not provided, extracts fresh)'),

  // For compare action
  compareWith: z.string().optional()
    .describe("For compare: snapshot ID, 'previous', or 'oldest'"),

  // For trend action
  limit: z.number().int().min(2).max(100).default(10)
    .describe('For trend: number of snapshots to analyze')
});

export type EntityVelocityInput = z.infer<typeof EntityVelocityInputSchema>;

// ============================================================
// seo_export_graph
// ============================================================

export const ExportOptionsSchema = z.object({
  // Common options
  includeMetrics: z.boolean().default(true)
    .describe('Include centrality metrics in export'),
  includeClusters: z.boolean().default(true)
    .describe('Include community/cluster assignments'),
  includeEvidence: z.boolean().default(false)
    .describe('Include evidence spans (increases file size)'),

  // Cypher-specific
  cypherMode: z.enum(['create', 'merge']).default('create')
    .describe('create: one-time import, merge: idempotent updates'),
  neo4jLabels: z.array(z.string()).default(['Entity'])
    .describe('Node labels for Neo4j'),
  neo4jRelType: z.string().default('COOCCURS_WITH')
    .describe('Relationship type for Neo4j'),

  // HTML-specific
  title: z.string().optional()
    .describe('Title for HTML visualization'),
  darkMode: z.boolean().default(true)
    .describe('Use dark mode styling'),
  showSidePanel: z.boolean().default(true)
    .describe('Show side panel for entity details')
});

export const ExportGraphInputSchema = z.object({
  graph: z.any().describe('EntityGraph object'),
  format: z.enum(['gexf', 'graphml', 'csv', 'cypher', 'dot', 'html'])
    .describe('Export format'),
  outputPath: z.string().describe('Output file path'),
  options: ExportOptionsSchema.optional()
});

export type ExportGraphInput = z.infer<typeof ExportGraphInputSchema>;
