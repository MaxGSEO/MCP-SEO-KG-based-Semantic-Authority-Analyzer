import { EntityGraph, GraphNode } from '../types/index.js';
import { ExportOptions } from '../types/addon.js';
import { writeFileSync } from 'fs';

export function exportToDOT(
  graph: EntityGraph,
  outputPath: string,
  options: ExportOptions = {}
): number {
  const {
    includeMetrics = true,
    includeClusters = true,
    title
  } = options;

  const lines: string[] = [];

  // Graph header
  const graphName = title ? escapeDotId(title) : 'EntityGraph';
  lines.push(`graph ${graphName} {`);
  lines.push('  // Graph attributes');
  lines.push('  graph [overlap=false, splines=true];');
  lines.push('  node [shape=ellipse, style=filled];');
  lines.push('  edge [color="#666666"];');
  lines.push('');

  // Cluster nodes by community if available
  if (includeClusters) {
    const clusters = new Map<number, GraphNode[]>();
    const unclusteredNodes: GraphNode[] = [];

    for (const node of graph.nodes) {
      if (node.cluster != null) {
        if (!clusters.has(node.cluster)) {
          clusters.set(node.cluster, []);
        }
        clusters.get(node.cluster)!.push(node);
      } else {
        unclusteredNodes.push(node);
      }
    }

    // Output clustered nodes
    for (const [clusterId, nodes] of clusters) {
      const color = getClusterColor(clusterId);
      lines.push(`  subgraph cluster_${clusterId} {`);
      lines.push(`    label="Cluster ${clusterId}";`);
      lines.push(`    style=dashed;`);
      lines.push(`    color="${color}";`);

      for (const node of nodes) {
        lines.push(`    ${formatNode(node, color, includeMetrics)}`);
      }
      lines.push('  }');
      lines.push('');
    }

    // Output unclustered nodes
    if (unclusteredNodes.length > 0) {
      lines.push('  // Unclustered nodes');
      for (const node of unclusteredNodes) {
        lines.push(`  ${formatNode(node, '#999999', includeMetrics)}`);
      }
      lines.push('');
    }
  } else {
    // No clustering, output all nodes
    lines.push('  // Nodes');
    for (const node of graph.nodes) {
      lines.push(`  ${formatNode(node, '#4a90d9', includeMetrics)}`);
    }
    lines.push('');
  }

  // Edges
  lines.push('  // Edges');
  for (const edge of graph.edges) {
    const weight = edge.weight ?? 1;
    const penwidth = Math.max(0.5, Math.min(5, weight));
    lines.push(
      `  ${escapeDotId(edge.source)} -- ${escapeDotId(edge.target)} ` +
      `[penwidth=${penwidth.toFixed(2)}];`
    );
  }

  lines.push('}');

  const content = lines.join('\n');
  writeFileSync(outputPath, content, 'utf-8');

  return Buffer.byteLength(content, 'utf-8');
}

function formatNode(
  node: GraphNode,
  fillColor: string,
  includeMetrics: boolean
): string {
  const id = escapeDotId(node.id);
  const label = escapeDotLabel(node.entity.name);

  // Size based on betweenness centrality
  const bc = node.betweennessCentrality ?? 0;
  const width = 0.5 + bc * 2;
  const height = 0.4 + bc * 1.5;

  let tooltip = `${node.entity.name}\\nType: ${node.entity.type}`;
  if (includeMetrics && bc > 0) {
    tooltip += `\\nBC: ${bc.toFixed(4)}`;
  }

  return `${id} [label="${label}", fillcolor="${fillColor}", width=${width.toFixed(2)}, height=${height.toFixed(2)}, tooltip="${tooltip}"];`;
}

function escapeDotId(str: string): string {
  // If contains special chars, quote it
  if (/[^a-zA-Z0-9_]/.test(str)) {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  return str;
}

function escapeDotLabel(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function getClusterColor(cluster: number): string {
  const colors = [
    '#4a90d9', '#e67e22', '#27ae60', '#e74c3c', '#9b59b6',
    '#795548', '#e91e63', '#607d8b', '#8bc34a', '#00bcd4'
  ];
  return colors[cluster % colors.length];
}
