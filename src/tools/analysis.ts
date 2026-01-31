import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createGraph, addEdge } from '../graph/types.js';
import { computeAllCentralities, getTopNodesByCentrality } from '../graph/centrality.js';
import { detectCommunities, getCommunitiesMap } from '../graph/communities.js';
import type { CentralityAnalysis, TopicalBroker, HubConcept, ConceptualGateway } from '../types/index.js';

interface GraphInput {
  nodes: Array<{
    id: string;
    entity: {
      id: string;
      name: string;
      type?: string;
    };
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
        name: z.string(),
        type: z.string().optional()
      }).passthrough()
    }).passthrough()),
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
};

interface InputType {
  graph: GraphInput;
  topN: number;
  includeDiversivity: boolean;
}

export function registerAnalysisTool(server: McpServer): void {
  server.tool(
    'seo_analyze_centrality',
    'Analyze entity graph for topical brokers (high betweenness centrality), hub concepts (high degree), and conceptual gateways (high influence efficiency). Returns ranked entities by structural importance.',
    inputSchema,
    async (params: InputType) => {
      const { graph, topN, includeDiversivity } = params;

      try {
        // Rebuild simple graph from input
        const simpleGraph = createGraph();

        // Add edges (nodes are added automatically)
        for (const edge of graph.edges) {
          addEdge(simpleGraph, edge.source, edge.target, edge.weight);
        }

        // Handle empty or small graphs
        if (simpleGraph.nodes.size < 2) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: 'Graph must have at least 2 nodes for centrality analysis',
                suggestion: 'Extract more entities or reduce minEdgeWeight when building the graph'
              }, null, 2)
            }],
            isError: true
          };
        }

        // Compute centralities
        const centralities = computeAllCentralities(simpleGraph);

        // Detect communities
        const communities = detectCommunities(simpleGraph);
        const communitiesMap = getCommunitiesMap(communities);

        // Create entity name lookup
        const entityNames = new Map<string, string>();
        const entityTypes = new Map<string, string>();
        for (const node of graph.nodes) {
          entityNames.set(node.id, node.entity.name);
          entityTypes.set(node.id, node.entity.type || 'Concept');
        }

        // Get topical brokers (high BC)
        const topByBC = getTopNodesByCentrality(centralities.betweenness, topN);
        const topicalBrokers: TopicalBroker[] = topByBC.map(({ nodeId, value }) => {
          const connectedClusters = new Set<number>();
          const neighbors = simpleGraph.edges.get(nodeId);
          if (neighbors) {
            for (const neighbor of neighbors.keys()) {
              const cluster = communities.get(neighbor);
              if (cluster !== undefined) {
                connectedClusters.add(cluster);
              }
            }
          }

          return {
            entityId: nodeId,
            name: entityNames.get(nodeId) || nodeId,
            betweennessCentrality: value,
            connectedClusters: Array.from(connectedClusters),
            interpretation: generateBrokerInterpretation(
              entityNames.get(nodeId) || nodeId,
              value,
              connectedClusters.size
            )
          };
        });

        // Get hub concepts (high degree)
        const topByDegree = getTopNodesByCentrality(centralities.degree, topN);
        const hubConcepts: HubConcept[] = topByDegree.map(({ nodeId }) => {
          const cluster = communities.get(nodeId) || 0;
          const clusterNodes = communitiesMap.get(cluster) || [];

          // Calculate local influence within cluster
          let localConnections = 0;
          const neighbors = simpleGraph.edges.get(nodeId);
          if (neighbors) {
            for (const neighbor of neighbors.keys()) {
              if (communities.get(neighbor) === cluster) {
                localConnections++;
              }
            }
          }
          const localInfluence = clusterNodes.length > 1
            ? localConnections / (clusterNodes.length - 1)
            : 0;

          return {
            entityId: nodeId,
            name: entityNames.get(nodeId) || nodeId,
            degree: neighbors?.size || 0,
            localInfluence
          };
        });

        // Get conceptual gateways (high diversivity = BC/degree)
        let conceptualGateways: ConceptualGateway[] = [];
        if (includeDiversivity) {
          const topByDiv = getTopNodesByCentrality(centralities.diversivity, topN);
          conceptualGateways = topByDiv
            .filter(({ value }) => value > 0)
            .map(({ nodeId, value }) => {
              const accessibleClusters = new Set<number>();
              const neighbors = simpleGraph.edges.get(nodeId);
              if (neighbors) {
                for (const neighbor of neighbors.keys()) {
                  const cluster = communities.get(neighbor);
                  if (cluster !== undefined) {
                    accessibleClusters.add(cluster);
                  }
                }
              }

              return {
                entityId: nodeId,
                name: entityNames.get(nodeId) || nodeId,
                diversivity: value,
                accessibleClusters: Array.from(accessibleClusters),
                useCase: `Use "${entityNames.get(nodeId) || nodeId}" as an entry point to connect ${accessibleClusters.size} topic clusters efficiently`
              };
            });
        }

        // Get peripheral concepts (low BC AND low degree)
        const bcThreshold = 0.1;
        const degreeThreshold = 0.2;
        const peripheralConcepts = Array.from(simpleGraph.nodes)
          .filter(nodeId =>
            (centralities.betweenness.get(nodeId) || 0) < bcThreshold &&
            (centralities.degree.get(nodeId) || 0) < degreeThreshold
          )
          .slice(0, topN);

        const analysis: CentralityAnalysis = {
          topicalBrokers,
          hubConcepts,
          peripheralConcepts,
          conceptualGateways
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              analysis,
              summary: {
                totalNodes: simpleGraph.nodes.size,
                totalClusters: communitiesMap.size,
                topBroker: topicalBrokers[0]?.name || 'None',
                topHub: hubConcepts[0]?.name || 'None',
                topGateway: conceptualGateways[0]?.name || 'None',
                peripheralCount: peripheralConcepts.length
              },
              insights: generateInsights(topicalBrokers, hubConcepts, conceptualGateways)
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

function generateBrokerInterpretation(name: string, bc: number, clusterCount: number): string {
  if (bc > 0.3 && clusterCount > 2) {
    return `"${name}" is a critical topical broker, connecting ${clusterCount} different topic clusters. Content about this entity bridges multiple themes.`;
  } else if (bc > 0.15) {
    return `"${name}" serves as an important connector between topics. Consider emphasizing this entity to improve topical flow.`;
  } else {
    return `"${name}" has moderate bridging potential. It helps connect related concepts.`;
  }
}

function generateInsights(
  brokers: TopicalBroker[],
  hubs: HubConcept[],
  gateways: ConceptualGateway[]
): string[] {
  const insights: string[] = [];

  if (brokers.length > 0) {
    const topBroker = brokers[0];
    if (topBroker.betweennessCentrality > 0.3) {
      insights.push(`"${topBroker.name}" is the most important topical broker - it controls information flow between ${topBroker.connectedClusters.length} topic clusters.`);
    }
  }

  if (hubs.length > 0) {
    const topHub = hubs[0];
    if (topHub.degree > 5) {
      insights.push(`"${topHub.name}" is a hub concept with ${topHub.degree} connections - it's central to the content's semantic network.`);
    }
  }

  if (gateways.length > 0) {
    const topGateway = gateways[0];
    if (topGateway.diversivity > 0.05) {
      insights.push(`"${topGateway.name}" is an efficient gateway - it provides access to multiple topics with few connections.`);
    }
  }

  if (brokers.length > 0 && hubs.length > 0) {
    const brokerSet = new Set(brokers.slice(0, 5).map(b => b.entityId));
    const hubSet = new Set(hubs.slice(0, 5).map(h => h.entityId));
    const overlap = [...brokerSet].filter(id => hubSet.has(id));
    if (overlap.length > 0) {
      insights.push(`${overlap.length} entities are both hubs and brokers - they're the most semantically important concepts in this content.`);
    }
  }

  return insights;
}
