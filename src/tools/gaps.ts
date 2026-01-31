import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createGraph, addEdge, addNode } from '../graph/types.js';
import { detectCommunities } from '../graph/communities.js';
import { detectStructuralGaps, generateBridgeSuggestions } from '../graph/gaps.js';
import type { StructuralGap, ClusterInfo, BridgeCandidate } from '../types/index.js';

interface GraphInput {
  nodes: Array<{
    id: string;
    entity: {
      id: string;
      name: string;
    };
    cluster?: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    weight: number;
  }>;
}

const inputSchema = {
  graph: z.object({
    nodes: z.array(z.object({
      id: z.string(),
      entity: z.object({
        id: z.string(),
        name: z.string()
      }).passthrough(),
      cluster: z.number().optional()
    }).passthrough()),
    edges: z.array(z.object({
      source: z.string(),
      target: z.string(),
      weight: z.number()
    }))
  }).describe('Entity graph with computed clusters'),
  minGapDistance: z.number().min(0).max(1).default(0.3)
    .describe('Minimum inter-cluster distance to consider a gap'),
  maxGaps: z.number().int().min(1).max(20).default(5)
    .describe('Maximum gaps to return'),
  suggestBridges: z.boolean().default(true)
    .describe('Suggest entities that could bridge gaps')
};

interface InputType {
  graph: GraphInput;
  minGapDistance: number;
  maxGaps: number;
  suggestBridges: boolean;
}

export function registerGapsTool(server: McpServer): void {
  server.tool(
    'seo_detect_gaps',
    'Detect structural gaps in entity graph - disconnected or weakly connected topic clusters that represent content opportunities. Returns gap analysis with bridge entity suggestions.',
    inputSchema,
    async (params: InputType) => {
      const { graph, minGapDistance, maxGaps, suggestBridges } = params;

      try {
        // Rebuild simple graph
        const simpleGraph = createGraph();

        // Add nodes first
        for (const graphNode of graph.nodes) {
          addNode(simpleGraph, graphNode.id);
        }

        // Add edges
        for (const edge of graph.edges) {
          addEdge(simpleGraph, edge.source, edge.target, edge.weight);
        }

        // Handle small graphs
        if (simpleGraph.nodes.size < 3) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                gaps: [],
                message: 'Graph is too small for gap detection (needs at least 3 nodes)'
              }, null, 2)
            }]
          };
        }

        // Get communities - use existing clusters if available, otherwise detect
        let communities: Map<string, number>;
        const hasExistingClusters = graph.nodes.some((n: { cluster?: number }) => n.cluster !== undefined);

        if (hasExistingClusters) {
          communities = new Map();
          for (const graphNode of graph.nodes) {
            communities.set(graphNode.id, graphNode.cluster ?? 0);
          }
        } else {
          communities = detectCommunities(simpleGraph);
        }

        // Check if we have multiple clusters
        const clusterCount = new Set(communities.values()).size;
        if (clusterCount < 2) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                gaps: [],
                message: 'Only one cluster detected - no structural gaps possible',
                suggestion: 'The content is well-connected. Consider expanding to new topics to identify potential gaps.'
              }, null, 2)
            }]
          };
        }

        // Create entity name lookup
        const entityNames = new Map<string, string>();
        for (const graphNode of graph.nodes) {
          entityNames.set(graphNode.id, graphNode.entity.name);
        }

        // Detect gaps
        const rawGaps = detectStructuralGaps(simpleGraph, communities, minGapDistance, maxGaps);

        // Convert to output format
        const structuralGaps: StructuralGap[] = rawGaps.map(gap => {
          const cluster1Entities = gap.cluster1Entities;
          const cluster2Entities = gap.cluster2Entities;

          // Get top entities for each cluster (by position in list, which is somewhat arbitrary)
          const cluster1TopNames = cluster1Entities.slice(0, 5).map(id => entityNames.get(id) || id);
          const cluster2TopNames = cluster2Entities.slice(0, 5).map(id => entityNames.get(id) || id);

          const cluster1Info: ClusterInfo = {
            id: gap.cluster1,
            label: cluster1TopNames.slice(0, 2).join(', '),
            topEntities: cluster1TopNames,
            size: cluster1Entities.length
          };

          const cluster2Info: ClusterInfo = {
            id: gap.cluster2,
            label: cluster2TopNames.slice(0, 2).join(', '),
            topEntities: cluster2TopNames,
            size: cluster2Entities.length
          };

          const bridgeCandidates: BridgeCandidate[] = suggestBridges
            ? gap.bridgeCandidates.map(b => ({
                entityId: b.entityId,
                entityName: entityNames.get(b.entityId) || b.entityId,
                potentialImpact: b.expectedImpact,
                suggestedConnections: b.potentialConnections.map(id => entityNames.get(id) || id)
              }))
            : [];

          return {
            cluster1: cluster1Info,
            cluster2: cluster2Info,
            distance: gap.distance,
            bridgeCandidates,
            contentOpportunity: generateBridgeSuggestions(gap, entityNames)
          };
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              gaps: structuralGaps,
              summary: {
                totalClusters: clusterCount,
                gapsFound: structuralGaps.length,
                averageGapDistance: structuralGaps.length > 0
                  ? (structuralGaps.reduce((sum, g) => sum + g.distance, 0) / structuralGaps.length).toFixed(3)
                  : 0,
                topOpportunity: structuralGaps[0]?.contentOpportunity || 'No significant gaps found'
              },
              recommendations: generateRecommendations(structuralGaps)
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

function generateRecommendations(gaps: StructuralGap[]): string[] {
  const recommendations: string[] = [];

  if (gaps.length === 0) {
    recommendations.push('Your content has good topical coherence with no major structural gaps.');
    recommendations.push('Consider expanding into adjacent topics to grow your semantic coverage.');
    return recommendations;
  }

  // Prioritize gaps by distance
  const topGap = gaps[0];
  if (topGap.distance > 0.8) {
    recommendations.push(`Critical gap: "${topGap.cluster1.label}" and "${topGap.cluster2.label}" clusters are almost completely disconnected.`);
    recommendations.push('Create bridging content that explicitly connects these topic areas.');
  } else if (topGap.distance > 0.5) {
    recommendations.push(`Significant gap between "${topGap.cluster1.label}" and "${topGap.cluster2.label}" topics.`);
    recommendations.push('Add content that references entities from both clusters.');
  } else {
    recommendations.push(`Minor gaps detected - your content is reasonably well-connected.`);
  }

  // Bridge suggestions
  if (topGap.bridgeCandidates.length > 0) {
    const bridgeEntity = topGap.bridgeCandidates[0];
    recommendations.push(`Best bridge candidate: Use "${bridgeEntity.entityName}" to connect the disconnected clusters.`);
    if (bridgeEntity.suggestedConnections.length > 0) {
      recommendations.push(`Connect "${bridgeEntity.entityName}" to: ${bridgeEntity.suggestedConnections.slice(0, 3).join(', ')}`);
    }
  }

  return recommendations;
}
