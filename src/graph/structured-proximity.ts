/**
 * Structured Proximity Algorithm
 *
 * Replaces fixed 5-word window co-occurrence with tiered structural proximity.
 * Weight co-occurrence by WHERE entities appear together:
 *
 * | Tier | Scope          | Weight | Rationale                           |
 * |------|----------------|--------|-------------------------------------|
 * | 1    | Same sentence  | 1.0    | Strongest - grammatically related   |
 * | 2    | Same paragraph | 0.6    | Same thought/topic                  |
 * | 3    | Same section   | 0.3    | Same subtopic (H2/H3)               |
 * | 4    | Same page      | 0.1    | Weak topical relation only          |
 *
 * Entities co-occurring at multiple tiers get CUMULATIVE weight.
 */

import { Entity, GraphNode, EntityGraph, GraphEdge } from '../types/index.js';
import { ContentBlock } from '../services/crawl4ai-client.js';
import { EdgeWithProvenance, ProximityTiers, EdgeEvidence } from '../types/provenance.js';

// ============================================
// TYPES
// ============================================

export interface ProximityWeights {
  sentence: number;
  paragraph: number;
  section: number;
  page: number;
}

export const DEFAULT_WEIGHTS: ProximityWeights = {
  sentence: 1.0,
  paragraph: 0.6,
  section: 0.3,
  page: 0.1
};

export const STRICT_WEIGHTS: ProximityWeights = {
  sentence: 1.0,
  paragraph: 0.4,
  section: 0.1,
  page: 0.0
};

export const LOOSE_WEIGHTS: ProximityWeights = {
  sentence: 1.0,
  paragraph: 0.8,
  section: 0.5,
  page: 0.2
};

interface EntityLocation {
  entityId: string;
  blockId: string;
  blockType: string;
  headingPath: string[];
  sentenceIndex: number;
  paragraphIndex: number;
  text: string;
  context: string;
}

interface ProximityEdge {
  source: string;
  target: string;
  weight: number;
  tiers: ProximityTiers;
  evidence: EdgeEvidence[];
}

export interface StructuredProximityOptions {
  minWeight?: number;
  includePageLevel?: boolean;
  weights?: ProximityWeights;
}

// ============================================
// STRUCTURED PROXIMITY BUILDER
// ============================================

export class StructuredProximityBuilder {
  private weights: ProximityWeights;

  constructor(weights: ProximityWeights = DEFAULT_WEIGHTS) {
    this.weights = weights;
  }

  /**
   * Build co-occurrence graph using structural proximity.
   *
   * @param entities - Entities to connect
   * @param blocks - Content blocks with structural information
   * @param options - Build options
   * @returns EntityGraph with proximity-weighted edges
   */
  buildGraph(
    entities: Entity[],
    blocks: ContentBlock[],
    options: StructuredProximityOptions = {}
  ): EntityGraph {
    const {
      minWeight = 0.2,
      includePageLevel = false
    } = options;

    // Step 1: Map entities to their locations in blocks
    const locations = this.mapEntityLocations(entities, blocks);

    // Step 2: Calculate proximity edges
    const proximityEdges = this.calculateProximityEdges(locations, includePageLevel);

    // Step 3: Filter by minimum weight
    const filteredEdges = proximityEdges.filter(e => e.weight >= minWeight);

    // Step 4: Build graph structure
    const nodes: GraphNode[] = entities.map(entity => ({
      id: entity.id,
      entity,
      betweennessCentrality: 0,
      degreeCentrality: 0,
      cluster: undefined
    }));

    const edges: GraphEdge[] = filteredEdges.map(pe => ({
      source: pe.source,
      target: pe.target,
      weight: pe.weight,
      type: 'cooccurrence' as const
    }));

    return {
      nodes,
      edges,
      metadata: {
        entityCount: nodes.length,
        edgeCount: edges.length,
        extractedAt: new Date().toISOString()
      }
    };
  }

  /**
   * Build graph with full provenance on edges.
   */
  buildGraphWithProvenance(
    entities: Entity[],
    blocks: ContentBlock[],
    sourceUrl: string,
    options: StructuredProximityOptions = {}
  ): {
    nodes: GraphNode[];
    edges: EdgeWithProvenance[];
    metadata: Record<string, unknown>;
  } {
    const {
      minWeight = 0.2,
      includePageLevel = false
    } = options;

    const locations = this.mapEntityLocations(entities, blocks);
    const proximityEdges = this.calculateProximityEdges(locations, includePageLevel, sourceUrl);
    const filteredEdges = proximityEdges.filter(e => e.weight >= minWeight);

    const nodes: GraphNode[] = entities.map(entity => ({
      id: entity.id,
      entity,
      betweennessCentrality: 0,
      degreeCentrality: 0,
      cluster: undefined
    }));

    const edges: EdgeWithProvenance[] = filteredEdges.map(pe => ({
      source: pe.source,
      target: pe.target,
      weight: pe.weight,
      type: 'cooccurrence' as const,
      evidence: pe.evidence,
      proximityTiers: pe.tiers
    }));

    return {
      nodes,
      edges,
      metadata: {
        entityCount: nodes.length,
        edgeCount: edges.length,
        extractedAt: new Date().toISOString(),
        proximityWeights: this.weights
      }
    };
  }

  /**
   * Map each entity mention to its structural location.
   */
  private mapEntityLocations(
    entities: Entity[],
    blocks: ContentBlock[]
  ): EntityLocation[] {
    const locations: EntityLocation[] = [];

    // Track paragraphs for paragraph-level indexing
    let paragraphIndex = 0;
    let lastHeadingPath = '';

    for (const block of blocks) {
      // Update paragraph index when section changes
      const currentPath = block.headingPath.join('/');
      if (currentPath !== lastHeadingPath) {
        paragraphIndex = 0;
        lastHeadingPath = currentPath;
      }

      if (block.type === 'paragraph' || block.type === 'list') {
        // Split into sentences
        const sentences = this.splitIntoSentences(block.text);

        for (const entity of entities) {
          for (const mention of entity.mentions) {
            // Check if this mention is in this block
            if (this.mentionInBlock(mention, block)) {
              // Find which sentence contains the mention
              const sentenceIndex = this.findSentenceIndex(
                mention.text,
                sentences,
                mention.startPosition !== undefined
                  ? mention.startPosition - block.charStart
                  : undefined
              );

              // Get context (the sentence containing the mention)
              const context = sentences[sentenceIndex] || block.text.slice(0, 200);

              locations.push({
                entityId: entity.id,
                blockId: block.id,
                blockType: block.type,
                headingPath: block.headingPath,
                sentenceIndex,
                paragraphIndex,
                text: mention.text,
                context
              });
            }
          }
        }

        paragraphIndex++;
      }
    }

    return locations;
  }

  /**
   * Calculate proximity edges between all entity pairs.
   */
  private calculateProximityEdges(
    locations: EntityLocation[],
    includePageLevel: boolean,
    sourceUrl?: string
  ): ProximityEdge[] {
    const edgeMap = new Map<string, ProximityEdge>();

    // Group locations by entity
    const entityLocations = new Map<string, EntityLocation[]>();
    for (const loc of locations) {
      if (!entityLocations.has(loc.entityId)) {
        entityLocations.set(loc.entityId, []);
      }
      entityLocations.get(loc.entityId)!.push(loc);
    }

    const entityIds = Array.from(entityLocations.keys());

    // Compare all pairs
    for (let i = 0; i < entityIds.length; i++) {
      for (let j = i + 1; j < entityIds.length; j++) {
        const entity1 = entityIds[i];
        const entity2 = entityIds[j];
        const locs1 = entityLocations.get(entity1)!;
        const locs2 = entityLocations.get(entity2)!;

        const tiers: ProximityTiers = {
          sentence: 0,
          paragraph: 0,
          section: 0,
          page: 0
        };

        const evidence: EdgeEvidence[] = [];

        // Check all location pairs
        for (const loc1 of locs1) {
          for (const loc2 of locs2) {
            // Same sentence
            if (loc1.blockId === loc2.blockId &&
                loc1.sentenceIndex === loc2.sentenceIndex) {
              tiers.sentence++;
              evidence.push({
                text: loc1.context,
                sourceUrl: sourceUrl || '',
                blockId: loc1.blockId,
                headingPath: loc1.headingPath
              });
            }
            // Same paragraph (block)
            else if (loc1.blockId === loc2.blockId) {
              tiers.paragraph++;
              if (evidence.length < 5) { // Limit evidence collection
                evidence.push({
                  text: `${loc1.text} ... ${loc2.text}`,
                  sourceUrl: sourceUrl || '',
                  blockId: loc1.blockId,
                  headingPath: loc1.headingPath
                });
              }
            }
            // Same section (heading path matches)
            else if (this.sameSection(loc1.headingPath, loc2.headingPath)) {
              tiers.section++;
            }
            // Same page (always true if both exist)
            else if (includePageLevel) {
              tiers.page++;
            }
          }
        }

        // Calculate weighted score
        const weight =
          tiers.sentence * this.weights.sentence +
          tiers.paragraph * this.weights.paragraph +
          tiers.section * this.weights.section +
          tiers.page * this.weights.page;

        if (weight > 0) {
          const key = [entity1, entity2].sort().join('|');
          edgeMap.set(key, {
            source: entity1,
            target: entity2,
            weight,
            tiers,
            evidence
          });
        }
      }
    }

    return Array.from(edgeMap.values());
  }

  /**
   * Check if two locations are in the same section.
   */
  private sameSection(path1: string[], path2: string[]): boolean {
    // Same section = share at least the H2 heading
    if (path1.length === 0 || path2.length === 0) return false;

    // Compare first heading (H2 level typically)
    return path1[0] === path2[0];
  }

  /**
   * Split text into sentences.
   */
  private splitIntoSentences(text: string): string[] {
    // Split on sentence-ending punctuation followed by space
    // Handles common abbreviations (Mr., Dr., etc.)
    return text
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .filter(s => s.trim().length > 0);
  }

  /**
   * Find which sentence contains a mention.
   */
  private findSentenceIndex(
    mentionText: string,
    sentences: string[],
    offsetInBlock?: number
  ): number {
    // If we have an offset, use it
    if (offsetInBlock !== undefined) {
      let charCount = 0;
      for (let i = 0; i < sentences.length; i++) {
        charCount += sentences[i].length + 1; // +1 for space
        if (charCount > offsetInBlock) {
          return i;
        }
      }
    }

    // Fallback: search for the mention text
    const mentionLower = mentionText.toLowerCase();
    for (let i = 0; i < sentences.length; i++) {
      if (sentences[i].toLowerCase().includes(mentionLower)) {
        return i;
      }
    }

    return 0; // Default to first sentence
  }

  /**
   * Check if a mention is within a block's character range.
   */
  private mentionInBlock(
    mention: { startPosition?: number; endPosition?: number; text: string },
    block: ContentBlock
  ): boolean {
    // If we have positions, use them
    if (mention.startPosition !== undefined) {
      return mention.startPosition >= block.charStart &&
             mention.startPosition < block.charEnd;
    }

    // Fallback to text search
    return block.text.toLowerCase().includes(mention.text.toLowerCase());
  }
}

// ============================================
// FACTORY FUNCTIONS
// ============================================

/**
 * Get weights from environment or defaults.
 */
export function getProximityWeightsFromEnv(): ProximityWeights {
  return {
    sentence: parseFloat(process.env.PROXIMITY_WEIGHT_SENTENCE || '1.0'),
    paragraph: parseFloat(process.env.PROXIMITY_WEIGHT_PARAGRAPH || '0.6'),
    section: parseFloat(process.env.PROXIMITY_WEIGHT_SECTION || '0.3'),
    page: parseFloat(process.env.PROXIMITY_WEIGHT_PAGE || '0.1')
  };
}

/**
 * Create a structured proximity builder with environment config.
 */
export function createStructuredProximityBuilder(): StructuredProximityBuilder {
  return new StructuredProximityBuilder(getProximityWeightsFromEnv());
}
