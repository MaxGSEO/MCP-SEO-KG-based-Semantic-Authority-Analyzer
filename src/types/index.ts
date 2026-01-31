import type { ContentBlock } from '../services/crawl4ai-client.js';

// ============================================
// ENTITY TYPES
// ============================================

export interface Entity {
  id: string;                    // Wikidata QID or generated UUID
  name: string;                  // Canonical name
  type: EntityType;              // Classification
  wikidataId?: string;           // Q-number if available
  wikipediaUrl?: string;         // Wikipedia link
  confidence: number;            // 0-1 extraction confidence
  relevance: number;             // 0-1 relevance to document
  mentions: EntityMention[];     // All occurrences in source
  dbpediaTypes?: string[];       // DBpedia type hierarchy
  freebaseId?: string;           // Legacy Freebase ID
}

export type EntityType =
  | 'Person'
  | 'Organization'
  | 'Place'
  | 'Product'
  | 'Event'
  | 'Concept'
  | 'Technology'
  | 'CreativeWork'
  | 'MedicalCondition'
  | 'Drug'
  | 'Unknown';

export interface EntityMention {
  startPosition: number;
  endPosition: number;
  text: string;                  // Exact text in source
  sentenceIndex: number;
  context?: string;              // Surrounding text (±50 chars)
  blockId?: string;              // Block ID from structured parsing (optional)
  headingPath?: string[];        // Heading hierarchy path (optional)
}

// ============================================
// TRIPLE / RELATION TYPES
// ============================================

export interface Triple {
  subject: string;               // Entity ID
  predicate: RelationType;       // Relation type (schema-controlled)
  object: string;                // Entity ID or literal value
  confidence: number;            // 0-1 confidence score
  evidence: EvidenceSpan[];      // Source provenance
  source: 'extracted' | 'inferred'; // Origin
}

export interface EvidenceSpan {
  text: string;
  startPosition?: number;
  endPosition?: number;
  sourceUrl?: string;
  blockId?: string;
  headingPath?: string[];
}

// Allowed predicates (schema-controlled)
export const RELATION_TYPES = [
  'IS_A',
  'PART_OF',
  'LOCATED_IN',
  'WORKS_FOR',
  'FOUNDED_BY',
  'CEO_OF',
  'PRODUCES',
  'COMPETES_WITH',
  'RELATED_TO',
  'SIMILAR_TO',
  'COMPARED_TO',
  'ALTERNATIVE_TO',
  'PRICED_AT',
  'FEATURE_OF',
  'INTEGRATES_WITH',
  'REQUIRES',
  'SUPPORTS'
] as const;

export type RelationType = typeof RELATION_TYPES[number];

// ============================================
// GRAPH TYPES
// ============================================

export interface GraphNode {
  id: string;                    // Entity ID
  entity: Entity;
  // Network metrics
  betweennessCentrality?: number;
  degreeCentrality?: number;
  closenessCentrality?: number;
  eigenvectorCentrality?: number;
  diversivity?: number;          // BC / Degree ratio
  // Clustering
  cluster?: number;              // Community ID
  clusterLabel?: string;         // Human-readable cluster name
  // Visualization
  x?: number;
  y?: number;
  size?: number;
  color?: string;
}

export interface GraphEdge {
  source: string;                // Source entity ID
  target: string;                // Target entity ID
  weight?: number;               // Co-occurrence frequency or relation strength
  type?: 'cooccurrence' | 'relation';
  relationType?: RelationType | string;  // If type === 'relation'
  evidence?: EvidenceSpan[];
  proximityTiers?: {
    sentence: number;
    paragraph: number;
    section: number;
    page: number;
  };
  pmi?: number;
  npmi?: number;
}

export interface EntityGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: GraphMetadata;
}

export interface GraphMetadata {
  sourceUrl?: string;
  extractedAt: string;           // ISO timestamp
  entityCount: number;
  edgeCount: number;
  title?: string;                // Graph title
  // Global metrics
  modularity?: number;           // Community structure quality
  density?: number;              // Edge density
  averageClustering?: number;
  diameter?: number;
  // Derived insights
  topicalBrokers?: string[];     // High BC entity IDs
  hubConcepts?: string[];        // High degree entity IDs
  structuralGaps?: StructuralGap[];
}

// ============================================
// ANALYSIS TYPES
// ============================================

export interface StructuralGap {
  cluster1: ClusterInfo;
  cluster2: ClusterInfo;
  distance: number;              // 0-1, higher = more disconnected
  bridgeCandidates: BridgeCandidate[];
  contentOpportunity: string;    // AI-generated suggestion
}

export interface ClusterInfo {
  id: number;
  label?: string;
  topEntities: string[];         // Top 5 entities by BC
  size: number;                  // Node count
}

export interface BridgeCandidate {
  entityId: string;
  entityName: string;
  potentialImpact: number;       // Expected BC increase if connected
  suggestedConnections: string[]; // Entities to link to
}

export interface CentralityAnalysis {
  topicalBrokers: TopicalBroker[];
  hubConcepts: HubConcept[];
  peripheralConcepts: string[];  // Low BC, low degree
  conceptualGateways: ConceptualGateway[];
}

export interface TopicalBroker {
  entityId: string;
  name: string;
  betweennessCentrality: number;
  connectedClusters: number[];
  interpretation: string;        // Why this is a broker
}

export interface HubConcept {
  entityId: string;
  name: string;
  degree: number;
  localInfluence: number;        // Within-cluster importance
}

export interface ConceptualGateway {
  entityId: string;
  name: string;
  diversivity: number;           // BC / Degree
  accessibleClusters: number[];
  useCase: string;               // How to use for content entry
}

// ============================================
// SEO-SPECIFIC TYPES
// ============================================

export interface Page {
  url: string;
  canonicalUrl?: string;
  title: string;
  metaDescription?: string;
  h1?: string;
  wordCount: number;
  publishDate?: string;
  lastModified?: string;
  schemaOrgTypes?: string[];
}

export interface SERPAnalysis {
  keyword: string;
  searchIntent: 'informational' | 'commercial' | 'transactional' | 'navigational';
  analyzedUrls: string[];
  // Entity analysis
  consensusEntities: ConsensusEntity[];
  differentiationEntities: DifferentiationEntity[];
  entityCoverageMatrix: EntityCoverageMatrix;
  // Structural analysis
  topicalClusters: TopicalCluster[];
  averageEntityCount: number;
  entityDiversity: number;
}

export interface ConsensusEntity {
  entity: Entity;
  coverage: number;              // Fraction of top results mentioning it
  averageProminence: number;     // Average BC across pages
  required: boolean;             // Coverage > 0.7
}

export interface DifferentiationEntity {
  entity: Entity;
  foundIn: string[];             // URLs where found
  uniqueTo?: string;             // URL if only found in one page
  competitiveAdvantage: string;  // Why this differentiates
}

export interface EntityCoverageMatrix {
  entities: string[];            // Entity IDs
  pages: string[];               // URLs
  coverage: boolean[][];         // [entity][page]
  prominence: number[][];        // [entity][page] BC scores
}

export interface TopicalCluster {
  id: number;
  label: string;
  coreEntities: string[];
  coverage: number;              // Fraction of pages with this cluster
  importance: number;            // Average prominence
}

// ============================================
// CONTENT GENERATION TYPES
// ============================================

export interface ContentBrief {
  targetKeyword: string;
  searchIntent: string;
  // Entity requirements
  requiredEntities: EntityRequirement[];
  recommendedEntities: EntityRequirement[];
  differentiationOpportunities: DifferentiationOpportunity[];
  // Structure
  topicalBrokers: string[];
  suggestedOutline: OutlineSection[];
  // Gaps
  contentGaps: ContentGap[];
  internalLinkingSuggestions: InternalLink[];
  // Metrics
  targetEntityCount: number;
  targetEntityDiversity: number;
  competitorBenchmarks: CompetitorBenchmark[];
}

export interface EntityRequirement {
  entityId: string;
  name: string;
  type: EntityType;
  priority: 'high' | 'medium' | 'low';
  coverage: string;              // e.g., "9/10 competitors"
  suggestedContext: string;      // How to mention it
  relatedEntities: string[];     // Entities to co-mention
}

export interface DifferentiationOpportunity {
  entity: Entity;
  yourCoverage: boolean;
  competitorCoverage: number;    // 0-1
  opportunity: string;           // Why to add this
  expectedImpact: 'high' | 'medium' | 'low';
}

export interface ContentGap {
  topic: string;
  missingEntities: string[];
  competitorExamples: string[];  // URLs covering this
  suggestedContent: string;
}

export interface OutlineSection {
  heading: string;
  targetEntities: string[];
  suggestedWordCount: number;
  notes: string;
}

export interface InternalLink {
  fromUrl: string;
  toUrl: string;
  anchorEntity: string;          // Entity to use as anchor
  reason: string;
}

export interface CompetitorBenchmark {
  url: string;
  position: number;
  entityCount: number;
  uniqueEntities: string[];
  topicalCoverage: number;
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface ExtractionResult {
  success: boolean;
  sourceUrl?: string;
  sourceText?: string;           // Preview/snippet
  sourceTextFull?: string;       // Full cleaned text for downstream graph building
  fitMarkdown?: string;          // Crawl4AI fit_markdown (if available)
  blocks?: ContentBlock[];       // Crawl4AI blocks (if available)
  crawlMethod?: 'crawl4ai' | 'legacy';
  warnings?: string[];
  entities: Entity[];
  triples: Triple[];
  topics: string[];
  questionsAnswered: string[];
  extractionTime: number;        // ms
  errors?: string[];
}

export interface GraphAnalysisResult {
  success: boolean;
  graph: EntityGraph;
  analysis: CentralityAnalysis;
  visualizationUrl?: string;
  analysisTime: number;          // ms
}

export interface SERPComparisonResult {
  success: boolean;
  keyword: string;
  analysis: SERPAnalysis;
  brief: ContentBrief;
  errors?: string[];
}

// ============================================
// TEXTRAZOR TYPES
// ============================================

export interface TextRazorResponse {
  language: string;
  languageIsReliable: boolean;
  entities?: TextRazorEntity[];
  topics?: TextRazorTopic[];
  relations?: TextRazorRelation[];
  sentences?: TextRazorSentence[];
  cleanedText?: string;
}

export interface TextRazorEntity {
  id: number;
  entityId: string;              // Canonical entity identifier
  matchedText: string;           // Text that matched
  startingPos: number;
  endingPos: number;
  type: string[];                // DBpedia types
  confidenceScore: number;       // 0-1
  relevanceScore: number;        // 0-1, relevance to document
  freebaseId?: string;
  freebaseTypes?: string[];
  wikiLink?: string;             // Wikipedia URL
  wikidataId?: string;           // Wikidata QID
  data?: Record<string, string>; // Additional Wikidata properties
}

export interface TextRazorTopic {
  id: number;
  label: string;
  score: number;                 // Relevance score 0-1
  wikiLink?: string;
  wikidataId?: string;
}

export interface TextRazorRelation {
  id: number;
  wordPositions: number[];
  params: TextRazorRelationParam[];
}

export interface TextRazorRelationParam {
  relation: string;              // 'SUBJECT', 'PREDICATE', 'OBJECT'
  wordPositions: number[];
  entities?: number[];           // Entity IDs involved
}

export interface TextRazorSentence {
  position: number;
  words: TextRazorWord[];
}

export interface TextRazorWord {
  position: number;
  startingPos: number;
  endingPos: number;
  token: string;
  lemma: string;
  partOfSpeech: string;
}
