import { getNeighbors, getDegree, type SimpleGraph } from './types.js';
import { getCommunitiesMap } from './communities.js';

export interface StructuralGapInfo {
  cluster1: number;
  cluster2: number;
  distance: number;
  cluster1Entities: string[];
  cluster2Entities: string[];
  bridgeCandidates: BridgeCandidateInfo[];
}

export interface BridgeCandidateInfo {
  entityId: string;
  fromCluster: number;
  potentialConnections: string[];
  expectedImpact: number;
}

export function detectStructuralGaps(
  graph: SimpleGraph,
  communities: Map<string, number>,
  minDistance: number = 0.3,
  maxGaps: number = 5
): StructuralGapInfo[] {
  // Group nodes by community
  const clusterNodes = getCommunitiesMap(communities);

  const clusters = Array.from(clusterNodes.keys());
  const gaps: StructuralGapInfo[] = [];

  // Calculate inter-cluster distances
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const c1 = clusters[i];
      const c2 = clusters[j];

      const distance = interClusterDistance(graph, c1, c2, communities);

      if (distance > minDistance) {
        const c1Entities = clusterNodes.get(c1) || [];
        const c2Entities = clusterNodes.get(c2) || [];

        gaps.push({
          cluster1: c1,
          cluster2: c2,
          distance,
          cluster1Entities: c1Entities,
          cluster2Entities: c2Entities,
          bridgeCandidates: findBridgeCandidates(graph, c1, c2, communities, clusterNodes)
        });
      }
    }
  }

  return gaps
    .sort((a, b) => b.distance - a.distance)
    .slice(0, maxGaps);
}

function interClusterDistance(
  graph: SimpleGraph,
  c1: number,
  c2: number,
  communities: Map<string, number>
): number {
  // Calculate normalized distance based on edge density between clusters
  let interClusterEdges = 0;
  let c1Nodes = 0;
  let c2Nodes = 0;
  let maxWeight = 1;

  for (const [, community] of communities) {
    if (community === c1) c1Nodes++;
    if (community === c2) c2Nodes++;
  }

  for (const [source, neighbors] of graph.edges) {
    if (communities.get(source) === c1) {
      for (const [target, weight] of neighbors) {
        if (communities.get(target) === c2) {
          interClusterEdges += weight;
        }
        if (weight > maxWeight) maxWeight = weight;
      }
    }
  }

  // Maximum possible edges between clusters
  const maxEdges = c1Nodes * c2Nodes;

  if (maxEdges === 0) return 1;

  const maxPossibleWeight = maxEdges * maxWeight;
  if (maxPossibleWeight === 0) return 1;

  // Distance is inverse of normalized edge count
  const normalized = Math.min(1, interClusterEdges / maxPossibleWeight);
  return 1 - normalized;
}

function findBridgeCandidates(
  graph: SimpleGraph,
  c1: number,
  c2: number,
  communities: Map<string, number>,
  clusterNodes: Map<number, string[]>
): BridgeCandidateInfo[] {
  const candidates: BridgeCandidateInfo[] = [];
  const c1Entities = clusterNodes.get(c1) || [];
  const c2Entities = clusterNodes.get(c2) || [];

  // Find nodes in c1 that could bridge to c2
  for (const node of c1Entities) {
    // Check if node has any connections to c2
    const neighbors = getNeighbors(graph, node);
    const c2Neighbors = neighbors.filter(n => communities.get(n) === c2);

    if (c2Neighbors.length === 0) {
      // This node could be a bridge candidate
      // Calculate potential impact based on degree
      const degree = getDegree(graph, node);
      const impact = degree * (c2Entities.length - c2Neighbors.length) / Math.max(c2Entities.length, 1);

      candidates.push({
        entityId: node,
        fromCluster: c1,
        potentialConnections: c2Entities.slice(0, 5),
        expectedImpact: impact
      });
    }
  }

  // Also check nodes in c2 that could bridge to c1
  for (const node of c2Entities) {
    const neighbors = getNeighbors(graph, node);
    const c1Neighbors = neighbors.filter(n => communities.get(n) === c1);

    if (c1Neighbors.length === 0) {
      const degree = getDegree(graph, node);
      const impact = degree * (c1Entities.length - c1Neighbors.length) / Math.max(c1Entities.length, 1);

      candidates.push({
        entityId: node,
        fromCluster: c2,
        potentialConnections: c1Entities.slice(0, 5),
        expectedImpact: impact
      });
    }
  }

  return candidates
    .sort((a, b) => b.expectedImpact - a.expectedImpact)
    .slice(0, 5);
}

// Generate content suggestions for bridging gaps
export function generateBridgeSuggestions(
  gap: StructuralGapInfo,
  entityNames: Map<string, string>
): string {
  const cluster1Names = gap.cluster1Entities
    .slice(0, 3)
    .map(id => entityNames.get(id) || id)
    .join(', ');

  const cluster2Names = gap.cluster2Entities
    .slice(0, 3)
    .map(id => entityNames.get(id) || id)
    .join(', ');

  const bridgeNames = gap.bridgeCandidates
    .slice(0, 2)
    .map(c => entityNames.get(c.entityId) || c.entityId)
    .join(' or ');

  return `Content opportunity: Connect the "${cluster1Names}" topic cluster with "${cluster2Names}". ` +
    `Consider using ${bridgeNames} as bridge concepts to create semantic connections between these topics.`;
}

// Calculate overall gap score for a graph
export function calculateGapScore(
  graph: SimpleGraph,
  communities: Map<string, number>
): number {
  const gaps = detectStructuralGaps(graph, communities, 0.1, 100);

  if (gaps.length === 0) return 0;

  // Average gap distance
  const avgDistance = gaps.reduce((sum, g) => sum + g.distance, 0) / gaps.length;

  return avgDistance;
}
