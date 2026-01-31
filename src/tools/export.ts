import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { EntityGraph } from '../types/index.js';
import type { ExportResult, ExportOptions } from '../types/addon.js';
import { exportToGEXF } from '../export/gexf.js';
import { exportToGraphML } from '../export/graphml.js';
import { exportToCSV } from '../export/csv.js';
import { exportToCypher } from '../export/cypher.js';
import { exportToDOT } from '../export/dot.js';
import { exportToHTML } from '../export/html.js';

const ExportOptionsSchema = z.object({
  includeMetrics: z.boolean().default(true)
    .describe('Include centrality metrics in export'),
  includeClusters: z.boolean().default(true)
    .describe('Include community/cluster assignments'),
  includeEvidence: z.boolean().default(false)
    .describe('Include evidence spans (increases file size)'),

  cypherMode: z.enum(['create', 'merge']).default('create')
    .describe('create: one-time import, merge: idempotent updates'),
  neo4jLabels: z.array(z.string()).default(['Entity'])
    .describe('Node labels for Neo4j'),
  neo4jRelType: z.string().default('COOCCURS_WITH')
    .describe('Relationship type for Neo4j'),

  title: z.string().optional()
    .describe('Title for HTML visualization'),
  darkMode: z.boolean().default(true)
    .describe('Use dark mode styling'),
  showSidePanel: z.boolean().default(true)
    .describe('Show side panel for entity details')
});

const inputSchema = {
  graph: z.any().describe('EntityGraph object'),
  format: z.enum(['gexf', 'graphml', 'csv', 'cypher', 'dot', 'html'])
    .describe('Export format'),
  outputPath: z.string().describe('Output file path'),
  options: ExportOptionsSchema.optional()
};

interface InputType {
  graph: EntityGraph;
  format: 'gexf' | 'graphml' | 'csv' | 'cypher' | 'dot' | 'html';
  outputPath: string;
  options?: ExportOptions;
}

export function registerExportTool(server: McpServer): void {
  server.tool(
    'seo_export_graph',
    `Export entity graph to various formats.

Supported formats:
- gexf: Gephi visualization
- graphml: Academic tools (yEd, Cytoscape, NetworkX)
- csv: Universal (nodes.csv + edges.csv)
- cypher: Neo4j import (CREATE or MERGE mode)
- dot: Graphviz diagrams
- html: Interactive browser visualization

Options control what's included (metrics, clusters, evidence).`,
    inputSchema,
    async (params: InputType) => {
      const { graph, format, outputPath, options = {} } = params;

      try {
        let fileSize: number;
        let additionalFiles: string[] | undefined;

        switch (format) {
          case 'gexf':
            fileSize = exportToGEXF(graph, outputPath, options);
            break;

          case 'graphml':
            fileSize = exportToGraphML(graph, outputPath, options);
            break;

          case 'csv': {
            const result = exportToCSV(graph, outputPath, options);
            fileSize = result.nodeSize + result.edgeSize;
            additionalFiles = result.files;
            break;
          }

          case 'cypher':
            fileSize = exportToCypher(graph, outputPath, options);
            break;

          case 'dot':
            fileSize = exportToDOT(graph, outputPath, options);
            break;

          case 'html':
            fileSize = await exportToHTML(graph, outputPath, options);
            break;

          default:
            throw new Error(`Unsupported format: ${format}`);
        }

        const result: ExportResult = {
          format,
          outputPath,
          fileSize,
          nodeCount: graph.nodes.length,
          edgeCount: graph.edges.length,
          additionalFiles
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              result,
              summary: {
                format,
                fileSize: `${(fileSize / 1024).toFixed(1)} KB`,
                nodeCount: graph.nodes.length,
                edgeCount: graph.edges.length,
                additionalFiles
              },
              instructions: getFormatInstructions(format, outputPath)
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

function getFormatInstructions(format: string, outputPath: string): string {
  switch (format) {
    case 'gexf':
      return `Open ${outputPath} in Gephi (File > Open) for rich visualization`;
    case 'graphml':
      return `Open ${outputPath} in Gephi, yEd, Cytoscape, or load with NetworkX`;
    case 'csv':
      return `Import the CSV files into Excel, pandas, or any data tool`;
    case 'cypher':
      return `Run ${outputPath} in Neo4j Browser or use neo4j-admin import`;
    case 'dot':
      return `Render with: dot -Tpng ${outputPath} -o graph.png`;
    case 'html':
      return `Open ${outputPath} in any web browser for interactive exploration`;
    default:
      return `Output saved to ${outputPath}`;
  }
}
