import { EntityGraph } from '../types/index.js';
import { ExportOptions } from '../types/addon.js';
import { writeFileSync } from 'fs';

export function exportToGraphML(
  graph: EntityGraph,
  outputPath: string,
  options: ExportOptions = {}
): number {
  const {
    includeMetrics = true,
    includeClusters = true
  } = options;

  const lines: string[] = [];

  // XML header
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<graphml xmlns="http://graphml.graphdrawing.org/xmlns"');
  lines.push('  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
  lines.push('  xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns');
  lines.push('    http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">');

  // Key definitions
  lines.push('  <key id="name" for="node" attr.name="name" attr.type="string"/>');
  lines.push('  <key id="type" for="node" attr.name="type" attr.type="string"/>');
  lines.push('  <key id="wikidataId" for="node" attr.name="wikidataId" attr.type="string"/>');
  lines.push('  <key id="wikipediaUrl" for="node" attr.name="wikipediaUrl" attr.type="string"/>');

  if (includeMetrics) {
    lines.push('  <key id="bc" for="node" attr.name="betweennessCentrality" attr.type="double"/>');
    lines.push('  <key id="dc" for="node" attr.name="degreeCentrality" attr.type="double"/>');
    lines.push('  <key id="relevance" for="node" attr.name="relevance" attr.type="double"/>');
    lines.push('  <key id="confidence" for="node" attr.name="confidence" attr.type="double"/>');
    lines.push('  <key id="salience" for="node" attr.name="salienceScore" attr.type="double"/>');
    lines.push('  <key id="mentions" for="node" attr.name="mentionCount" attr.type="int"/>');
  }

  if (includeClusters) {
    lines.push('  <key id="cluster" for="node" attr.name="cluster" attr.type="int"/>');
  }

  lines.push('  <key id="weight" for="edge" attr.name="weight" attr.type="double"/>');
  lines.push('  <key id="edgeType" for="edge" attr.name="type" attr.type="string"/>');

  // Graph
  lines.push('  <graph id="G" edgedefault="undirected">');

  // Nodes
  for (const node of graph.nodes) {
    lines.push(`    <node id="${escapeXml(node.id)}">`);
    lines.push(`      <data key="name">${escapeXml(node.entity.name)}</data>`);
    lines.push(`      <data key="type">${escapeXml(node.entity.type)}</data>`);

    if (node.entity.wikidataId) {
      lines.push(`      <data key="wikidataId">${escapeXml(node.entity.wikidataId)}</data>`);
    }
    if (node.entity.wikipediaUrl) {
      lines.push(`      <data key="wikipediaUrl">${escapeXml(node.entity.wikipediaUrl)}</data>`);
    }

    if (includeMetrics) {
      if (node.betweennessCentrality != null) {
        lines.push(`      <data key="bc">${node.betweennessCentrality}</data>`);
      }
      if (node.degreeCentrality != null) {
        lines.push(`      <data key="dc">${node.degreeCentrality}</data>`);
      }
      lines.push(`      <data key="relevance">${node.entity.relevance ?? 0}</data>`);
      lines.push(`      <data key="confidence">${node.entity.confidence ?? 0}</data>`);
      lines.push(`      <data key="mentions">${node.entity.mentions?.length ?? 1}</data>`);
    }

    if (includeClusters && node.cluster != null) {
      lines.push(`      <data key="cluster">${node.cluster}</data>`);
    }

    lines.push('    </node>');
  }

  // Edges
  let edgeId = 0;
  for (const edge of graph.edges) {
    lines.push(`    <edge id="e${edgeId++}" source="${escapeXml(edge.source)}" target="${escapeXml(edge.target)}">`);
    lines.push(`      <data key="weight">${edge.weight ?? 1}</data>`);
    if (edge.type) {
      lines.push(`      <data key="edgeType">${edge.type}</data>`);
    }
    lines.push('    </edge>');
  }

  lines.push('  </graph>');
  lines.push('</graphml>');

  const content = lines.join('\n');
  writeFileSync(outputPath, content, 'utf-8');

  return Buffer.byteLength(content, 'utf-8');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
