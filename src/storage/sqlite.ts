import Database from 'better-sqlite3';
import path from 'path';

const DEFAULT_DB_PATH = process.env.SEO_SEMANTIC_DB_PATH
  || path.join(process.cwd(), 'seo-semantic.db');

let dbInstance: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    dbInstance = initDatabase(DEFAULT_DB_PATH);
  }
  return dbInstance;
}

export function initDatabase(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  const db = new Database(dbPath);

  // Performance optimizations
  db.pragma('journal_mode = WAL');      // Better concurrency
  db.pragma('foreign_keys = ON');       // Enforce relationships
  db.pragma('synchronous = NORMAL');    // Balance safety/speed

  // Create schema
  createSchema(db);

  return db;
}

function createSchema(db: Database.Database): void {
  db.exec(`
    -- =============================================
    -- ENTITIES (deduplicated across all graphs)
    -- =============================================
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      wikidata_id TEXT UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      wikipedia_url TEXT,
      dbpedia_url TEXT,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_entities_wikidata ON entities(wikidata_id);
    CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);

    -- =============================================
    -- GRAPHS (metadata for each extracted graph)
    -- =============================================
    CREATE TABLE IF NOT EXISTS graphs (
      id TEXT PRIMARY KEY,
      source_url TEXT,
      source_type TEXT CHECK(source_type IN ('url', 'text', 'serp', 'comparison')),
      title TEXT,
      node_count INTEGER NOT NULL DEFAULT 0,
      edge_count INTEGER NOT NULL DEFAULT 0,
      density REAL,
      modularity REAL,
      avg_clustering REAL,
      created_at TEXT DEFAULT (datetime('now')),
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_graphs_source_url ON graphs(source_url);
    CREATE INDEX IF NOT EXISTS idx_graphs_created_at ON graphs(created_at DESC);

    -- =============================================
    -- GRAPH_NODES (entity instances within a graph)
    -- =============================================
    CREATE TABLE IF NOT EXISTS graph_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      graph_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,

      -- Centrality metrics
      betweenness_centrality REAL DEFAULT 0,
      degree_centrality REAL DEFAULT 0,
      closeness_centrality REAL,
      eigenvector_centrality REAL,
      diversivity REAL,

      -- Clustering
      cluster_id INTEGER,
      cluster_label TEXT,

      -- Entity-specific metrics (from extraction)
      mention_count INTEGER DEFAULT 1,
      relevance REAL DEFAULT 0,
      confidence REAL DEFAULT 0,

      -- Composite salience (computed manually since SQLite might not support GENERATED)
      salience_score REAL DEFAULT 0,

      FOREIGN KEY (graph_id) REFERENCES graphs(id) ON DELETE CASCADE,
      FOREIGN KEY (entity_id) REFERENCES entities(id),
      UNIQUE(graph_id, entity_id)
    );

    CREATE INDEX IF NOT EXISTS idx_graph_nodes_graph ON graph_nodes(graph_id);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_entity ON graph_nodes(entity_id);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_salience ON graph_nodes(salience_score DESC);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_bc ON graph_nodes(betweenness_centrality DESC);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_cluster ON graph_nodes(graph_id, cluster_id);

    -- =============================================
    -- GRAPH_EDGES (relationships between entities)
    -- =============================================
    CREATE TABLE IF NOT EXISTS graph_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      graph_id TEXT NOT NULL,
      source_entity_id TEXT NOT NULL,
      target_entity_id TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      edge_type TEXT CHECK(edge_type IN ('cooccurrence', 'relation', 'similarity')),
      relation_type TEXT,
      evidence TEXT,

      FOREIGN KEY (graph_id) REFERENCES graphs(id) ON DELETE CASCADE,
      FOREIGN KEY (source_entity_id) REFERENCES entities(id),
      FOREIGN KEY (target_entity_id) REFERENCES entities(id),
      UNIQUE(graph_id, source_entity_id, target_entity_id, edge_type)
    );

    CREATE INDEX IF NOT EXISTS idx_edges_graph ON graph_edges(graph_id);
    CREATE INDEX IF NOT EXISTS idx_edges_source ON graph_edges(source_entity_id);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON graph_edges(target_entity_id);
    CREATE INDEX IF NOT EXISTS idx_edges_weight ON graph_edges(weight DESC);

    -- =============================================
    -- SNAPSHOTS (for velocity tracking)
    -- =============================================
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      graph_id TEXT NOT NULL,
      snapshot_date TEXT DEFAULT (datetime('now')),
      entity_count INTEGER NOT NULL,
      total_salience REAL,
      avg_salience REAL,
      top_entities TEXT,
      metadata TEXT,

      FOREIGN KEY (graph_id) REFERENCES graphs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_url ON snapshots(url);
    CREATE INDEX IF NOT EXISTS idx_snapshots_date ON snapshots(url, snapshot_date DESC);

    -- =============================================
    -- ENTITY_MENTIONS (evidence/provenance)
    -- =============================================
    CREATE TABLE IF NOT EXISTS entity_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      graph_node_id INTEGER NOT NULL,
      start_position INTEGER,
      end_position INTEGER,
      text TEXT NOT NULL,
      sentence_index INTEGER,
      paragraph_index INTEGER,
      context TEXT,

      FOREIGN KEY (graph_node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mentions_node ON entity_mentions(graph_node_id);

    -- =============================================
    -- GAP_ANALYSES (cached gap analysis results)
    -- =============================================
    CREATE TABLE IF NOT EXISTS gap_analyses (
      id TEXT PRIMARY KEY,
      your_url TEXT NOT NULL,
      competitor_urls TEXT NOT NULL,
      analysis_date TEXT DEFAULT (datetime('now')),
      missing_entities TEXT,
      unique_entities TEXT,
      coverage_score REAL,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_gap_your_url ON gap_analyses(your_url);
  `);
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// Cleanup on process exit
process.on('exit', closeDatabase);
process.on('SIGINT', () => { closeDatabase(); process.exit(); });
process.on('SIGTERM', () => { closeDatabase(); process.exit(); });
