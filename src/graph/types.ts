// Simple graph data structure for network analysis

export interface SimpleGraph {
  nodes: Set<string>;
  edges: Map<string, Map<string, number>>; // adjacency list with weights
}

export function createGraph(): SimpleGraph {
  return {
    nodes: new Set(),
    edges: new Map()
  };
}

export function addNode(graph: SimpleGraph, nodeId: string): void {
  graph.nodes.add(nodeId);
  if (!graph.edges.has(nodeId)) {
    graph.edges.set(nodeId, new Map());
  }
}

export function addEdge(graph: SimpleGraph, source: string, target: string, weight: number = 1): void {
  addNode(graph, source);
  addNode(graph, target);

  // Undirected graph - add both directions
  const sourceEdges = graph.edges.get(source)!;
  const targetEdges = graph.edges.get(target)!;

  sourceEdges.set(target, (sourceEdges.get(target) || 0) + weight);
  targetEdges.set(source, (targetEdges.get(source) || 0) + weight);
}

export function getNeighbors(graph: SimpleGraph, nodeId: string): string[] {
  return Array.from(graph.edges.get(nodeId)?.keys() || []);
}

export function getDegree(graph: SimpleGraph, nodeId: string): number {
  return graph.edges.get(nodeId)?.size || 0;
}

export function getEdgeWeight(graph: SimpleGraph, source: string, target: string): number {
  return graph.edges.get(source)?.get(target) || 0;
}

export function hasEdge(graph: SimpleGraph, source: string, target: string): boolean {
  return graph.edges.get(source)?.has(target) || false;
}

export function getNodeCount(graph: SimpleGraph): number {
  return graph.nodes.size;
}

export function getEdgeCount(graph: SimpleGraph): number {
  let count = 0;
  for (const neighbors of graph.edges.values()) {
    count += neighbors.size;
  }
  return count / 2; // Divide by 2 for undirected graph
}

export function getGraphDensity(graph: SimpleGraph): number {
  const n = graph.nodes.size;
  if (n < 2) return 0;
  const maxEdges = (n * (n - 1)) / 2;
  return getEdgeCount(graph) / maxEdges;
}

export function getTotalWeight(graph: SimpleGraph): number {
  let total = 0;
  for (const [source, neighbors] of graph.edges) {
    for (const [target, weight] of neighbors) {
      if (source < target) { // Count each edge once
        total += weight;
      }
    }
  }
  return total;
}

export function cloneGraph(graph: SimpleGraph): SimpleGraph {
  const newGraph = createGraph();
  for (const node of graph.nodes) {
    addNode(newGraph, node);
  }
  for (const [source, neighbors] of graph.edges) {
    for (const [target, weight] of neighbors) {
      if (source < target) { // Add each edge once
        newGraph.edges.get(source)!.set(target, weight);
        newGraph.edges.get(target)!.set(source, weight);
      }
    }
  }
  return newGraph;
}
