import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TextRazorClient, extractEntitiesFromTextRazor } from '../services/textrazor.js';
import { crawlUrl } from '../services/crawler.js';
import { buildCooccurrenceGraph } from '../graph/cooccurrence.js';
import { computeAllCentralities } from '../graph/centrality.js';
import { detectCommunities } from '../graph/communities.js';
import {
  saveGraph,
  saveSnapshot,
  getSnapshots,
  getLatestSnapshot,
  getOldestSnapshot,
  compareSnapshots,
  loadGraph
} from '../storage/repository.js';
import type { EntityGraph, GraphNode } from '../types/index.js';
import type {
  SnapshotResult,
  CompareResult,
  TrendResult,
  VolatileEntity
} from '../types/addon.js';

const inputSchema = {
  url: z.string().url().describe('URL to track'),
  action: z.enum(['snapshot', 'compare', 'trend'])
    .describe('snapshot: save current state, compare: diff two snapshots, trend: analyze over time'),

  graph: z.any().optional()
    .describe('For snapshot: EntityGraph to save (if not provided, extracts fresh)'),

  compareWith: z.string().optional()
    .describe("For compare: snapshot ID, 'previous', or 'oldest'"),

  limit: z.number().int().min(2).max(100).default(10)
    .describe('For trend: number of snapshots to analyze')
};

interface InputType {
  url: string;
  action: 'snapshot' | 'compare' | 'trend';
  graph?: EntityGraph;
  compareWith?: string;
  limit: number;
}

export function registerVelocityTool(server: McpServer): void {
  server.tool(
    'seo_entity_velocity',
    `Track entity coverage changes over time.

Actions:
- snapshot: Save current entity state to SQLite
- compare: Diff two snapshots (added/removed/changed entities)
- trend: Analyze patterns across multiple snapshots

Uses SQLite for persistence. Snapshots stored with timestamps.`,
    inputSchema,
    async (params: InputType) => {
      const { url, action, graph, compareWith, limit } = params;

      try {
        switch (action) {
          case 'snapshot':
            return await handleSnapshot(url, graph);
          case 'compare':
            return await handleCompare(url, compareWith);
          case 'trend':
            return await handleTrend(url, limit);
          default:
            throw new Error(`Unknown action: ${action}`);
        }
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

async function handleSnapshot(url: string, providedGraph?: EntityGraph) {
  let graph: EntityGraph;

  if (providedGraph) {
    graph = providedGraph;
  } else {
    // Extract fresh
    console.error(`Extracting entities from ${url}...`);
    const client = new TextRazorClient();
    const crawlResult = await crawlUrl(url);

    if (!crawlResult.success) {
      throw new Error(`Failed to crawl URL: ${crawlResult.error}`);
    }

    const { entities, cleanedText } = await extractEntitiesFromTextRazor(
      client,
      crawlResult.content,
      'text',
      0.3
    );

    // Build graph
    const cooccurrenceGraph = buildCooccurrenceGraph(entities, cleanedText, { minWeight: 2 });

    // Compute metrics
    const centralities = computeAllCentralities(cooccurrenceGraph);
    const communities = detectCommunities(cooccurrenceGraph);

    // Create EntityGraph
    const nodes: GraphNode[] = entities.map(entity => ({
      id: entity.id,
      entity,
      betweennessCentrality: centralities.betweenness.get(entity.id),
      degreeCentrality: centralities.degree.get(entity.id),
      closenessCentrality: centralities.closeness.get(entity.id),
      diversivity: centralities.diversivity.get(entity.id),
      cluster: communities.get(entity.id)
    }));

    const edges = Array.from(cooccurrenceGraph.edges.entries()).flatMap(([source, targets]) =>
      Array.from(targets.entries()).map(([target, weight]) => ({
        source,
        target,
        weight,
        type: 'cooccurrence' as const
      }))
    ).filter(e => e.source < e.target); // Undirected, avoid duplicates

    graph = {
      nodes,
      edges,
      metadata: {
        sourceUrl: url,
        extractedAt: new Date().toISOString(),
        entityCount: nodes.length,
        edgeCount: edges.length
      }
    };
  }

  // Save to SQLite
  const graphId = saveGraph(graph, url, 'url');
  const snapshotId = saveSnapshot(url, graphId);

  // Get top entities
  const sortedNodes = [...graph.nodes].sort((a, b) =>
    (b.betweennessCentrality ?? 0) - (a.betweennessCentrality ?? 0)
  );

  const result: SnapshotResult = {
    snapshotId,
    url,
    timestamp: new Date().toISOString(),
    entityCount: graph.nodes.length,
    totalSalience: graph.nodes.reduce((sum, n) =>
      sum + (n.betweennessCentrality ?? 0) * 0.4 + (n.entity.relevance ?? 0) * 0.3, 0
    ),
    topEntities: sortedNodes.slice(0, 10).map(n => n.entity.name)
  };

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        action: 'snapshot',
        result,
        message: `Snapshot saved with ID: ${snapshotId}`
      }, null, 2)
    }]
  };
}

async function handleCompare(url: string, compareWith?: string) {
  // Get latest snapshot
  const latest = getLatestSnapshot(url);
  if (!latest) {
    throw new Error(`No snapshots found for URL: ${url}`);
  }

  // Determine comparison snapshot
  let compareSnapshot: { id: string; graphId: string; date: string } | null = null;

  if (!compareWith || compareWith === 'previous') {
    const snapshots = getSnapshots(url, 2);
    if (snapshots.length < 2) {
      throw new Error('Need at least 2 snapshots to compare. Use action=snapshot first.');
    }
    compareSnapshot = { id: snapshots[1].id, graphId: snapshots[1].graphId, date: snapshots[1].date };
  } else if (compareWith === 'oldest') {
    compareSnapshot = getOldestSnapshot(url);
  } else {
    // Assume it's a snapshot ID
    compareSnapshot = { id: compareWith, graphId: '', date: '' };
    // We'll just use the ID
  }

  if (!compareSnapshot) {
    throw new Error('Could not find comparison snapshot');
  }

  // Compare snapshots
  const comparison = compareSnapshots(compareSnapshot.id, latest.id);

  // Calculate days between
  const date1 = new Date(compareSnapshot.date || latest.date);
  const date2 = new Date(latest.date);
  const daysBetween = Math.ceil((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24));

  const result: CompareResult = {
    snapshot1: { id: compareSnapshot.id, date: compareSnapshot.date || 'unknown' },
    snapshot2: { id: latest.id, date: latest.date },
    daysBetween: Math.abs(daysBetween),
    addedEntities: comparison.added,
    removedEntities: comparison.removed,
    salienceChanges: comparison.salienceChanges.map(c => ({
      entity: c.entity,
      previousSalience: c.previousSalience,
      currentSalience: c.currentSalience,
      changePercent: c.changePercent
    })),
    summary: {
      added: comparison.added.length,
      removed: comparison.removed.length,
      increased: comparison.salienceChanges.filter(c => c.changePercent > 0).length,
      decreased: comparison.salienceChanges.filter(c => c.changePercent < 0).length
    }
  };

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        action: 'compare',
        result,
        insights: generateCompareInsights(result)
      }, null, 2)
    }]
  };
}

async function handleTrend(url: string, limit: number) {
  const snapshots = getSnapshots(url, limit);

  if (snapshots.length < 2) {
    throw new Error(`Need at least 2 snapshots for trend analysis. Found: ${snapshots.length}`);
  }

  // Load all graphs
  const graphs: Array<{ date: string; entityIds: Set<string>; salienceMap: Map<string, number> }> = [];

  for (const snapshot of snapshots) {
    const graph = loadGraph(snapshot.graphId);
    if (graph) {
      const salienceMap = new Map<string, number>();
      for (const node of graph.nodes) {
        const salience = (node.betweennessCentrality ?? 0) * 0.4 +
          (node.entity.relevance ?? 0) * 0.3 +
          (Math.log((node.entity.mentions?.length ?? 1) + 1) / 5) * 0.3;
        salienceMap.set(node.id, salience);
      }
      graphs.push({
        date: snapshot.date,
        entityIds: new Set(graph.nodes.map(n => n.id)),
        salienceMap
      });
    }
  }

  // Find stable entities (in all snapshots)
  const allEntityIds = new Set<string>();
  for (const g of graphs) {
    for (const id of g.entityIds) {
      allEntityIds.add(id);
    }
  }

  const entityPresence = new Map<string, number>();
  const entitySaliences = new Map<string, number[]>();

  for (const id of allEntityIds) {
    let count = 0;
    const saliences: number[] = [];
    for (const g of graphs) {
      if (g.entityIds.has(id)) {
        count++;
        saliences.push(g.salienceMap.get(id) ?? 0);
      } else {
        saliences.push(0);
      }
    }
    entityPresence.set(id, count);
    entitySaliences.set(id, saliences);
  }

  // Stable entities
  const stableIds = Array.from(entityPresence.entries())
    .filter(([, count]) => count === graphs.length)
    .map(([id]) => id);

  // Volatile entities
  const volatileEntities: VolatileEntity[] = [];
  for (const [id, count] of entityPresence) {
    if (count > 0 && count < graphs.length) {
      const saliences = entitySaliences.get(id) ?? [];
      const nonZeroSaliences = saliences.filter(s => s > 0);
      const avg = nonZeroSaliences.reduce((a, b) => a + b, 0) / nonZeroSaliences.length;
      const variance = nonZeroSaliences.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / nonZeroSaliences.length;

      volatileEntities.push({
        entity: { id, name: id, type: 'Unknown', confidence: 1, relevance: 1, mentions: [] },
        presenceRate: count / graphs.length,
        avgSalience: avg,
        salienceVariance: variance
      });
    }
  }

  // Trending up/down (compare first and last)
  const trendingUp: string[] = [];
  const trendingDown: string[] = [];

  if (graphs.length >= 2) {
    const first = graphs[graphs.length - 1]; // Oldest
    const last = graphs[0]; // Most recent

    for (const id of allEntityIds) {
      const oldSalience = first.salienceMap.get(id) ?? 0;
      const newSalience = last.salienceMap.get(id) ?? 0;

      if (newSalience > oldSalience * 1.2 && newSalience > 0.1) {
        trendingUp.push(id);
      } else if (oldSalience > newSalience * 1.2 && oldSalience > 0.1) {
        trendingDown.push(id);
      }
    }
  }

  const result: TrendResult = {
    url,
    snapshotCount: snapshots.length,
    dateRange: {
      from: snapshots[snapshots.length - 1].date,
      to: snapshots[0].date
    },
    stableEntities: stableIds.map(id => ({
      id,
      name: id,
      type: 'Unknown' as const,
      confidence: 1,
      relevance: 1,
      mentions: []
    })),
    volatileEntities: volatileEntities.slice(0, 15),
    trendingUp: trendingUp.map(id => ({
      id,
      name: id,
      type: 'Unknown' as const,
      confidence: 1,
      relevance: 1,
      mentions: []
    })),
    trendingDown: trendingDown.map(id => ({
      id,
      name: id,
      type: 'Unknown' as const,
      confidence: 1,
      relevance: 1,
      mentions: []
    })),
    coverageTrend: graphs.map(g => g.entityIds.size).reverse()
  };

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        action: 'trend',
        result,
        summary: {
          snapshotCount: snapshots.length,
          stableCount: stableIds.length,
          volatileCount: volatileEntities.length,
          trendingUpCount: trendingUp.length,
          trendingDownCount: trendingDown.length
        }
      }, null, 2)
    }]
  };
}

function generateCompareInsights(result: CompareResult): string[] {
  const insights: string[] = [];

  if (result.addedEntities.length > 0) {
    insights.push(
      `${result.addedEntities.length} new entities added since previous snapshot`
    );
  }

  if (result.removedEntities.length > 0) {
    insights.push(
      `${result.removedEntities.length} entities removed since previous snapshot`
    );
  }

  const bigIncreases = result.salienceChanges.filter(c => c.changePercent > 50);
  if (bigIncreases.length > 0) {
    insights.push(
      `${bigIncreases.length} entities significantly increased in salience`
    );
  }

  const bigDecreases = result.salienceChanges.filter(c => c.changePercent < -50);
  if (bigDecreases.length > 0) {
    insights.push(
      `${bigDecreases.length} entities significantly decreased in salience`
    );
  }

  if (result.addedEntities.length === 0 && result.removedEntities.length === 0) {
    insights.push('Content entity coverage is stable between snapshots');
  }

  return insights;
}
