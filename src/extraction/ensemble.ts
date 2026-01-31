/**
 * Ensemble Agreement
 *
 * Multi-extractor confidence boosting to reduce false positives.
 *
 * Single extractors have failure modes:
 * | Extractor  | Strength                    | Weakness                    |
 * |------------|-----------------------------|-----------------------------|
 * | TextRazor  | Wikidata linking, disambig  | Misses niche/new entities   |
 * | NuExtract  | Schema-guided, evidence     | No Wikidata IDs, may halluc |
 *
 * When BOTH extractors find the same entity → high confidence.
 * When ONLY ONE finds it → flag for review.
 *
 * Confidence Boosting:
 * - TextRazor only:  base × 0.9
 * - NuExtract only:  base × 0.85
 * - BOTH agree:      max(base_tr, base_nu) × 1.2 (capped at 1.0)
 */

import { EntityType } from '../types/index.js';
import {
  EntityWithProvenance,
  EnsembleEntity,
  TripleWithEvidence,
  Provenance
} from '../types/provenance.js';

// ============================================
// TYPES
// ============================================

export type AgreementLevel = 'both' | 'textrazor_only' | 'nuextract_only';

export interface EnsembleOptions {
  /** Fuzzy name match threshold (0-1, default: 0.85) */
  nameMatchThreshold?: number;
  /** Confidence boost for agreement (default: 1.2) */
  agreementBoost?: number;
  /** Penalty for TextRazor-only (default: 0.9) */
  textrazorPenalty?: number;
  /** Penalty for NuExtract-only (default: 0.85) */
  nuextractPenalty?: number;
}

export interface EnsembleStats {
  textrazorCount: number;
  nuextractCount: number;
  mergedCount: number;
  bothAgreed: number;
  textrazorOnly: number;
  nuextractOnly: number;
}

export interface EnsembleRelation extends TripleWithEvidence {
  agreementCount: number;
  sources: string[];
}

// ============================================
// ENSEMBLE AGGREGATOR
// ============================================

export class EnsembleAggregator {
  private nameMatchThreshold: number;
  private agreementBoost: number;
  private textrazorPenalty: number;
  private nuextractPenalty: number;

  constructor(options: EnsembleOptions = {}) {
    this.nameMatchThreshold = options.nameMatchThreshold ?? 0.85;
    this.agreementBoost = options.agreementBoost ?? 1.2;
    this.textrazorPenalty = options.textrazorPenalty ?? 0.9;
    this.nuextractPenalty = options.nuextractPenalty ?? 0.85;
  }

  /**
   * Merge entities from multiple extractors with confidence boosting.
   *
   * @param textRazorEntities - Entities from TextRazor
   * @param nuExtractEntities - Entities from NuExtract
   * @returns Merged entities with ensemble confidence
   */
  merge(
    textRazorEntities: EntityWithProvenance[],
    nuExtractEntities: EntityWithProvenance[]
  ): { entities: EnsembleEntity[]; stats: EnsembleStats } {
    const result: EnsembleEntity[] = [];
    const matched = new Set<string>(); // Track matched NuExtract entities

    // Process TextRazor entities first (they have Wikidata IDs)
    for (const trEntity of textRazorEntities) {
      // Try to find matching NuExtract entity
      const nuMatch = this.findMatch(trEntity, nuExtractEntities);

      if (nuMatch) {
        matched.add(nuMatch.id);
        // Both extractors agree — high confidence
        result.push(this.createEnsembleEntity(trEntity, nuMatch, 'both'));
      } else {
        // TextRazor only
        result.push(this.createSingleSourceEntity(trEntity, 'textrazor'));
      }
    }

    // Add unmatched NuExtract entities
    for (const nuEntity of nuExtractEntities) {
      if (!matched.has(nuEntity.id)) {
        result.push(this.createSingleSourceEntity(nuEntity, 'nuextract'));
      }
    }

    const stats: EnsembleStats = {
      textrazorCount: textRazorEntities.length,
      nuextractCount: nuExtractEntities.length,
      mergedCount: result.length,
      bothAgreed: result.filter(e => e.agreementLevel === 'both').length,
      textrazorOnly: result.filter(e => e.agreementLevel === 'textrazor_only').length,
      nuextractOnly: result.filter(e => e.agreementLevel === 'nuextract_only').length
    };

    return { entities: result, stats };
  }

  /**
   * Find matching entity using name similarity and type.
   */
  private findMatch(
    target: EntityWithProvenance,
    candidates: EntityWithProvenance[]
  ): EntityWithProvenance | null {
    const targetName = target.name.toLowerCase();

    for (const candidate of candidates) {
      const candidateName = candidate.name.toLowerCase();

      // Exact match
      if (targetName === candidateName) {
        return candidate;
      }

      // Fuzzy match
      const similarity = this.stringSimilarity(targetName, candidateName);
      if (similarity >= this.nameMatchThreshold) {
        // Also check type compatibility
        if (this.typesCompatible(target.type, candidate.type)) {
          return candidate;
        }
      }

      // Check if one contains the other (handles "ML" vs "Machine Learning")
      if (
        (targetName.length > 3 && candidateName.includes(targetName)) ||
        (candidateName.length > 3 && targetName.includes(candidateName))
      ) {
        if (this.typesCompatible(target.type, candidate.type)) {
          return candidate;
        }
      }
    }

    return null;
  }

  /**
   * Create ensemble entity from two matching extractions.
   */
  private createEnsembleEntity(
    textRazor: EntityWithProvenance,
    nuExtract: EntityWithProvenance,
    agreementLevel: 'both'
  ): EnsembleEntity {
    // Use TextRazor's Wikidata ID and disambiguation
    const base = { ...textRazor };

    // Merge mentions (avoid duplicates by position)
    const existingPositions = new Set(
      textRazor.mentions.map(m => m.startPosition)
    );
    const allMentions = [
      ...textRazor.mentions,
      ...nuExtract.mentions.filter(m =>
        m.startPosition === undefined || !existingPositions.has(m.startPosition)
      )
    ];

    // Boost confidence (capped at 1.0)
    const baseConfidence = Math.max(textRazor.confidence, nuExtract.confidence);
    const ensembleConfidence = Math.min(1.0, baseConfidence * this.agreementBoost);

    // Merge provenance - prefer TextRazor but mark as ensemble
    const provenance: Provenance = {
      ...textRazor.provenance,
      extractor: 'ensemble',
      confidence: ensembleConfidence
    };

    return {
      ...base,
      mentions: allMentions,
      confidence: ensembleConfidence,
      extractors: {
        textrazor: true,
        nuextract: true
      },
      provenance,
      ensembleConfidence,
      agreementLevel
    };
  }

  /**
   * Create entity from single extractor.
   */
  private createSingleSourceEntity(
    entity: EntityWithProvenance,
    source: 'textrazor' | 'nuextract'
  ): EnsembleEntity {
    // Apply penalty for single-source
    const confidenceMultiplier =
      source === 'textrazor' ? this.textrazorPenalty : this.nuextractPenalty;
    const ensembleConfidence = entity.confidence * confidenceMultiplier;

    return {
      ...entity,
      confidence: ensembleConfidence,
      extractors: {
        textrazor: source === 'textrazor',
        nuextract: source === 'nuextract'
      },
      provenance: {
        ...entity.provenance,
        extractor: source,
        confidence: ensembleConfidence
      },
      ensembleConfidence,
      agreementLevel: source === 'textrazor' ? 'textrazor_only' : 'nuextract_only'
    };
  }

  /**
   * Check if two entity types are compatible.
   */
  private typesCompatible(type1: EntityType, type2: EntityType): boolean {
    // Exact match
    if (type1 === type2) return true;

    // Type mapping for compatibility
    const typeGroups: Record<string, EntityType[]> = {
      Person: ['Person'],
      Organization: ['Organization'],
      Place: ['Place'],
      Product: ['Product'],
      Event: ['Event'],
      Technology: ['Technology', 'Concept'],
      Concept: ['Concept', 'Technology'],
      CreativeWork: ['CreativeWork'],
      Unknown: ['Unknown', 'Concept']
    };

    const group1 = typeGroups[type1] || [type1];
    const group2 = typeGroups[type2] || [type2];

    return group1.some(t => group2.includes(t));
  }

  /**
   * Simple Levenshtein-based string similarity.
   */
  private stringSimilarity(s1: string, s2: string): number {
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  private levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }

    return dp[m][n];
  }
}

// ============================================
// RELATION MERGING
// ============================================

/**
 * Merge relations from multiple sources.
 *
 * @param relationSets - Arrays of relations from different extractors/blocks
 * @returns Merged relations with agreement tracking
 */
export function mergeRelations(
  relationSets: TripleWithEvidence[][]
): EnsembleRelation[] {
  const relationMap = new Map<string, EnsembleRelation>();

  for (const relations of relationSets) {
    for (const rel of relations) {
      // Normalize key (subject-predicate-object)
      const key = `${rel.subject.toLowerCase()}|${rel.predicate}|${rel.object.toLowerCase()}`;

      if (relationMap.has(key)) {
        const existing = relationMap.get(key)!;
        existing.agreementCount++;
        existing.sources.push(rel.extractor);
        // Boost confidence
        existing.confidence = Math.min(1.0, existing.confidence * 1.1);
        // Keep best evidence (longest)
        if (rel.evidence.text.length > existing.evidence.text.length) {
          existing.evidence = rel.evidence;
        }
      } else {
        relationMap.set(key, {
          ...rel,
          agreementCount: 1,
          sources: [rel.extractor]
        });
      }
    }
  }

  return Array.from(relationMap.values());
}

// ============================================
// FILTERING HELPERS
// ============================================

/**
 * Filter for high-confidence entities only.
 */
export function filterHighConfidence(
  entities: EnsembleEntity[],
  minConfidence: number = 0.75
): EnsembleEntity[] {
  return entities.filter(
    e => e.agreementLevel === 'both' || e.ensembleConfidence >= minConfidence
  );
}

/**
 * Get entities that need manual review.
 */
export function getEntitiesNeedingReview(
  entities: EnsembleEntity[],
  confidenceThreshold: number = 0.75
): EnsembleEntity[] {
  return entities.filter(
    e => e.agreementLevel !== 'both' && e.ensembleConfidence < confidenceThreshold
  );
}

// ============================================
// FACTORY
// ============================================

/**
 * Get ensemble settings from environment.
 */
export function getEnsembleSettingsFromEnv(): EnsembleOptions {
  return {
    nameMatchThreshold: parseFloat(
      process.env.ENSEMBLE_NAME_MATCH_THRESHOLD || '0.85'
    ),
    agreementBoost: parseFloat(process.env.ENSEMBLE_BOOST_BOTH || '1.2'),
    textrazorPenalty: parseFloat(
      process.env.ENSEMBLE_PENALTY_TEXTRAZOR || '0.9'
    ),
    nuextractPenalty: parseFloat(
      process.env.ENSEMBLE_PENALTY_NUEXTRACT || '0.85'
    )
  };
}

/**
 * Create an ensemble aggregator with environment config.
 */
export function createEnsembleAggregator(): EnsembleAggregator {
  return new EnsembleAggregator(getEnsembleSettingsFromEnv());
}
