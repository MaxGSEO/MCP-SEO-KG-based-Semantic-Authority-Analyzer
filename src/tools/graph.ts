import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildCooccurrenceGraph } from '../graph/cooccurrence.js';
import { computeAllCentralities } from '../graph/centrality.js';
import { detectCommunities, modularity, averageClusteringCoefficient } from '../graph/communities.js';
import { detectStructuralGaps } from '../graph/gaps.js';
import { createGraph, addEdge, getNodeCount, getEdgeCount, getGraphDensity } from '../graph/types.js';
import { StructuredProximityBuilder, DEFAULT_WEIGHTS, type ProximityWeights } from '../graph/structured-proximity.js';
import { PMICalculator, extractCooccurrenceWindows, type WindowType, getPMISettingsFromEnv } from '../graph/pmi-weighting.js';
import type { ContentBlock } from '../services/crawl4ai-client.js';
import type { Entity, EntityGraph, GraphNode, GraphEdge, GraphMetadata, ExtractionResult } from '../types/index.js';

interface EntityInput {
  id: string;
  name: string;
  type?: string;
  confidence?: number;
  relevance?: number;
  mentions: Array<{
    startPosition: number;
    endPosition: number;
    text?: string;
    sentenceIndex?: number;
    context?: string;
  }>;
}

const inputSchema = {
  entities: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.string().optional(),
    confidence: z.number().optional(),
    relevance: z.number().optional(),
    mentions: z.array(z.object({
      startPosition: z.number(),
      endPosition: z.number(),
      text: z.string().optional(),
      sentenceIndex: z.number().optional(),
      context: z.string().optional()
    }))
  })).optional().describe('Entities from seo_extract_entities'),
  sourceText: z.string().optional().describe('Original text for co-occurrence calculation'),
  extractionResult: z.any().optional()
    .describe('Full output from seo_extract_entities (preferred). Overrides entities/sourceText/blocks if provided.'),
  windowSize: z.number().int().min(2).max(20).default(5)
    .describe('Word window for co-occurrence (default 5)'),
  minEdgeWeight: z.number().min(0).default(2)
    .describe('Minimum co-occurrences to create an edge (window mode)'),
  minProximityWeight: z.number().min(0).default(0.2)
    .describe('Minimum weight to create an edge (structured proximity mode)'),
  computeMetrics: z.boolean().default(true)
    .describe('Whether to compute centrality metrics'),
  blocks: z.array(z.object({
    id: z.string(),
    type: z.string(),
    text: z.string(),
    headingPath: z.array(z.string()),
    position: z.number(),
    charStart: z.number(),
    charEnd: z.number(),
    wordCount: z.number(),
    parentId: z.string().optional()
  })).optional()
    .describe('Content blocks from seo_crawl_page (enables structured proximity + provenance)'),
  sourceUrl: z.string().optional()
    .describe('Source URL for provenance (used when blocks are provided)'),
  useStructuredProximity: z.boolean().default(true)
    .describe('Use structured proximity instead of fixed word window when blocks are provided'),
  includePageLevel: z.boolean().default(false)
    .describe('Include page-level co-occurrence tier in structured proximity'),
  proximityWeights: z.object({
    sentence: z.number().min(0).max(2).optional(),
    paragraph: z.number().min(0).max(2).optional(),
    section: z.number().min(0).max(2).optional(),
    page: z.number().min(0).max(2).optional()
  }).optional()
    .describe('Override structured proximity weights'),
  usePMIWeighting: z.boolean().default(true)
    .describe('Apply PMI/NPMI weighting when blocks are provided'),
  pmiWindowType: z.enum(['sentence', 'paragraph', 'block']).default('sentence')
    .describe('Window type for PMI weighting')
};

interface InputType {
  entities?: EntityInput[];
  sourceText?: string;
  extractionResult?: ExtractionResult;
  windowSize: number;
  minEdgeWeight: number;
  minProximityWeight: number;
  computeMetrics: boolean;
  blocks?: ContentBlock[];
  sourceUrl?: string;
  useStructuredProximity: boolean;
  includePageLevel: boolean;
  proximityWeights?: Partial<ProximityWeights>;
  usePMIWeighting: boolean;
  pmiWindowType: WindowType;
}

export function registerGraphTool(server: McpServer): void {
  server.tool(
    'seo_build_entity_graph',
    'Build an entity graph from extracted entities. Uses structured proximity (sentence/paragraph/section) with provenance when blocks are provided, and applies PMI/NPMI weighting. Falls back to a fixed word window if no blocks are provided. Computes centrality metrics and detects topic clusters.',
    inputSchema,
    async (params: InputType) => {
      const {
        entities,
        sourceText,
        extractionResult,
        windowSize,
        minEdgeWeight,
        minProximityWeight,
        computeMetrics,
        blocks,
        sourceUrl,
        useStructuredProximity,
        includePageLevel,
        proximityWeights,
        usePMIWeighting,
        pmiWindowType
      } = params;

      try {
        const extraction = extractionResult as ExtractionResult | undefined;
        const resolvedEntities = entities ?? extraction?.entities;
        const resolvedSourceText =
          sourceText ?? extraction?.sourceTextFull ?? extraction?.sourceText;
        const resolvedBlocks = blocks ?? extraction?.blocks;
        const resolvedSourceUrl = sourceUrl ?? extraction?.sourceUrl;

        if (!resolvedEntities || resolvedEntities.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: 'No entities provided. Pass entities/sourceText or the full extractionResult from seo_extract_entities.'
              }, null, 2)
            }],
            isError: true
          };
        }

        if (!resolvedSourceText || resolvedSourceText.length < 20) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: 'No sourceText provided. Pass sourceText or extractionResult.sourceTextFull.'
              }, null, 2)
            }],
            isError: true
          };
        }

        // Convert input entities to full Entity type
        const fullEntities: Entity[] = resolvedEntities.map((e: EntityInput) => ({
          id: e.id,
          name: e.name,
          type: (e.type as Entity['type']) || 'Concept',
          confidence: e.confidence || 0.5,
          relevance: e.relevance || 0.5,
          mentions: e.mentions.map((m) => ({
            startPosition: m.startPosition,
            endPosition: m.endPosition,
            text: m.text || '',
            sentenceIndex: m.sentenceIndex || 0,
            context: m.context || '',
            blockId: (m as { blockId?: string }).blockId,
            headingPath: (m as { headingPath?: string[] }).headingPath
          }))
        }));

        const hasBlocks = Array.isArray(resolvedBlocks) && resolvedBlocks.length > 0;
        const blockIndex = hasBlocks
          ? new Map<string, ContentBlock>(resolvedBlocks.map(b => [b.id, b]))
          : new Map<string, ContentBlock>();

        // Build edges
        let graphEdges: GraphEdge[] = [];
        let graphMethod: 'structured_proximity' | 'window' = 'window';

        if (hasBlocks && useStructuredProximity) {
          graphMethod = 'structured_proximity';
          const weights: ProximityWeights = {
            ...DEFAULT_WEIGHTS,
            ...(proximityWeights || {})
          };

          const builder = new StructuredProximityBuilder(weights);
          const result = builder.buildGraphWithProvenance(
            fullEntities,
            resolvedBlocks!,
            resolvedSourceUrl || '',
            {
              minWeight: minProximityWeight,
              includePageLevel
            }
          );

          graphEdges = result.edges.map(edge => ({
            source: edge.source,
            target: edge.target,
            weight: edge.weight,
            type: 'cooccurrence',
            evidence: edge.evidence.map(ev => {
              const block = blockIndex.get(ev.blockId);
              return {
                text: ev.text,
                sourceUrl: ev.sourceUrl || sourceUrl,
                blockId: ev.blockId,
                headingPath: ev.headingPath,
                startPosition: block?.charStart,
                endPosition: block?.charEnd
              };
            }),
            proximityTiers: edge.proximityTiers
          }));
        } else {
          const simpleGraph = buildCooccurrenceGraph(fullEntities, resolvedSourceText, {
            windowSize,
            minWeight: minEdgeWeight
          });

          if (simpleGraph.nodes.size === 0) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  error: 'No graph could be built. Ensure entities have valid position information and co-occur within the window size.',
                  suggestion: 'Try increasing windowSize or decreasing minEdgeWeight'
                }, null, 2)
              }],
              isError: true
            };
          }

          const addedEdges = new Set<string>();
          for (const [source, neighbors] of simpleGraph.edges) {
            for (const [target, weight] of neighbors) {
              const edgeKey = [source, target].sort().join('|||');
              if (!addedEdges.has(edgeKey)) {
                addedEdges.add(edgeKey);
                graphEdges.push({
                  source,
                  target,
                  weight,
                  type: 'cooccurrence'
                });
              }
            }
          }
        }

        if (graphEdges.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: 'No edges could be built for the graph.',
                suggestion: 'Try lowering minEdgeWeight or using structured blocks from seo_crawl_page'
              }, null, 2)
            }],
            isError: true
          };
        }

        // Optional PMI weighting (requires blocks)
        if (hasBlocks && usePMIWeighting) {
          const pmiSettings = getPMISettingsFromEnv();
          const calculator = new PMICalculator({
            smoothing: pmiSettings.smoothing,
            minFrequency: pmiSettings.minFrequency
          });

          const windows = extractCooccurrenceWindows(
            resolvedBlocks!,
            fullEntities,
            pmiWindowType
          );
          const counts = calculator.buildCounts(windows);
          const pmiResults = calculator.applyToEdges(
            graphEdges.map(e => ({
              source: e.source,
              target: e.target,
              weight: e.weight ?? 1
            })),
            counts,
            { useNPMI: true, combineWithFrequency: true, filterNegative: true }
          );

          const pmiMap = new Map<string, { weight: number; pmi: number; npmi?: number }>();
          for (const r of pmiResults) {
            const key = [r.source, r.target].sort().join('|||');
            pmiMap.set(key, { weight: r.weight, pmi: r.pmi, npmi: r.npmi });
          }

          graphEdges = graphEdges.map(edge => {
            const key = [edge.source, edge.target].sort().join('|||');
            const result = pmiMap.get(key);
            if (!result) return edge;
            return {
              ...edge,
              weight: result.weight,
              pmi: result.pmi,
              npmi: result.npmi
            };
          });
        }

        // Build simple graph for metrics
        const simpleGraph = createGraph();
        for (const edge of graphEdges) {
          addEdge(simpleGraph, edge.source, edge.target, edge.weight ?? 1);
        }

        // Compute metrics if requested
        let centralities = {
          betweenness: new Map<string, number>(),
          degree: new Map<string, number>(),
          closeness: new Map<string, number>(),
          diversivity: new Map<string, number>()
        };
        let communities = new Map<string, number>();
        let mod = 0;
        let avgClustering = 0;

        if (computeMetrics) {
          centralities = computeAllCentralities(simpleGraph);
          communities = detectCommunities(simpleGraph);
          mod = modularity(simpleGraph, communities);
          avgClustering = averageClusteringCoefficient(simpleGraph);
        } else {
          // Initialize with defaults
          for (const node of simpleGraph.nodes) {
            centralities.betweenness.set(node, 0);
            centralities.degree.set(node, 0);
            centralities.closeness.set(node, 0);
            centralities.diversivity.set(node, 0);
            communities.set(node, 0);
          }
        }

        // Create entity lookup
        const entityMap = new Map<string, Entity>();
        for (const e of fullEntities) {
          entityMap.set(e.id, e);
        }

        // Build graph nodes
        const graphNodes: GraphNode[] = [];
        for (const nodeId of simpleGraph.nodes) {
          const entity = entityMap.get(nodeId);
          if (entity) {
            graphNodes.push({
              id: nodeId,
              entity,
              betweennessCentrality: centralities.betweenness.get(nodeId) || 0,
              degreeCentrality: centralities.degree.get(nodeId) || 0,
              closenessCentrality: centralities.closeness.get(nodeId) || 0,
              diversivity: centralities.diversivity.get(nodeId) || 0,
              cluster: communities.get(nodeId) || 0
            });
          }
        }

        // Detect structural gaps
        const gaps = computeMetrics
          ? detectStructuralGaps(simpleGraph, communities)
          : [];

        // Get top entities by BC
        const sortedByBC = [...centralities.betweenness.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([id]) => id);

        const sortedByDegree = [...centralities.degree.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([id]) => id);

        // Build metadata
        const metadata: GraphMetadata = {
          extractedAt: new Date().toISOString(),
          entityCount: getNodeCount(simpleGraph),
          edgeCount: getEdgeCount(simpleGraph),
          modularity: mod,
          density: getGraphDensity(simpleGraph),
          averageClustering: avgClustering,
          topicalBrokers: sortedByBC,
          hubConcepts: sortedByDegree,
          structuralGaps: gaps.map(g => ({
            cluster1: { id: g.cluster1, topEntities: g.cluster1Entities.slice(0, 5), size: g.cluster1Entities.length },
            cluster2: { id: g.cluster2, topEntities: g.cluster2Entities.slice(0, 5), size: g.cluster2Entities.length },
            distance: g.distance,
            bridgeCandidates: g.bridgeCandidates.map(b => ({
              entityId: b.entityId,
              entityName: entityMap.get(b.entityId)?.name || b.entityId,
              potentialImpact: b.expectedImpact,
              suggestedConnections: b.potentialConnections
            })),
            contentOpportunity: `Bridge the gap between clusters ${g.cluster1} and ${g.cluster2}`
          }))
        };

        const entityGraph: EntityGraph = {
          nodes: graphNodes,
          edges: graphEdges,
          metadata
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              graph: entityGraph,
              summary: {
                nodeCount: metadata.entityCount,
                edgeCount: metadata.edgeCount,
                clusterCount: new Set(communities.values()).size,
                modularity: mod.toFixed(3),
                density: (metadata.density ?? 0).toFixed(3),
                topBrokers: sortedByBC.slice(0, 5).map(id => entityMap.get(id)?.name || id),
                gapsDetected: gaps.length,
                graphMethod,
                pmiWeighting: hasBlocks && usePMIWeighting
              }
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
