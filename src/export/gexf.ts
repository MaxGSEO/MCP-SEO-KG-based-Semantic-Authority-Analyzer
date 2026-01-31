import { EntityGraph } from '../types/index.js';
import { ExportOptions } from '../types/addon.js';
import { writeFileSync } from 'fs';

export function exportToGEXF(
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
  lines.push('<gexf xmlns="http://www.gexf.net/1.3" version="1.3"');
  lines.push('  xmlns:viz="http://www.gexf.net/1.3/viz"');
  lines.push('  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
  lines.push('  xsi:schemaLocation="http://www.gexf.net/1.3 http://www.gexf.net/1.3/gexf.xsd">');

  // Meta
  lines.push('  <meta lastmodifieddate="' + new Date().toISOString().split('T')[0] + '">');
  lines.push('    <creator>SEO Semantic Authority Analyzer</creator>');
  if (graph.metadata?.title) {
    lines.push(`    <description>${escapeXml(graph.metadata.title)}</description>`);
  }
  lines.push('  </meta>');

  // Graph
  lines.push('  <graph mode="static" defaultedgetype="undirected">');

  // Attributes
  lines.push('    <attributes class="node">');
  lines.push('      <attribute id="0" title="type" type="string"/>');
  lines.push('      <attribute id="1" title="wikidataId" type="string"/>');
  if (includeMetrics) {
    lines.push('      <attribute id="2" title="betweennessCentrality" type="float"/>');
    lines.push('      <attribute id="3" title="degreeCentrality" type="float"/>');
    lines.push('      <attribute id="4" title="relevance" type="float"/>');
    lines.push('      <attribute id="5" title="confidence" type="float"/>');
    lines.push('      <attribute id="6" title="salienceScore" type="float"/>');
  }
  if (includeClusters) {
    lines.push('      <attribute id="7" title="cluster" type="integer"/>');
  }
  lines.push('    </attributes>');

  // Nodes
  lines.push('    <nodes>');
  for (const node of graph.nodes) {
    const label = escapeXml(node.entity.name);
    lines.push(`      <node id="${escapeXml(node.id)}" label="${label}">`);

    // Attributes
    lines.push('        <attvalues>');
    lines.push(`          <attvalue for="0" value="${escapeXml(node.entity.type)}"/>`);
    if (node.entity.wikidataId) {
      lines.push(`          <attvalue for="1" value="${escapeXml(node.entity.wikidataId)}"/>`);
    }
    if (includeMetrics) {
      if (node.betweennessCentrality != null) {
        lines.push(`          <attvalue for="2" value="${node.betweennessCentrality.toFixed(6)}"/>`);
      }
      if (node.degreeCentrality != null) {
        lines.push(`          <attvalue for="3" value="${node.degreeCentrality.toFixed(6)}"/>`);
      }
      lines.push(`          <attvalue for="4" value="${(node.entity.relevance ?? 0).toFixed(4)}"/>`);
      lines.push(`          <attvalue for="5" value="${(node.entity.confidence ?? 0).toFixed(4)}"/>`);
    }
    if (includeClusters && node.cluster != null) {
      lines.push(`          <attvalue for="7" value="${node.cluster}"/>`);
    }
    lines.push('        </attvalues>');

    // Size based on betweenness centrality
    const size = 10 + (node.betweennessCentrality ?? 0) * 40;
    lines.push(`        <viz:size value="${size.toFixed(2)}"/>`);

    // Color based on cluster
    if (includeClusters && node.cluster != null) {
      const color = getClusterColor(node.cluster);
      lines.push(`        <viz:color r="${color.r}" g="${color.g}" b="${color.b}"/>`);
    }

    lines.push('      </node>');
  }
  lines.push('    </nodes>');

  // Edges
  lines.push('    <edges>');
  let edgeId = 0;
  for (const edge of graph.edges) {
    const weight = edge.weight ?? 1;
    lines.push(`      <edge id="${edgeId++}" source="${escapeXml(edge.source)}" target="${escapeXml(edge.target)}" weight="${weight.toFixed(4)}"/>`);
  }
  lines.push('    </edges>');

  lines.push('  </graph>');
  lines.push('</gexf>');

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

function getClusterColor(cluster: number): { r: number; g: number; b: number } {
  const colors = [
    { r: 31, g: 119, b: 180 },   // Blue
    { r: 255, g: 127, b: 14 },   // Orange
    { r: 44, g: 160, b: 44 },    // Green
    { r: 214, g: 39, b: 40 },    // Red
    { r: 148, g: 103, b: 189 },  // Purple
    { r: 140, g: 86, b: 75 },    // Brown
    { r: 227, g: 119, b: 194 },  // Pink
    { r: 127, g: 127, b: 127 },  // Gray
    { r: 188, g: 189, b: 34 },   // Olive
    { r: 23, g: 190, b: 207 }    // Cyan
  ];
  return colors[cluster % colors.length];
}
