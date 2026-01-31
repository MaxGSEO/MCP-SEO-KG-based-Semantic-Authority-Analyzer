import { getNeighbors, type SimpleGraph } from './types.js';

export interface Community {
  id: number;
  nodes: Set<string>;
  internalWeight: number;
}

// Simplified Louvain algorithm for community detection
export function detectCommunities(graph: SimpleGraph): Map<string, number> {
  // Handle empty or small graphs
  if (graph.nodes.size === 0) {
    return new Map();
  }
  if (graph.nodes.size === 1) {
    const node = Array.from(graph.nodes)[0];
    return new Map([[node, 0]]);
  }

  // Initialize each node in its own community
  const communities = new Map<string, number>();
  let communityId = 0;

  for (const node of graph.nodes) {
    communities.set(node, communityId++);
  }

  let improved = true;
  let iterations = 0;
  const maxIterations = 100;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (const node of graph.nodes) {
      const currentCommunity = communities.get(node)!;
      const neighborCommunities = new Map<number, number>();

      // Calculate weight to each neighbor community
      for (const neighbor of getNeighbors(graph, node)) {
        const neighborCommunity = communities.get(neighbor)!;
        const weight = graph.edges.get(node)!.get(neighbor) || 1;
        neighborCommunities.set(
          neighborCommunity,
          (neighborCommunities.get(neighborCommunity) || 0) + weight
        );
      }

      // Find best community
      let bestCommunity = currentCommunity;
      let bestGain = 0;

      for (const [community, weight] of neighborCommunities) {
        if (community !== currentCommunity) {
          const gain = weight - (neighborCommunities.get(currentCommunity) || 0);
          if (gain > bestGain) {
            bestGain = gain;
            bestCommunity = community;
          }
        }
      }

      // Move to best community if gain is positive
      if (bestCommunity !== currentCommunity && bestGain > 0) {
        communities.set(node, bestCommunity);
        improved = true;
      }
    }
  }

  // Renumber communities to be contiguous
  return renumberCommunities(communities);
}

function renumberCommunities(communities: Map<string, number>): Map<string, number> {
  const uniqueCommunities = new Set(communities.values());
  const communityMap = new Map<number, number>();
  let newId = 0;

  for (const oldId of uniqueCommunities) {
    communityMap.set(oldId, newId++);
  }

  const result = new Map<string, number>();
  for (const [node, oldCommunity] of communities) {
    result.set(node, communityMap.get(oldCommunity)!);
  }

  return result;
}

// Calculate modularity score
export function modularity(graph: SimpleGraph, communities: Map<string, number>): number {
  let totalWeight = 0;
  let q = 0;

  // Calculate total edge weight
  for (const [source, neighbors] of graph.edges) {
    for (const [target, weight] of neighbors) {
      if (source < target) { // Count each edge once
        totalWeight += weight;
      }
    }
  }

  if (totalWeight === 0) return 0;

  // Calculate modularity
  for (const [source, neighbors] of graph.edges) {
    const sourceCommunity = communities.get(source);
    const sourceDegree = Array.from(neighbors.values()).reduce((a, b) => a + b, 0);

    for (const [target, weight] of neighbors) {
      if (source < target) {
        const targetCommunity = communities.get(target);
        const targetNeighbors = graph.edges.get(target);
        const targetDegree = targetNeighbors
          ? Array.from(targetNeighbors.values()).reduce((a, b) => a + b, 0)
          : 0;

        if (sourceCommunity === targetCommunity) {
          q += weight - (sourceDegree * targetDegree) / (2 * totalWeight);
        }
      }
    }
  }

  return q / totalWeight;
}

// Get nodes in each community
export function getCommunitiesMap(communities: Map<string, number>): Map<number, string[]> {
  const result = new Map<number, string[]>();

  for (const [node, community] of communities) {
    if (!result.has(community)) {
      result.set(community, []);
    }
    result.get(community)!.push(node);
  }

  return result;
}

// Get community count
export function getCommunityCount(communities: Map<string, number>): number {
  return new Set(communities.values()).size;
}

// Calculate average clustering coefficient
export function averageClusteringCoefficient(graph: SimpleGraph): number {
  if (graph.nodes.size === 0) return 0;

  let totalCoeff = 0;

  for (const node of graph.nodes) {
    const neighbors = getNeighbors(graph, node);
    const k = neighbors.length;

    if (k < 2) {
      continue; // Clustering coefficient is 0 for nodes with < 2 neighbors
    }

    // Count edges between neighbors
    let triangles = 0;
    for (let i = 0; i < neighbors.length; i++) {
      for (let j = i + 1; j < neighbors.length; j++) {
        if (graph.edges.get(neighbors[i])?.has(neighbors[j])) {
          triangles++;
        }
      }
    }

    const possibleTriangles = (k * (k - 1)) / 2;
    totalCoeff += triangles / possibleTriangles;
  }

  return totalCoeff / graph.nodes.size;
}

// Label communities based on most central nodes
export function labelCommunities(
  communities: Map<string, number>,
  nodeNames: Map<string, string>,
  centrality: Map<string, number>
): Map<number, string> {
  const communitiesMap = getCommunitiesMap(communities);
  const labels = new Map<number, string>();

  for (const [communityId, nodes] of communitiesMap) {
    // Sort nodes by centrality
    const sortedNodes = nodes.sort((a, b) =>
      (centrality.get(b) || 0) - (centrality.get(a) || 0)
    );

    // Use top 2-3 node names as label
    const topNames = sortedNodes
      .slice(0, 3)
      .map(n => nodeNames.get(n) || n);

    labels.set(communityId, topNames.join(', '));
  }

  return labels;
}
