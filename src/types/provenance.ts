/**
 * Provenance Types for Phase 2
 *
 * Evidence-first data model for auditable extractions.
 * Every entity and edge must be traceable to a specific source location with evidence.
 */

import { Entity, EntityMention, GraphEdge } from './index.js';
import { ContentBlock } from '../services/crawl4ai-client.js';

// ============================================
// EXTRACTOR TYPES
// ============================================

export type ExtractorSource = 'textrazor' | 'nuextract' | 'ensemble';

// ============================================
// PROVENANCE TYPES
// ============================================

/**
 * Provenance information for any extracted data.
 * Links every extraction to its source location and evidence.
 */
export interface Provenance {
  /** URL of the source document */
  sourceUrl: string;

  /** Block ID within the document (from Crawl4AI) */
  blockId: string;

  /** Heading hierarchy path, e.g. ["H2:Technical SEO", "H3:Core Web Vitals"] */
  headingPath: string[];

  /** Character offset in original document */
  charStart?: number;
  charEnd?: number;

  /** Verbatim evidence text supporting the extraction */
  evidence: string;

  /** Which extractor found this */
  extractor: ExtractorSource;

  /** Confidence score (0-1) */
  confidence: number;

  /** Timestamp of extraction (ISO format) */
  extractedAt: string;
}

// ============================================
// ENTITY WITH PROVENANCE
// ============================================

/**
 * Extended entity mention with block-level location.
 */
export interface EntityMentionWithProvenance extends EntityMention {
  /** Block ID where mention was found */
  blockId?: string;

  /** Heading hierarchy at mention location */
  headingPath?: string[];

  /** Surrounding text context (typically the sentence) */
  context?: string;
}

/**
 * Extended Entity with full provenance tracking.
 */
export interface EntityWithProvenance extends Entity {
  /** Full provenance for primary extraction */
  provenance: Provenance;

  /** Track which extractors found this entity */
  extractors: {
    textrazor: boolean;
    nuextract: boolean;
  };

  /** Extended mentions with provenance */
  mentions: EntityMentionWithProvenance[];
}

/**
 * Ensemble entity with agreement tracking.
 */
export interface EnsembleEntity extends EntityWithProvenance {
  /** Confidence after ensemble agreement logic */
  ensembleConfidence: number;

  /** Which extractors agreed on this entity */
  agreementLevel: 'both' | 'textrazor_only' | 'nuextract_only';
}

// ============================================
// TRIPLE/RELATION WITH EVIDENCE
// ============================================

/**
 * Controlled predicates for relations.
 * Use these to ensure consistent relation types.
 */
export const RELATION_PREDICATES = [
  'defines',       // X defines Y
  'includes',      // X includes Y
  'requires',      // X requires Y
  'causes',        // X causes Y
  'improves',      // X improves Y
  'compares_to',   // X compares to Y
  'uses',          // X uses Y
  'part_of',       // X is part of Y
  'located_in',    // X is located in Y
  'measures',      // X measures Y
  'created_by',    // X created by Y
  'affects',       // X affects Y
  'enables',       // X enables Y
  'prevents',      // X prevents Y
  'produces'       // X produces Y
] as const;

export type RelationPredicate = typeof RELATION_PREDICATES[number];

export type Polarity = 'positive' | 'negative' | 'neutral';
export type Modality = 'asserted' | 'hypothetical' | 'recommendation';

/**
 * Evidence for a triple/relation.
 */
export interface RelationEvidence {
  /** Verbatim text supporting the relation */
  text: string;

  /** Source URL */
  sourceUrl: string;

  /** Block ID where found */
  blockId: string;

  /** Heading hierarchy */
  headingPath: string[];
}

/**
 * Triple/Relation with full evidence provenance.
 */
export interface TripleWithEvidence {
  /** Subject entity ID */
  subject: string;

  /** Controlled predicate */
  predicate: RelationPredicate | string;

  /** Object entity ID */
  object: string;

  /** Evidence supporting this relation */
  evidence: RelationEvidence;

  /** Sentiment of the relation */
  polarity: Polarity;

  /** Assertion type */
  modality: Modality;

  /** Confidence score (0-1) */
  confidence: number;

  /** Which extractor found this */
  extractor: ExtractorSource;
}

// ============================================
// GRAPH EDGE WITH PROVENANCE
// ============================================

/**
 * Proximity tier counts for structured proximity edges.
 */
export interface ProximityTiers {
  /** Co-occurrences in same sentence */
  sentence: number;

  /** Co-occurrences in same paragraph */
  paragraph: number;

  /** Co-occurrences in same section */
  section: number;

  /** Co-occurrences on same page */
  page: number;
}

/**
 * Evidence instance for an edge.
 */
export interface EdgeEvidence {
  /** Verbatim text containing both entities */
  text: string;

  /** Source URL */
  sourceUrl: string;

  /** Block ID */
  blockId: string;

  /** Heading hierarchy */
  headingPath: string[];
}

/**
 * Graph edge with full provenance.
 */
export interface EdgeWithProvenance extends Omit<GraphEdge, 'evidence'> {
  /** Edge type: cooccurrence (proximity) or relation (semantic) */
  type: 'cooccurrence' | 'relation';

  /** For relation edges: the predicate */
  relationType?: string;

  /** Evidence array (can have multiple supporting instances) */
  evidence: EdgeEvidence[];

  /** Proximity breakdown (for cooccurrence edges) */
  proximityTiers?: ProximityTiers;

  /** PMI score if calculated */
  pmi?: number;

  /** Normalized PMI score if calculated */
  npmi?: number;
}

// ============================================
// EXTRACTION RESULT TYPES
// ============================================

/**
 * Result from entity extraction with provenance.
 */
export interface EntityExtractionResult {
  /** Source URL */
  sourceUrl: string;

  /** Entities with full provenance */
  entities: EntityWithProvenance[];

  /** Total entities found */
  entityCount: number;

  /** Extraction timestamp */
  extractedAt: string;

  /** Extractor used */
  extractor: ExtractorSource;
}

/**
 * Result from relation extraction.
 */
export interface RelationExtractionResult {
  /** Source URL */
  sourceUrl: string;

  /** Entities found (for reference) */
  entities: EntityWithProvenance[];

  /** Relations/triples with evidence */
  relations: TripleWithEvidence[];

  /** Extraction timestamp */
  extractedAt: string;
}

/**
 * Combined extraction result with ensemble agreement.
 */
export interface EnsembleExtractionResult {
  /** Source URL */
  sourceUrl: string;

  /** Ensemble-merged entities */
  entities: EnsembleEntity[];

  /** Relations from NuExtract */
  relations: TripleWithEvidence[];

  /** Stats */
  stats: {
    textrazorEntities: number;
    nuextractEntities: number;
    mergedEntities: number;
    bothAgreed: number;
    textrazorOnly: number;
    nuextractOnly: number;
    relationsExtracted: number;
  };

  /** Extraction timestamp */
  extractedAt: string;
}

// ============================================
// CONTENT BLOCK TYPES (re-export for convenience)
// ============================================

export { ContentBlock } from '../services/crawl4ai-client.js';

// ============================================
// VALIDATION HELPERS
// ============================================

/**
 * Check if an entity has valid provenance.
 */
export function hasValidProvenance(entity: Partial<EntityWithProvenance>): boolean {
  return Boolean(
    entity.provenance &&
    entity.provenance.sourceUrl &&
    entity.provenance.blockId &&
    entity.provenance.evidence &&
    entity.provenance.evidence.length >= 10 &&
    entity.provenance.extractor
  );
}

/**
 * Check if a relation has valid evidence.
 */
export function hasValidEvidence(relation: Partial<TripleWithEvidence>): boolean {
  return Boolean(
    relation.evidence &&
    relation.evidence.text &&
    relation.evidence.text.length >= 10 &&
    relation.evidence.sourceUrl
  );
}

/**
 * Create a provenance object from a content block.
 */
export function createProvenance(
  block: ContentBlock,
  sourceUrl: string,
  evidence: string,
  extractor: ExtractorSource,
  confidence: number
): Provenance {
  return {
    sourceUrl,
    blockId: block.id,
    headingPath: block.headingPath,
    charStart: block.charStart,
    charEnd: block.charEnd,
    evidence,
    extractor,
    confidence,
    extractedAt: new Date().toISOString()
  };
}
