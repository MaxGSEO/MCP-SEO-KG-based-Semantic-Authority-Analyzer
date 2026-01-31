import { EntityGraph } from '../types/index.js';
import { ExportOptions } from '../types/addon.js';
import { writeFileSync } from 'fs';
import path from 'path';

export function exportToCSV(
  graph: EntityGraph,
  outputPath: string,
  options: ExportOptions = {}
): { nodeSize: number; edgeSize: number; files: string[] } {
  const {
    includeMetrics = true,
    includeClusters = true
  } = options;

  const dir = path.dirname(outputPath);
  const baseName = path.basename(outputPath, '.csv');

  const nodesPath = path.join(dir, `${baseName}_nodes.csv`);
  const edgesPath = path.join(dir, `${baseName}_edges.csv`);

  // Nodes CSV
  const nodeHeaders = ['id', 'name', 'type', 'wikidataId', 'wikipediaUrl'];
  if (includeMetrics) {
    nodeHeaders.push('betweennessCentrality', 'degreeCentrality', 'relevance', 'confidence', 'salienceScore', 'mentionCount');
  }
  if (includeClusters) {
    nodeHeaders.push('cluster');
  }

  const nodeRows = [nodeHeaders.join(',')];
  for (const node of graph.nodes) {
    const bc = Number.isFinite(node.betweennessCentrality) ? node.betweennessCentrality! : 0;
    const relevance = Number.isFinite(node.entity.relevance) ? node.entity.relevance : 0;
    const frequency = node.entity.mentions?.length ?? 1;
    const salience = bc * 0.4 + relevance * 0.3 + (Math.log(frequency + 1) / 5) * 0.3;

    const row = [
      escapeCsv(node.id),
      escapeCsv(node.entity.name),
      escapeCsv(node.entity.type),
      escapeCsv(node.entity.wikidataId || ''),
      escapeCsv(node.entity.wikipediaUrl || '')
    ];

    if (includeMetrics) {
      row.push(
        String(node.betweennessCentrality ?? ''),
        String(node.degreeCentrality ?? ''),
        String(node.entity.relevance ?? ''),
        String(node.entity.confidence ?? ''),
        String(salience.toFixed(6)),
        String(node.entity.mentions?.length ?? 1)
      );
    }

    if (includeClusters) {
      row.push(String(node.cluster ?? ''));
    }

    nodeRows.push(row.join(','));
  }

  const nodesContent = nodeRows.join('\n');
  writeFileSync(nodesPath, nodesContent, 'utf-8');

  // Edges CSV
  const edgeHeaders = ['source', 'target', 'weight', 'type'];
  const edgeRows = [edgeHeaders.join(',')];

  for (const edge of graph.edges) {
    const row = [
      escapeCsv(edge.source),
      escapeCsv(edge.target),
      String(edge.weight ?? 1),
      escapeCsv(edge.type ?? 'cooccurrence')
    ];
    edgeRows.push(row.join(','));
  }

  const edgesContent = edgeRows.join('\n');
  writeFileSync(edgesPath, edgesContent, 'utf-8');

  return {
    nodeSize: Buffer.byteLength(nodesContent, 'utf-8'),
    edgeSize: Buffer.byteLength(edgesContent, 'utf-8'),
    files: [nodesPath, edgesPath]
  };
}

function escapeCsv(str: string): string {
  if (!str) return '';
  // Handle comma, quotes, newlines, and carriage returns
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
