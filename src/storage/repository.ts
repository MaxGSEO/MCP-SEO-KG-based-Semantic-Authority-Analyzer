import { getDatabase } from './sqlite.js';
import type {
  Entity, EntityGraph, GraphNode, GraphEdge
} from '../types/index.js';
import { randomUUID } from 'crypto';

// ============================================================
// ENTITY OPERATIONS
// ============================================================

export function upsertEntity(entity: Entity): string {
  const db = getDatabase();
  const id = entity.wikidataId || entity.id || randomUUID();

  db.prepare(`
    INSERT INTO entities (id, wikidata_id, name, type, wikipedia_url, dbpedia_url, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = COALESCE(excluded.name, entities.name),
      type = COALESCE(excluded.type, entities.type),
      wikipedia_url = COALESCE(excluded.wikipedia_url, entities.wikipedia_url),
      updated_at = datetime('now')
  `).run(
    id,
    entity.wikidataId || null,
    entity.name,
    entity.type,
    entity.wikipediaUrl || null,
    null, // dbpediaUrl
    null  // description
  );

  return id;
}

export function getEntityById(id: string): Entity | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM entities WHERE id = ? OR wikidata_id = ?')
    .get(id, id) as EntityRow | undefined;

  if (!row) return null;

  return rowToEntity(row);
}

export function findEntitiesByName(name: string, limit: number = 20): Entity[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM entities
    WHERE name LIKE ? COLLATE NOCASE
    ORDER BY name
    LIMIT ?
  `).all(`%${name}%`, limit) as EntityRow[];

  return rows.map(rowToEntity);
}

export function getEntitiesByType(type: string, limit: number = 100): Entity[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM entities WHERE type = ? LIMIT ?
  `).all(type, limit) as EntityRow[];

  return rows.map(rowToEntity);
}

interface EntityRow {
  id: string;
  wikidata_id: string | null;
  name: string;
  type: string;
  wikipedia_url: string | null;
  dbpedia_url: string | null;
  description: string | null;
}

const VALID_ENTITY_TYPES = new Set([
  'Person', 'Organization', 'Place', 'Product', 'Event',
  'Concept', 'Technology', 'CreativeWork', 'MedicalCondition',
  'Drug', 'Unknown'
]);

function validateEntityType(type: string): Entity['type'] {
  if (VALID_ENTITY_TYPES.has(type)) {
    return type as Entity['type'];
  }
  return 'Unknown';
}

function rowToEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    name: row.name,
    type: validateEntityType(row.type),
    wikidataId: row.wikidata_id || undefined,
    wikipediaUrl: row.wikipedia_url || undefined,
    confidence: 1,
    relevance: 1,
    mentions: []
  };
}

// ============================================================
// GRAPH OPERATIONS
// ============================================================

function computeSalienceScore(bc: number, relevance: number, mentionCount: number): number {
  const safeBc = Number.isFinite(bc) ? bc : 0;
  const safeRelevance = Number.isFinite(relevance) ? relevance : 0;
  const safeCount = Number.isFinite(mentionCount) && mentionCount >= 0 ? mentionCount : 0;
  return safeBc * 0.4 + safeRelevance * 0.3 + (Math.log(safeCount + 1) / 5) * 0.3;
}

export function saveGraph(
  graph: EntityGraph,
  sourceUrl?: string,
  sourceType: 'url' | 'text' | 'serp' | 'comparison' = 'url'
): string {
  const db = getDatabase();
  const graphId = randomUUID();

  const transaction = db.transaction(() => {
    // Insert graph metadata
    db.prepare(`
      INSERT INTO graphs (
        id, source_url, source_type, title,
        node_count, edge_count, density, modularity, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      graphId,
      sourceUrl || null,
      sourceType,
      graph.metadata?.title || null,
      graph.nodes.length,
      graph.edges.length,
      graph.metadata?.density || null,
      graph.metadata?.modularity || null,
      JSON.stringify(graph.metadata || {})
    );

    // Prepare statements
    const nodeStmt = db.prepare(`
      INSERT INTO graph_nodes (
        graph_id, entity_id,
        betweenness_centrality, degree_centrality, closeness_centrality,
        diversivity, cluster_id, cluster_label,
        mention_count, relevance, confidence, salience_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const mentionStmt = db.prepare(`
      INSERT INTO entity_mentions (
        graph_node_id, start_position, end_position,
        text, sentence_index, context
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const edgeStmt = db.prepare(`
      INSERT INTO graph_edges (
        graph_id, source_entity_id, target_entity_id,
        weight, edge_type, relation_type, evidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Insert nodes
    for (const node of graph.nodes) {
      const entityId = upsertEntity(node.entity);
      const mentionCount = node.entity.mentions?.length || 1;
      const salience = computeSalienceScore(
        node.betweennessCentrality ?? 0,
        node.entity.relevance ?? 0,
        mentionCount
      );

      const result = nodeStmt.run(
        graphId,
        entityId,
        node.betweennessCentrality ?? null,
        node.degreeCentrality ?? null,
        node.closenessCentrality ?? null,
        node.diversivity ?? null,
        node.cluster ?? null,
        node.clusterLabel ?? null,
        mentionCount,
        node.entity.relevance ?? 0,
        node.entity.confidence ?? 0,
        salience
      );

      // Insert mentions
      const graphNodeId = result.lastInsertRowid;
      if (node.entity.mentions) {
        for (const mention of node.entity.mentions) {
          mentionStmt.run(
            graphNodeId,
            mention.startPosition ?? null,
            mention.endPosition ?? null,
            mention.text,
            mention.sentenceIndex ?? null,
            mention.context ?? null
          );
        }
      }
    }

    // Insert edges
    for (const edge of graph.edges) {
      edgeStmt.run(
        graphId,
        edge.source,
        edge.target,
        edge.weight ?? 1,
        edge.type ?? 'cooccurrence',
        edge.relationType ?? null,
        edge.evidence ? JSON.stringify(edge.evidence) : null
      );
    }
  });

  transaction();
  return graphId;
}

interface GraphRow {
  id: string;
  source_url: string | null;
  source_type: string;
  title: string | null;
  node_count: number;
  edge_count: number;
  density: number | null;
  modularity: number | null;
  created_at: string;
  metadata: string | null;
}

interface GraphNodeRow {
  id: number;
  graph_id: string;
  entity_id: string;
  betweenness_centrality: number | null;
  degree_centrality: number | null;
  closeness_centrality: number | null;
  diversivity: number | null;
  cluster_id: number | null;
  cluster_label: string | null;
  mention_count: number;
  relevance: number;
  confidence: number;
  salience_score: number;
  name: string;
  type: string;
  wikidata_id: string | null;
  wikipedia_url: string | null;
  description: string | null;
}

interface MentionRow {
  text: string;
  start_position: number | null;
  end_position: number | null;
  sentence_index: number | null;
  context: string | null;
}

interface EdgeRow {
  source_entity_id: string;
  target_entity_id: string;
  weight: number;
  edge_type: string | null;
  relation_type: string | null;
  evidence: string | null;
}

export function loadGraph(graphId: string): EntityGraph | null {
  const db = getDatabase();

  // Get graph metadata
  const graphRow = db.prepare('SELECT * FROM graphs WHERE id = ?').get(graphId) as GraphRow | undefined;
  if (!graphRow) return null;

  // Load nodes with entities and mentions
  const nodeRows = db.prepare(`
    SELECT
      gn.*,
      e.name, e.type, e.wikidata_id, e.wikipedia_url, e.description
    FROM graph_nodes gn
    JOIN entities e ON gn.entity_id = e.id
    WHERE gn.graph_id = ?
    ORDER BY gn.salience_score DESC
  `).all(graphId) as GraphNodeRow[];

  // Load mentions for each node
  const mentionStmt = db.prepare(`
    SELECT * FROM entity_mentions WHERE graph_node_id = ?
  `);

  const nodes: GraphNode[] = nodeRows.map(row => {
    const mentions = mentionStmt.all(row.id) as MentionRow[];

    return {
      id: row.entity_id,
      entity: {
        id: row.entity_id,
        name: row.name,
        type: row.type as Entity['type'],
        wikidataId: row.wikidata_id || undefined,
        wikipediaUrl: row.wikipedia_url || undefined,
        confidence: row.confidence,
        relevance: row.relevance,
        mentions: mentions.map(m => ({
          text: m.text,
          startPosition: m.start_position ?? 0,
          endPosition: m.end_position ?? 0,
          sentenceIndex: m.sentence_index ?? 0,
          context: m.context || undefined
        }))
      },
      betweennessCentrality: row.betweenness_centrality ?? undefined,
      degreeCentrality: row.degree_centrality ?? undefined,
      closenessCentrality: row.closeness_centrality ?? undefined,
      diversivity: row.diversivity ?? undefined,
      cluster: row.cluster_id ?? undefined,
      clusterLabel: row.cluster_label || undefined
    };
  });

  // Load edges
  const edgeRows = db.prepare(`
    SELECT * FROM graph_edges WHERE graph_id = ?
  `).all(graphId) as EdgeRow[];

  const edges: GraphEdge[] = edgeRows.map(row => ({
    source: row.source_entity_id,
    target: row.target_entity_id,
    weight: row.weight,
    type: row.edge_type as GraphEdge['type'],
    relationType: row.relation_type || undefined,
    evidence: row.evidence ? JSON.parse(row.evidence) : undefined
  }));

  return {
    nodes,
    edges,
    metadata: {
      ...(graphRow.metadata ? JSON.parse(graphRow.metadata) : {}),
      sourceUrl: graphRow.source_url || undefined,
      extractedAt: graphRow.created_at,
      entityCount: graphRow.node_count,
      edgeCount: graphRow.edge_count,
      modularity: graphRow.modularity ?? undefined,
      density: graphRow.density ?? undefined
    }
  };
}

export function getGraphsByUrl(url: string, limit: number = 20): Array<{
  id: string;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
}> {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, created_at, node_count, edge_count
    FROM graphs
    WHERE source_url = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(url, limit) as Array<{
    id: string;
    created_at: string;
    node_count: number;
    edge_count: number;
  }>;

  return rows.map(r => ({
    id: r.id,
    createdAt: r.created_at,
    nodeCount: r.node_count,
    edgeCount: r.edge_count
  }));
}

export function deleteGraph(graphId: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM graphs WHERE id = ?').run(graphId);
  return result.changes > 0;
}

// ============================================================
// SNAPSHOT OPERATIONS (for velocity tracking)
// ============================================================

export function saveSnapshot(
  url: string,
  graphId: string,
  metadata: Record<string, unknown> = {}
): string {
  const db = getDatabase();
  const snapshotId = randomUUID();

  // Calculate snapshot stats
  const stats = db.prepare(`
    SELECT
      COUNT(*) as entity_count,
      SUM(salience_score) as total_salience,
      AVG(salience_score) as avg_salience
    FROM graph_nodes
    WHERE graph_id = ?
  `).get(graphId) as { entity_count: number; total_salience: number; avg_salience: number };

  // Get top 10 entities
  const topEntities = db.prepare(`
    SELECT entity_id
    FROM graph_nodes
    WHERE graph_id = ?
    ORDER BY salience_score DESC
    LIMIT 10
  `).all(graphId) as Array<{ entity_id: string }>;

  db.prepare(`
    INSERT INTO snapshots (
      id, url, graph_id, entity_count,
      total_salience, avg_salience, top_entities, metadata
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshotId,
    url,
    graphId,
    stats.entity_count,
    stats.total_salience,
    stats.avg_salience,
    JSON.stringify(topEntities.map(e => e.entity_id)),
    JSON.stringify(metadata)
  );

  return snapshotId;
}

export function getSnapshots(url: string, limit: number = 20): Array<{
  id: string;
  graphId: string;
  date: string;
  entityCount: number;
  totalSalience: number;
  avgSalience: number;
}> {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT
      id, graph_id, snapshot_date,
      entity_count,
      total_salience,
      avg_salience
    FROM snapshots
    WHERE url = ?
    ORDER BY snapshot_date DESC
    LIMIT ?
  `).all(url, limit) as Array<{
    id: string;
    graph_id: string;
    snapshot_date: string;
    entity_count: number;
    total_salience: number;
    avg_salience: number;
  }>;

  return rows.map(r => ({
    id: r.id,
    graphId: r.graph_id,
    date: r.snapshot_date,
    entityCount: r.entity_count,
    totalSalience: r.total_salience,
    avgSalience: r.avg_salience
  }));
}

export function getLatestSnapshot(url: string): { id: string; graphId: string; date: string } | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT id, graph_id, snapshot_date
    FROM snapshots
    WHERE url = ?
    ORDER BY snapshot_date DESC
    LIMIT 1
  `).get(url) as { id: string; graph_id: string; snapshot_date: string } | undefined;

  return row ? { id: row.id, graphId: row.graph_id, date: row.snapshot_date } : null;
}

export function getOldestSnapshot(url: string): { id: string; graphId: string; date: string } | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT id, graph_id, snapshot_date
    FROM snapshots
    WHERE url = ?
    ORDER BY snapshot_date ASC
    LIMIT 1
  `).get(url) as { id: string; graph_id: string; snapshot_date: string } | undefined;

  return row ? { id: row.id, graphId: row.graph_id, date: row.snapshot_date } : null;
}

export interface SnapshotComparison {
  added: Entity[];
  removed: Entity[];
  salienceChanges: Array<{
    entity: Entity;
    previousSalience: number;
    currentSalience: number;
    changePercent: number;
  }>;
}

export function compareSnapshots(
  snapshotId1: string,
  snapshotId2: string
): SnapshotComparison {
  const db = getDatabase();

  // Get entities from snapshot 1 (older)
  const entities1 = new Map<string, { entity: Entity; salience: number }>();
  const rows1 = db.prepare(`
    SELECT
      gn.entity_id, gn.salience_score,
      e.name, e.type, e.wikidata_id, e.wikipedia_url
    FROM snapshots s
    JOIN graph_nodes gn ON s.graph_id = gn.graph_id
    JOIN entities e ON gn.entity_id = e.id
    WHERE s.id = ?
  `).all(snapshotId1) as Array<{
    entity_id: string;
    salience_score: number;
    name: string;
    type: string;
    wikidata_id: string | null;
    wikipedia_url: string | null;
  }>;

  for (const r of rows1) {
    entities1.set(r.entity_id, {
      entity: {
        id: r.entity_id,
        name: r.name,
        type: r.type as Entity['type'],
        wikidataId: r.wikidata_id || undefined,
        wikipediaUrl: r.wikipedia_url || undefined,
        confidence: 1,
        relevance: 1,
        mentions: []
      },
      salience: r.salience_score
    });
  }

  // Get entities from snapshot 2 (newer)
  const entities2 = new Map<string, { entity: Entity; salience: number }>();
  const rows2 = db.prepare(`
    SELECT
      gn.entity_id, gn.salience_score,
      e.name, e.type, e.wikidata_id, e.wikipedia_url
    FROM snapshots s
    JOIN graph_nodes gn ON s.graph_id = gn.graph_id
    JOIN entities e ON gn.entity_id = e.id
    WHERE s.id = ?
  `).all(snapshotId2) as Array<{
    entity_id: string;
    salience_score: number;
    name: string;
    type: string;
    wikidata_id: string | null;
    wikipedia_url: string | null;
  }>;

  for (const r of rows2) {
    entities2.set(r.entity_id, {
      entity: {
        id: r.entity_id,
        name: r.name,
        type: r.type as Entity['type'],
        wikidataId: r.wikidata_id || undefined,
        wikipediaUrl: r.wikipedia_url || undefined,
        confidence: 1,
        relevance: 1,
        mentions: []
      },
      salience: r.salience_score
    });
  }

  // Calculate differences
  const added: Entity[] = [];
  const removed: Entity[] = [];
  const salienceChanges: SnapshotComparison['salienceChanges'] = [];

  // Find added and changed
  for (const [id, data2] of entities2) {
    if (!entities1.has(id)) {
      added.push(data2.entity);
    } else {
      const data1 = entities1.get(id)!;
      const change = data2.salience - data1.salience;
      if (Math.abs(change) > 0.01) {
        salienceChanges.push({
          entity: data2.entity,
          previousSalience: data1.salience,
          currentSalience: data2.salience,
          changePercent: data1.salience > 0
            ? (change / data1.salience) * 100
            : 100
        });
      }
    }
  }

  // Find removed
  for (const [id, data1] of entities1) {
    if (!entities2.has(id)) {
      removed.push(data1.entity);
    }
  }

  // Sort by absolute change
  salienceChanges.sort((a, b) =>
    Math.abs(b.changePercent) - Math.abs(a.changePercent)
  );

  return { added, removed, salienceChanges };
}

// ============================================================
// GAP ANALYSIS CACHING
// ============================================================

export function saveGapAnalysis(
  yourUrl: string,
  competitorUrls: string[],
  missingEntities: Entity[],
  uniqueEntities: Entity[],
  coverageScore: number
): string {
  const db = getDatabase();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO gap_analyses (
      id, your_url, competitor_urls,
      missing_entities, unique_entities, coverage_score
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    yourUrl,
    JSON.stringify(competitorUrls),
    JSON.stringify(missingEntities),
    JSON.stringify(uniqueEntities),
    coverageScore
  );

  return id;
}
