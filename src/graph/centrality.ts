import { getNeighbors, getDegree, type SimpleGraph } from './types.js';

// Brandes algorithm for betweenness centrality O(VE)
export function betweennessCentrality(graph: SimpleGraph): Map<string, number> {
  const bc = new Map<string, number>();

  // Initialize all nodes with 0
  for (const node of graph.nodes) {
    bc.set(node, 0);
  }

  // Handle small graphs
  if (graph.nodes.size < 3) {
    return bc;
  }

  // For each node as source
  for (const source of graph.nodes) {
    // BFS to find shortest paths
    const stack: string[] = [];
    const predecessors = new Map<string, string[]>();
    const sigma = new Map<string, number>(); // Number of shortest paths
    const distance = new Map<string, number>();

    for (const node of graph.nodes) {
      predecessors.set(node, []);
      sigma.set(node, 0);
      distance.set(node, -1);
    }

    sigma.set(source, 1);
    distance.set(source, 0);

    const queue: string[] = [source];

    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);

      for (const w of getNeighbors(graph, v)) {
        const distW = distance.get(w) ?? -1;
        const distV = distance.get(v) ?? 0;

        // First visit?
        if (distW < 0) {
          queue.push(w);
          distance.set(w, distV + 1);
        }
        // Shortest path to w via v?
        if (distance.get(w) === distV + 1) {
          const sigmaW = sigma.get(w) ?? 0;
          const sigmaV = sigma.get(v) ?? 0;
          sigma.set(w, sigmaW + sigmaV);
          const preds = predecessors.get(w);
          if (preds) preds.push(v);
        }
      }
    }

    // Accumulation phase
    const delta = new Map<string, number>();
    for (const node of graph.nodes) {
      delta.set(node, 0);
    }

    while (stack.length > 0) {
      const w = stack.pop()!;
      const preds = predecessors.get(w) ?? [];
      for (const v of preds) {
        const sigmaV = sigma.get(v) ?? 0;
        const sigmaW = sigma.get(w) ?? 0;
        if (sigmaW > 0) {
          const deltaW = delta.get(w) ?? 0;
          const contribution = (sigmaV / sigmaW) * (1 + deltaW);
          const deltaV = delta.get(v) ?? 0;
          delta.set(v, deltaV + contribution);
        }
      }
      if (w !== source) {
        const bcW = bc.get(w) ?? 0;
        const deltaW = delta.get(w) ?? 0;
        bc.set(w, bcW + deltaW);
      }
    }
  }

  // Normalize (for undirected graph, divide by 2)
  const n = graph.nodes.size;
  if (n > 2) {
    const normFactor = 2.0 / ((n - 1) * (n - 2));
    for (const [node, value] of bc) {
      bc.set(node, value * normFactor);
    }
  }

  return bc;
}

// Degree centrality
export function degreeCentrality(graph: SimpleGraph): Map<string, number> {
  const dc = new Map<string, number>();
  const n = graph.nodes.size;
  const maxDegree = n - 1;

  for (const node of graph.nodes) {
    const degree = getDegree(graph, node);
    dc.set(node, maxDegree > 0 ? degree / maxDegree : 0);
  }

  return dc;
}

// Closeness centrality with Wasserman-Faust normalization
export function closenessCentrality(graph: SimpleGraph): Map<string, number> {
  const cc = new Map<string, number>();
  const n = graph.nodes.size;

  for (const node of graph.nodes) {
    const distances = bfsDistances(graph, node);
    const reachableDistances = Array.from(distances.values()).filter(d => d > 0);
    const totalDistance = reachableDistances.reduce((a, b) => a + b, 0);
    const reachable = reachableDistances.length;

    if (reachable > 0 && totalDistance > 0) {
      // Wasserman-Faust normalization
      cc.set(node, (reachable / (n - 1)) * (reachable / totalDistance));
    } else {
      cc.set(node, 0);
    }
  }

  return cc;
}

function bfsDistances(graph: SimpleGraph, source: string): Map<string, number> {
  const distances = new Map<string, number>();
  const visited = new Set<string>();
  const queue: Array<{ node: string; distance: number }> = [{ node: source, distance: 0 }];

  visited.add(source);
  distances.set(source, 0);

  while (queue.length > 0) {
    const { node, distance } = queue.shift()!;

    for (const neighbor of getNeighbors(graph, node)) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        distances.set(neighbor, distance + 1);
        queue.push({ node: neighbor, distance: distance + 1 });
      }
    }
  }

  return distances;
}

// Diversivity (influence efficiency) - BC / Degree
export function diversivity(
  bc: Map<string, number>,
  graph: SimpleGraph
): Map<string, number> {
  const div = new Map<string, number>();

  for (const node of graph.nodes) {
    const bcValue = bc.get(node) || 0;
    const degree = getDegree(graph, node);

    if (degree > 0) {
      div.set(node, bcValue / degree);
    } else {
      div.set(node, 0);
    }
  }

  return div;
}

// Full centrality analysis
export interface CentralityMetrics {
  betweenness: Map<string, number>;
  degree: Map<string, number>;
  closeness: Map<string, number>;
  diversivity: Map<string, number>;
}

export function computeAllCentralities(graph: SimpleGraph): CentralityMetrics {
  const bc = betweennessCentrality(graph);
  const dc = degreeCentrality(graph);
  const cc = closenessCentrality(graph);
  const div = diversivity(bc, graph);

  return {
    betweenness: bc,
    degree: dc,
    closeness: cc,
    diversivity: div
  };
}

// Get top N nodes by centrality measure
export function getTopNodesByCentrality(
  centrality: Map<string, number>,
  n: number
): Array<{ nodeId: string; value: number }> {
  return [...centrality.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([nodeId, value]) => ({ nodeId, value }));
}
