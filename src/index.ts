#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerExtractTool } from './tools/extract.js';
import { registerGraphTool } from './tools/graph.js';
import { registerAnalysisTool } from './tools/analysis.js';
import { registerGapsTool } from './tools/gaps.js';
import { registerCompareTool } from './tools/compare.js';
import { registerBriefTool } from './tools/brief.js';
import { registerVisualizeTool } from './tools/visualize.js';

// Addon tools
import { registerEntityGapsTool } from './tools/entity-gaps.js';
import { registerDifferentiationTool } from './tools/differentiation.js';
import { registerSalienceMapTool } from './tools/salience-map.js';
import { registerVelocityTool } from './tools/velocity.js';
import { registerExportTool } from './tools/export.js';

// Phase 2 tools
import { registerCrawlTool, registerBatchCrawlTool } from './tools/crawl.js';
import { registerRelationsTool, registerRelationsFromTextTool } from './tools/relations.js';

// Create the MCP server
const server = new McpServer({
  name: 'seo-semantic-mcp',
  version: '1.0.0',
  description: 'Semantic SEO analysis with entity extraction, knowledge graphs, and betweenness centrality metrics'
});

// Register base tools
registerExtractTool(server);
registerGraphTool(server);
registerAnalysisTool(server);
registerGapsTool(server);
registerCompareTool(server);
registerBriefTool(server);
registerVisualizeTool(server);

// Register addon tools
registerEntityGapsTool(server);
registerDifferentiationTool(server);
registerSalienceMapTool(server);
registerVelocityTool(server);
registerExportTool(server);

// Register Phase 2 tools
registerCrawlTool(server);
registerBatchCrawlTool(server);
registerRelationsTool(server);
registerRelationsFromTextTool(server);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('SEO Semantic MCP server running on stdio');
  console.error('Available tools:');
  console.error('  Base tools:');
  console.error('    - seo_extract_entities: Extract named entities from URL/text');
  console.error('    - seo_build_entity_graph: Build co-occurrence graph');
  console.error('    - seo_analyze_centrality: Analyze graph centrality metrics');
  console.error('    - seo_detect_gaps: Detect structural gaps in entity graph');
  console.error('    - seo_compare_serp: Compare entity coverage across SERP results');
  console.error('    - seo_generate_brief: Generate content brief from analysis');
  console.error('    - seo_visualize_graph: Create HTML visualization');
  console.error('  Addon tools:');
  console.error('    - seo_find_entity_gaps: Compare your page vs competitors for missing entities');
  console.error('    - seo_differentiation_analysis: Analyze what makes top SERP pages unique');
  console.error('    - seo_entity_salience_map: Interactive HTML visualization of entity importance');
  console.error('    - seo_entity_velocity: Track entity coverage changes over time');
  console.error('    - seo_export_graph: Export to GEXF, GraphML, CSV, Cypher, DOT, HTML');
  console.error('  Phase 2 tools (robustness upgrades):');
  console.error('    - seo_crawl_page: Crawl URL with Crawl4AI (fit_markdown, structured blocks)');
  console.error('    - seo_batch_crawl: Crawl multiple URLs with rate limiting');
  console.error('    - seo_extract_relations: Extract typed relations using NuExtract 2.0');
  console.error('    - seo_extract_relations_text: Extract relations from plain text');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
