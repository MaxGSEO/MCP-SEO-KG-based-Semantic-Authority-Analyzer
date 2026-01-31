import { Entity } from './index.js';

// ============================================================
// GAP ANALYSIS TYPES
// ============================================================

export type EntityPriority = 'critical' | 'high' | 'medium' | 'low';

export interface MissingEntity {
  entity: Entity;
  coverageScore: number;        // 0-1, fraction of competitors
  competitorCount: number;
  competitors: string[];        // URLs that have this entity
  priority: EntityPriority;
  suggestedContext: string;     // How to incorporate
}

export interface UniqueEntity {
  entity: Entity;
  uniquenessScore: number;      // 0-1, higher = more unique
  competitiveAdvantage: string;
}

export interface CoverageMatrix {
  entities: string[];           // Entity names
  urls: string[];               // All URLs analyzed
  matrix: boolean[][];          // [entity][url] presence
}

export interface GapAnalysisResult {
  yourUrl: string;
  competitorUrls: string[];
  missingEntities: MissingEntity[];
  yourUniqueEntities?: UniqueEntity[];
  coverageMatrix: CoverageMatrix;
  overallGapScore: number;      // 0-1, lower = more gaps
  recommendations: string[];
}

// ============================================================
// DIFFERENTIATION TYPES
// ============================================================

export type TopicRole = 'core' | 'supporting' | 'differentiator';
export type ImpactLevel = 'high' | 'medium' | 'low';

export interface DifferentiatingEntity {
  entity: Entity;
  exclusivityScore: number;     // 1 = only focus page has it
  topicRole: TopicRole;
  potentialImpact: ImpactLevel;
}

export interface DifferentiationResult {
  focusUrl: string;
  focusPosition: number;
  uniqueEntities: DifferentiatingEntity[];
  sharedWithTop3: Entity[];
  sharedWithAll: Entity[];      // Consensus entities
  differentiationScore: number; // 0-1, higher = more unique
  insights: string[];
}

// ============================================================
// SALIENCE MAP TYPES
// ============================================================

export interface SalienceWeights {
  betweenness: number;
  relevance: number;
  frequency: number;
}

export interface SalienceEntity {
  name: string;
  type: string;
  salienceScore: number;
  components: {
    bc: number;
    relevance: number;
    frequency: number;
  };
  cluster?: number;
}

export interface SalienceMapResult {
  outputPath: string;
  entityCount: number;
  topEntities: SalienceEntity[];
  clusterCount: number;
}

// ============================================================
// VELOCITY TYPES
// ============================================================

export type VelocityAction = 'snapshot' | 'compare' | 'trend';

export interface SnapshotResult {
  snapshotId: string;
  url: string;
  timestamp: string;
  entityCount: number;
  totalSalience: number;
  topEntities: string[];
}

export interface SalienceChange {
  entity: Entity;
  previousSalience: number;
  currentSalience: number;
  changePercent: number;
}

export interface CompareResult {
  snapshot1: { id: string; date: string };
  snapshot2: { id: string; date: string };
  daysBetween: number;
  addedEntities: Entity[];
  removedEntities: Entity[];
  salienceChanges: SalienceChange[];
  summary: {
    added: number;
    removed: number;
    increased: number;
    decreased: number;
  };
}

export interface VolatileEntity {
  entity: Entity;
  presenceRate: number;         // % of snapshots
  avgSalience: number;
  salienceVariance: number;
}

export interface TrendResult {
  url: string;
  snapshotCount: number;
  dateRange: { from: string; to: string };
  stableEntities: Entity[];     // Present in all snapshots
  volatileEntities: VolatileEntity[];
  trendingUp: Entity[];
  trendingDown: Entity[];
  coverageTrend: number[];      // Entity count per snapshot
}

// ============================================================
// EXPORT TYPES
// ============================================================

export type ExportFormat = 'gexf' | 'graphml' | 'csv' | 'cypher' | 'dot' | 'html';
export type CypherMode = 'create' | 'merge';

export interface ExportOptions {
  includeMetrics?: boolean;
  includeClusters?: boolean;
  includeEvidence?: boolean;

  // Cypher-specific
  cypherMode?: CypherMode;
  neo4jLabels?: string[];
  neo4jRelType?: string;

  // HTML-specific
  title?: string;
  darkMode?: boolean;
  showSidePanel?: boolean;
}

export interface ExportResult {
  format: ExportFormat;
  outputPath: string;
  fileSize: number;
  nodeCount: number;
  edgeCount: number;
  additionalFiles?: string[];   // For CSV (nodes.csv, edges.csv)
}
