/**
 * Relation Extractor
 *
 * Two-pass extraction using NuExtract 2.0:
 * 1. First pass: Extract entities with evidence
 * 2. Second pass: Extract relations between found entities
 */

import {
  NuExtractClient,
  ENTITY_TEMPLATE,
  RELATION_TEMPLATE,
  ExtractedEntity,
  ExtractedRelation
} from '../services/nuextract-client.js';
import { ContentBlock } from '../services/crawl4ai-client.js';
import {
  EntityWithProvenance,
  TripleWithEvidence,
  Provenance,
  RelationEvidence
} from '../types/provenance.js';
import { EntityType } from '../types/index.js';

// ============================================
// TYPES
// ============================================

interface SectionGroup {
  headingPath: string[];
  blocks: ContentBlock[];
  text: string;
}

export interface RelationExtractionResult {
  entities: EntityWithProvenance[];
  relations: TripleWithEvidence[];
  stats: {
    sectionsProcessed: number;
    entitiesFound: number;
    relationsFound: number;
    uniqueEntities: number;
    uniqueRelations: number;
  };
}

// ============================================
// RELATION EXTRACTOR
// ============================================

export class RelationExtractor {
  private client: NuExtractClient;
  private minSectionLength: number;

  constructor(client: NuExtractClient, options: { minSectionLength?: number } = {}) {
    this.client = client;
    this.minSectionLength = options.minSectionLength ?? 100;
  }

  /**
   * Two-pass extraction from content blocks.
   *
   * @param blocks - Content blocks from Crawl4AI
   * @param sourceUrl - Source URL for provenance
   * @returns Entities and relations with full provenance
   */
  async extractFromBlocks(
    blocks: ContentBlock[],
    sourceUrl: string
  ): Promise<RelationExtractionResult> {
    const allEntities: EntityWithProvenance[] = [];
    const allRelations: TripleWithEvidence[] = [];

    // Group blocks by section for context
    const sections = this.groupBySection(blocks);

    let sectionsProcessed = 0;
    let entitiesFound = 0;
    let relationsFound = 0;

    for (const section of sections) {
      // Skip very short sections
      if (section.text.length < this.minSectionLength) continue;

      sectionsProcessed++;

      try {
        // Pass 1: Extract entities
        const entityResult = await this.client.extract<{ entities: ExtractedEntity[] }>(
          section.text,
          ENTITY_TEMPLATE,
          { temperature: 0 }
        );

        const sectionEntities = (entityResult.entities || [])
          .filter(e => e.name && e.name.trim())
          .map((e) =>
            this.toEntityWithProvenance(e, sourceUrl, section.headingPath, section.blocks[0])
          );

        allEntities.push(...sectionEntities);
        entitiesFound += sectionEntities.length;

        // Pass 2: Extract relations (only if we have at least 2 entities)
        if (sectionEntities.length >= 2) {
          const relationResult = await this.client.extract<{ relations: ExtractedRelation[] }>(
            section.text,
            RELATION_TEMPLATE,
            { temperature: 0 }
          );

          const sectionRelations = (relationResult.relations || [])
            .map(r =>
              this.toTripleWithEvidence(r, sourceUrl, section.headingPath, sectionEntities)
            )
            .filter((r): r is TripleWithEvidence => r !== null);

          allRelations.push(...sectionRelations);
          relationsFound += sectionRelations.length;
        }
      } catch (error) {
        // Log but continue with other sections
        console.error(`Error extracting from section: ${error}`);
      }
    }

    // Deduplicate
    const uniqueEntities = this.deduplicateEntities(allEntities);
    const uniqueRelations = this.deduplicateRelations(allRelations);

    return {
      entities: uniqueEntities,
      relations: uniqueRelations,
      stats: {
        sectionsProcessed,
        entitiesFound,
        relationsFound,
        uniqueEntities: uniqueEntities.length,
        uniqueRelations: uniqueRelations.length
      }
    };
  }

  /**
   * Group blocks by their section (H2 heading).
   */
  private groupBySection(blocks: ContentBlock[]): SectionGroup[] {
    const sections: Map<string, SectionGroup> = new Map();

    for (const block of blocks) {
      const key = block.headingPath.join(' > ') || 'root';

      if (!sections.has(key)) {
        sections.set(key, {
          headingPath: block.headingPath,
          blocks: [],
          text: ''
        });
      }

      const section = sections.get(key)!;
      section.blocks.push(block);
    }

    // Combine block text for each section
    for (const section of sections.values()) {
      section.text = section.blocks
        .filter(b => b.type === 'paragraph' || b.type === 'list')
        .map(b => b.text)
        .join('\n\n');
    }

    return Array.from(sections.values());
  }

  /**
   * Convert NuExtract entity to EntityWithProvenance.
   */
  private toEntityWithProvenance(
    extracted: ExtractedEntity,
    sourceUrl: string,
    headingPath: string[],
    block: ContentBlock
  ): EntityWithProvenance {
    const id = `nuextract_${extracted.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

    const provenance: Provenance = {
      sourceUrl,
      blockId: block.id,
      headingPath,
      charStart: block.charStart,
      charEnd: block.charEnd,
      evidence: extracted.evidence || '',
      extractor: 'nuextract',
      confidence: 0.8,
      extractedAt: new Date().toISOString()
    };

    return {
      id,
      name: extracted.name,
      type: this.mapEntityType(extracted.type),
      confidence: 0.8,
      relevance: 0, // Will be calculated during graph building
      mentions: [{
        text: extracted.name,
        startPosition: block.charStart,
        endPosition: block.charEnd,
        sentenceIndex: 0,
        blockId: block.id,
        headingPath,
        context: extracted.evidence
      }],
      provenance,
      extractors: {
        textrazor: false,
        nuextract: true
      }
    };
  }

  /**
   * Map string type to EntityType.
   */
  private mapEntityType(type: string): EntityType {
    const typeMap: Record<string, EntityType> = {
      'Person': 'Person',
      'Organization': 'Organization',
      'Place': 'Place',
      'Product': 'Product',
      'Event': 'Event',
      'Concept': 'Concept',
      'Technology': 'Technology',
      'Metric': 'Concept',
      'CreativeWork': 'CreativeWork',
      'MedicalCondition': 'MedicalCondition',
      'Drug': 'Drug'
    };
    return typeMap[type] || 'Unknown';
  }

  /**
   * Convert NuExtract relation to TripleWithEvidence.
   */
  private toTripleWithEvidence(
    extracted: ExtractedRelation,
    sourceUrl: string,
    headingPath: string[],
    entities: EntityWithProvenance[]
  ): TripleWithEvidence | null {
    // Find matching entities (case-insensitive)
    const subject = entities.find(e =>
      e.name.toLowerCase() === extracted.subject.toLowerCase()
    );
    const object = entities.find(e =>
      e.name.toLowerCase() === extracted.object.toLowerCase()
    );

    // Skip if entities not found (prevents hallucinated relations)
    if (!subject || !object) return null;

    const evidence: RelationEvidence = {
      text: extracted.evidence || '',
      sourceUrl,
      blockId: subject.provenance.blockId,
      headingPath
    };

    return {
      subject: subject.id,
      predicate: extracted.predicate,
      object: object.id,
      evidence,
      polarity: extracted.polarity || 'neutral',
      modality: extracted.modality || 'asserted',
      confidence: 0.75,
      extractor: 'nuextract'
    };
  }

  /**
   * Deduplicate entities by name.
   */
  private deduplicateEntities(entities: EntityWithProvenance[]): EntityWithProvenance[] {
    const seen = new Map<string, EntityWithProvenance>();

    for (const entity of entities) {
      const key = entity.name.toLowerCase();

      if (seen.has(key)) {
        // Merge mentions
        const existing = seen.get(key)!;
        existing.mentions.push(...entity.mentions);
        // Take higher confidence
        existing.confidence = Math.max(existing.confidence, entity.confidence);
      } else {
        seen.set(key, { ...entity });
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Deduplicate relations by subject-predicate-object.
   */
  private deduplicateRelations(relations: TripleWithEvidence[]): TripleWithEvidence[] {
    const seen = new Set<string>();
    const unique: TripleWithEvidence[] = [];

    for (const relation of relations) {
      const key = `${relation.subject}|${relation.predicate}|${relation.object}`;

      if (!seen.has(key)) {
        seen.add(key);
        unique.push(relation);
      }
    }

    return unique;
  }
}

// ============================================
// FACTORY
// ============================================

export function createRelationExtractor(client: NuExtractClient): RelationExtractor {
  return new RelationExtractor(client);
}
