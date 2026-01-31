import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';

interface GraphInput {
  nodes: Array<{
    id: string;
    entity: {
      name: string;
    };
    betweennessCentrality?: number;
    cluster?: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    weight: number;
  }>;
}

const inputSchema = {
  graph: z.object({
    nodes: z.array(z.object({
      id: z.string(),
      entity: z.object({
        name: z.string()
      }).passthrough(),
      betweennessCentrality: z.number().optional(),
      cluster: z.number().optional()
    }).passthrough()),
    edges: z.array(z.object({
      source: z.string(),
      target: z.string(),
      weight: z.number()
    }))
  }).describe('Entity graph from seo_build_entity_graph'),
  title: z.string().default('Entity Graph').describe('Visualization title'),
  width: z.number().int().min(400).max(2000).default(1200)
    .describe('Canvas width'),
  height: z.number().int().min(300).max(1500).default(800)
    .describe('Canvas height'),
  showLabels: z.boolean().default(true)
    .describe('Show entity name labels'),
  highlightBrokers: z.boolean().default(true)
    .describe('Highlight topical brokers'),
  outputPath: z.string().default('entity_graph.html')
    .describe('Output file path')
};

interface InputType {
  graph: GraphInput;
  title: string;
  width: number;
  height: number;
  showLabels: boolean;
  highlightBrokers: boolean;
  outputPath: string;
}

export function registerVisualizeTool(server: McpServer): void {
  server.tool(
    'seo_visualize_graph',
    'Generate an interactive HTML visualization of the entity graph using D3.js force layout. Nodes sized by betweenness centrality, colored by cluster.',
    inputSchema,
    async (params: InputType) => {
      const { graph, title, width, height, showLabels, highlightBrokers, outputPath } = params;

      try {
        // Prepare nodes data for D3
        const nodes = graph.nodes.map((node) => ({
          id: node.id,
          name: node.entity.name,
          bc: node.betweennessCentrality || 0,
          cluster: node.cluster || 0,
          size: Math.max(5, Math.min(30, 5 + (node.betweennessCentrality || 0) * 50))
        }));

        // Prepare edges data for D3
        const edges = graph.edges.map((edge) => ({
          source: edge.source,
          target: edge.target,
          weight: edge.weight
        }));

        // Find max BC for highlighting brokers
        const maxBC = Math.max(...nodes.map((n) => n.bc), 0.1);
        const brokerThreshold = maxBC * 0.5;

        // Generate cluster colors
        const clusters = [...new Set(nodes.map((n) => n.cluster))] as number[];
        const colorScale = generateColorScale(clusters.length);

        // Generate HTML
        const html = generateVisualizationHTML({
          title,
          width,
          height,
          nodes,
          edges,
          showLabels,
          highlightBrokers,
          brokerThreshold,
          colorScale,
          clusters
        });

        // Write to file
        const absolutePath = path.isAbsolute(outputPath)
          ? outputPath
          : path.join(process.cwd(), outputPath);

        await fs.writeFile(absolutePath, html, 'utf-8');

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              outputPath: absolutePath,
              message: `Visualization saved to ${absolutePath}`,
              stats: {
                nodeCount: nodes.length,
                edgeCount: edges.length,
                clusterCount: clusters.length,
                topBrokers: nodes
                  .filter((n) => n.bc >= brokerThreshold)
                  .sort((a, b) => b.bc - a.bc)
                  .slice(0, 5)
                  .map((n) => n.name)
              },
              instructions: 'Open the HTML file in a web browser to view the interactive graph'
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

function generateColorScale(count: number): string[] {
  const baseColors = [
    '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
    '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'
  ];

  if (count <= baseColors.length) {
    return baseColors.slice(0, count);
  }

  // Generate more colors if needed
  const colors = [...baseColors];
  for (let i = baseColors.length; i < count; i++) {
    const hue = (i * 137.5) % 360; // Golden angle for good distribution
    colors.push(`hsl(${hue}, 70%, 50%)`);
  }
  return colors;
}

interface VisualizationConfig {
  title: string;
  width: number;
  height: number;
  nodes: Array<{ id: string; name: string; bc: number; cluster: number; size: number }>;
  edges: Array<{ source: string; target: string; weight: number }>;
  showLabels: boolean;
  highlightBrokers: boolean;
  brokerThreshold: number;
  colorScale: string[];
  clusters: number[];
}

function generateVisualizationHTML(config: VisualizationConfig): string {
  const { title, width, height, nodes, edges, showLabels, highlightBrokers, brokerThreshold, colorScale } = config;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }
        h1 {
            text-align: center;
            color: #333;
            margin-bottom: 20px;
        }
        #graph-container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin: 0 auto;
            overflow: hidden;
        }
        .node {
            cursor: pointer;
        }
        .node:hover {
            stroke: #000;
            stroke-width: 2px;
        }
        .link {
            stroke: #999;
            stroke-opacity: 0.6;
        }
        .label {
            font-size: 10px;
            pointer-events: none;
            text-anchor: middle;
        }
        .broker {
            stroke: #ff0000;
            stroke-width: 3px;
        }
        .tooltip {
            position: absolute;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            pointer-events: none;
            z-index: 1000;
        }
        #legend {
            margin-top: 20px;
            text-align: center;
        }
        .legend-item {
            display: inline-block;
            margin: 0 10px;
        }
        .legend-color {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 5px;
            vertical-align: middle;
        }
        #stats {
            text-align: center;
            margin-top: 10px;
            color: #666;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <h1>${escapeHtml(title)}</h1>
    <div id="graph-container"></div>
    <div id="legend"></div>
    <div id="stats">
        Nodes: ${nodes.length} | Edges: ${edges.length} | Clusters: ${config.clusters.length}
    </div>
    <div class="tooltip" id="tooltip" style="display: none;"></div>

    <script>
        const data = {
            nodes: ${JSON.stringify(nodes)},
            links: ${JSON.stringify(edges)}
        };

        const colorScale = ${JSON.stringify(colorScale)};
        const width = ${width};
        const height = ${height};
        const showLabels = ${showLabels};
        const highlightBrokers = ${highlightBrokers};
        const brokerThreshold = ${brokerThreshold};

        // Create SVG
        const svg = d3.select("#graph-container")
            .append("svg")
            .attr("width", width)
            .attr("height", height);

        // Create tooltip
        const tooltip = d3.select("#tooltip");

        // Create force simulation
        const simulation = d3.forceSimulation(data.nodes)
            .force("link", d3.forceLink(data.links)
                .id(d => d.id)
                .distance(d => 100 / Math.sqrt(d.weight || 1)))
            .force("charge", d3.forceManyBody().strength(-200))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collision", d3.forceCollide().radius(d => d.size + 5));

        // Create links
        const link = svg.append("g")
            .selectAll("line")
            .data(data.links)
            .enter()
            .append("line")
            .attr("class", "link")
            .attr("stroke-width", d => Math.sqrt(d.weight));

        // Create nodes
        const node = svg.append("g")
            .selectAll("circle")
            .data(data.nodes)
            .enter()
            .append("circle")
            .attr("class", d => {
                let classes = "node";
                if (highlightBrokers && d.bc >= brokerThreshold) {
                    classes += " broker";
                }
                return classes;
            })
            .attr("r", d => d.size)
            .attr("fill", d => colorScale[d.cluster % colorScale.length])
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended))
            .on("mouseover", showTooltip)
            .on("mouseout", hideTooltip);

        // Create labels
        let label;
        if (showLabels) {
            label = svg.append("g")
                .selectAll("text")
                .data(data.nodes)
                .enter()
                .append("text")
                .attr("class", "label")
                .text(d => d.name.length > 15 ? d.name.substring(0, 15) + "..." : d.name)
                .attr("dy", d => d.size + 12);
        }

        // Update positions on tick
        simulation.on("tick", () => {
            link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);

            node
                .attr("cx", d => d.x = Math.max(d.size, Math.min(width - d.size, d.x)))
                .attr("cy", d => d.y = Math.max(d.size, Math.min(height - d.size, d.y)));

            if (showLabels) {
                label
                    .attr("x", d => d.x)
                    .attr("y", d => d.y);
            }
        });

        // Drag functions
        function dragstarted(event) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        }

        function dragged(event) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
        }

        function dragended(event) {
            if (!event.active) simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
        }

        // Tooltip functions
        function showTooltip(event, d) {
            tooltip
                .style("display", "block")
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 10) + "px")
                .html(\`
                    <strong>\${d.name}</strong><br>
                    Betweenness: \${d.bc.toFixed(3)}<br>
                    Cluster: \${d.cluster}
                    \${highlightBrokers && d.bc >= brokerThreshold ? '<br><em>Topical Broker</em>' : ''}
                \`);
        }

        function hideTooltip() {
            tooltip.style("display", "none");
        }

        // Build legend
        const legend = d3.select("#legend");
        const uniqueClusters = [...new Set(data.nodes.map(n => n.cluster))].sort((a, b) => a - b);
        uniqueClusters.forEach(cluster => {
            legend.append("span")
                .attr("class", "legend-item")
                .html(\`<span class="legend-color" style="background: \${colorScale[cluster % colorScale.length]}"></span>Cluster \${cluster}\`);
        });
    </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}
