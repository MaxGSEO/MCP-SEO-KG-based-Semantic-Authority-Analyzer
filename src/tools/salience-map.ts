import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { EntityGraph } from '../types/index.js';
import type { SalienceMapResult, SalienceEntity, SalienceWeights } from '../types/addon.js';
import { exportToHTML } from '../export/html.js';

const SalienceWeightsSchema = z.object({
  betweenness: z.number().min(0).max(1).default(0.4),
  relevance: z.number().min(0).max(1).default(0.3),
  frequency: z.number().min(0).max(1).default(0.3)
}).refine(
  data => Math.abs(data.betweenness + data.relevance + data.frequency - 1) < 0.01,
  { message: 'Weights must sum to 1.0' }
);

const inputSchema = {
  graph: z.any().describe('EntityGraph object from seo_build_entity_graph'),
  title: z.string().optional().describe('Title for the visualization'),
  outputPath: z.string().describe('Path to save HTML file'),
  weights: SalienceWeightsSchema.optional()
    .describe('Custom salience weights (must sum to 1.0)'),
  highlightTop: z.number().int().min(1).max(50).default(10)
    .describe('Number of top entities to highlight')
};

interface InputType {
  graph: EntityGraph;
  title?: string;
  outputPath: string;
  weights?: SalienceWeights;
  highlightTop: number;
}

export function registerSalienceMapTool(server: McpServer): void {
  server.tool(
    'seo_entity_salience_map',
    `Generate interactive HTML visualization of entity importance.

Creates a dark-mode force-directed graph with:
- Node size = composite salience score
- Node color = cluster/community
- Side panel showing entity details on click
- Filter, search, and PNG export

Salience = weighted combination of:
- Betweenness centrality (default 40%)
- Relevance score (default 30%)
- Mention frequency (default 30%)`,
    inputSchema,
    async (params: InputType) => {
      const { graph, title, outputPath, weights, highlightTop } = params;

      try {
        // Calculate salience scores for each node
        const defaultWeights: SalienceWeights = {
          betweenness: 0.4,
          relevance: 0.3,
          frequency: 0.3
        };
        const w = weights || defaultWeights;

        const salienceEntities: SalienceEntity[] = graph.nodes.map(node => {
          const bc = Number.isFinite(node.betweennessCentrality) ? node.betweennessCentrality! : 0;
          const relevance = Number.isFinite(node.entity.relevance) ? node.entity.relevance : 0;
          const frequency = node.entity.mentions?.length ?? 1;

          const salienceScore =
            bc * w.betweenness +
            relevance * w.relevance +
            (Math.log(frequency + 1) / 5) * w.frequency;

          return {
            name: node.entity.name,
            type: node.entity.type,
            salienceScore,
            components: {
              bc,
              relevance,
              frequency
            },
            cluster: node.cluster
          };
        });

        // Sort by salience
        salienceEntities.sort((a, b) => b.salienceScore - a.salienceScore);

        // Count unique clusters
        const clusters = new Set(graph.nodes.map(n => n.cluster).filter(c => c !== undefined));

        // Generate HTML visualization
        const fileSize = await exportToHTML(graph, outputPath, {
          title: title || 'Entity Salience Map',
          darkMode: true,
          showSidePanel: true,
          includeMetrics: true
        });

        const result: SalienceMapResult = {
          outputPath,
          entityCount: graph.nodes.length,
          topEntities: salienceEntities.slice(0, highlightTop),
          clusterCount: clusters.size
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              result,
              summary: {
                fileSize: `${(fileSize / 1024).toFixed(1)} KB`,
                entityCount: graph.nodes.length,
                edgeCount: graph.edges.length,
                clusterCount: clusters.size,
                topEntity: salienceEntities[0]?.name || 'N/A',
                topSalience: salienceEntities[0]?.salienceScore.toFixed(4) || '0'
              },
              weights: w,
              instructions: `Open ${outputPath} in a web browser to view the interactive visualization`
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
