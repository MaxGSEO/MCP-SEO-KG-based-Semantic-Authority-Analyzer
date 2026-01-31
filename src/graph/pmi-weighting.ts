/**
 * PMI/NPMI Weighting
 *
 * Statistical association metrics to replace raw frequency weighting.
 *
 * PMI (Pointwise Mutual Information) measures whether two entities
 * co-occur MORE than expected by chance:
 *
 *   PMI(x, y) = log₂( P(x, y) / (P(x) × P(y)) )
 *
 * NPMI (Normalized PMI) normalizes to [-1, +1]:
 *
 *   NPMI(x, y) = PMI(x, y) / (-log₂(P(x, y)))
 *
 * | Value   | Meaning                              |
 * |---------|--------------------------------------|
 * | PMI > 0 | Strong positive association          |
 * | PMI ≈ 0 | Independent (co-occur as expected)   |
 * | PMI < 0 | Negative association (avoid each other)|
 */

import { Entity, GraphEdge } from '../types/index.js';
import { ContentBlock } from '../services/crawl4ai-client.js';

// ============================================
// TYPES
// ============================================

export interface EntityCounts {
  /** Total number of windows/sentences */
  total: number;
  /** How many windows contain each entity */
  entityCounts: Map<string, number>;
  /** How many windows contain each pair */
  pairCounts: Map<string, number>;
}

export interface PMIOptions {
  /** Laplace smoothing factor (default: 0.5) */
  smoothing?: number;
  /** Minimum co-occurrences to include (default: 2) */
  minFrequency?: number;
}

export interface PMIResult {
  source: string;
  target: string;
  weight: number;
  pmi: number;
  npmi?: number;
  cooccurrenceCount: number;
}

export interface CooccurrenceWindow {
  /** Entities found in this window (sentence/paragraph/block) */
  entities: string[];
}

// ============================================
// PMI CALCULATOR
// ============================================

export class PMICalculator {
  private smoothing: number;
  private minFrequency: number;

  constructor(options: PMIOptions = {}) {
    this.smoothing = options.smoothing ?? 0.5;
    this.minFrequency = options.minFrequency ?? 2;
  }

  /**
   * Calculate PMI for an entity pair.
   *
   * @param entityA - First entity ID
   * @param entityB - Second entity ID
   * @param counts - Pre-computed entity counts
   * @returns PMI value
   */
  pmi(entityA: string, entityB: string, counts: EntityCounts): number {
    const { total, entityCounts, pairCounts } = counts;

    const countA = entityCounts.get(entityA) ?? 0;
    const countB = entityCounts.get(entityB) ?? 0;
    const countAB = pairCounts.get(this.pairKey(entityA, entityB)) ?? 0;

    // Skip low-frequency pairs
    if (countAB < this.minFrequency) return 0;

    const vocabSize = entityCounts.size;

    // Apply Laplace smoothing to avoid log(0)
    const pA = (countA + this.smoothing) / (total + this.smoothing * vocabSize);
    const pB = (countB + this.smoothing) / (total + this.smoothing * vocabSize);
    const pAB = (countAB + this.smoothing) / (total + this.smoothing);

    // PMI = log2(P(A,B) / (P(A) * P(B)))
    const pmi = Math.log2(pAB / (pA * pB));

    return pmi;
  }

  /**
   * Calculate Normalized PMI (range: -1 to +1).
   *
   * @param entityA - First entity ID
   * @param entityB - Second entity ID
   * @param counts - Pre-computed entity counts
   * @returns NPMI value
   */
  npmi(entityA: string, entityB: string, counts: EntityCounts): number {
    const pmiValue = this.pmi(entityA, entityB, counts);

    if (pmiValue === 0) return 0;

    const { total, pairCounts } = counts;
    const countAB = pairCounts.get(this.pairKey(entityA, entityB)) ?? 0;
    const pAB = (countAB + this.smoothing) / (total + this.smoothing);

    // NPMI = PMI / -log2(P(A,B))
    const denominator = -Math.log2(pAB);

    if (denominator === 0) return 0;

    // Clamp to [-1, 1] to handle numerical edge cases
    return Math.max(-1, Math.min(1, pmiValue / denominator));
  }

  /**
   * Build entity counts from co-occurrence data.
   *
   * @param cooccurrences - Array of windows with entity lists
   * @returns EntityCounts object
   */
  buildCounts(cooccurrences: CooccurrenceWindow[]): EntityCounts {
    const total = cooccurrences.length;
    const entityCounts = new Map<string, number>();
    const pairCounts = new Map<string, number>();

    for (const { entities } of cooccurrences) {
      // Count individual entities (unique per window)
      const uniqueEntities = [...new Set(entities)];
      for (const entity of uniqueEntities) {
        entityCounts.set(entity, (entityCounts.get(entity) ?? 0) + 1);
      }

      // Count pairs
      for (let i = 0; i < uniqueEntities.length; i++) {
        for (let j = i + 1; j < uniqueEntities.length; j++) {
          const key = this.pairKey(uniqueEntities[i], uniqueEntities[j]);
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
      }
    }

    return { total, entityCounts, pairCounts };
  }

  /**
   * Apply PMI weighting to graph edges.
   *
   * @param edges - Original edges with raw weights
   * @param counts - Pre-computed entity counts
   * @param options - Weighting options
   * @returns Edges with PMI-adjusted weights
   */
  applyToEdges(
    edges: Array<{ source: string; target: string; weight: number }>,
    counts: EntityCounts,
    options: {
      useNPMI?: boolean;
      combineWithFrequency?: boolean;
      filterNegative?: boolean;
    } = {}
  ): PMIResult[] {
    const {
      useNPMI = true,
      combineWithFrequency = true,
      filterNegative = true
    } = options;

    const results: PMIResult[] = [];

    for (const edge of edges) {
      const pmiValue = useNPMI
        ? this.npmi(edge.source, edge.target, counts)
        : this.pmi(edge.source, edge.target, counts);

      // Filter negative PMI (entities that avoid each other)
      if (filterNegative && pmiValue < 0) continue;

      const cooccurrenceCount = counts.pairCounts.get(
        this.pairKey(edge.source, edge.target)
      ) ?? 0;

      // Calculate final weight
      let finalWeight: number;
      if (combineWithFrequency) {
        // Combine: original weight × (1 + NPMI)
        // This preserves frequency signal but boosts meaningful pairs
        finalWeight = edge.weight * (1 + Math.max(0, pmiValue));
      } else {
        // Pure PMI weight (normalized to positive range)
        finalWeight = Math.max(0, pmiValue);
      }

      results.push({
        source: edge.source,
        target: edge.target,
        weight: finalWeight,
        pmi: pmiValue,
        npmi: useNPMI ? pmiValue : undefined,
        cooccurrenceCount
      });
    }

    return results;
  }

  /**
   * Create a canonical pair key.
   */
  private pairKey(a: string, b: string): string {
    return [a, b].sort().join('|');
  }
}

// ============================================
// WINDOW EXTRACTION
// ============================================

export type WindowType = 'sentence' | 'paragraph' | 'block';

/**
 * Extract co-occurrence windows from content blocks.
 *
 * @param blocks - Content blocks from Crawl4AI
 * @param entities - Entities to track
 * @param windowType - Granularity of windows
 * @returns Array of co-occurrence windows
 */
export function extractCooccurrenceWindows(
  blocks: ContentBlock[],
  entities: Entity[],
  windowType: WindowType = 'sentence'
): CooccurrenceWindow[] {
  const windows: CooccurrenceWindow[] = [];

  // Create entity lookup by name (case-insensitive)
  const entityByName = new Map<string, Entity>();
  for (const entity of entities) {
    entityByName.set(entity.name.toLowerCase(), entity);
    // Also add variants from mentions
    for (const mention of entity.mentions) {
      entityByName.set(mention.text.toLowerCase(), entity);
    }
  }

  for (const block of blocks) {
    if (block.type !== 'paragraph' && block.type !== 'list') continue;

    let textUnits: string[];

    switch (windowType) {
      case 'sentence':
        textUnits = splitIntoSentences(block.text);
        break;
      case 'paragraph':
      case 'block':
        textUnits = [block.text];
        break;
    }

    for (const unit of textUnits) {
      const foundEntities: string[] = [];
      const unitLower = unit.toLowerCase();

      for (const [name, entity] of entityByName) {
        if (unitLower.includes(name)) {
          foundEntities.push(entity.id);
        }
      }

      if (foundEntities.length > 0) {
        // Deduplicate (same entity might match multiple surface forms)
        windows.push({ entities: [...new Set(foundEntities)] });
      }
    }
  }

  return windows;
}

/**
 * Split text into sentences.
 */
function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .filter(s => s.trim().length > 0);
}

// ============================================
// INTEGRATION HELPERS
// ============================================

/**
 * Apply PMI weighting to a graph's edges.
 *
 * @param edges - Graph edges to weight
 * @param blocks - Content blocks for window extraction
 * @param entities - Entities in the graph
 * @param options - PMI calculation options
 * @returns PMI-weighted edges
 */
export function applyPMIWeighting(
  edges: GraphEdge[],
  blocks: ContentBlock[],
  entities: Entity[],
  options: {
    smoothing?: number;
    minFrequency?: number;
    windowType?: WindowType;
    useNPMI?: boolean;
    combineWithFrequency?: boolean;
    filterNegative?: boolean;
  } = {}
): GraphEdge[] {
  const calculator = new PMICalculator({
    smoothing: options.smoothing,
    minFrequency: options.minFrequency
  });

  // Extract co-occurrence windows
  const windows = extractCooccurrenceWindows(
    blocks,
    entities,
    options.windowType ?? 'sentence'
  );

  // Build counts
  const counts = calculator.buildCounts(windows);

  // Apply PMI weighting
  const pmiResults = calculator.applyToEdges(
    edges.map(e => ({
      source: e.source,
      target: e.target,
      weight: e.weight ?? 1
    })),
    counts,
    {
      useNPMI: options.useNPMI ?? true,
      combineWithFrequency: options.combineWithFrequency ?? true,
      filterNegative: options.filterNegative ?? true
    }
  );

  // Convert back to GraphEdge format
  return pmiResults.map(r => ({
    source: r.source,
    target: r.target,
    weight: r.weight,
    type: 'cooccurrence' as const
  }));
}

/**
 * Get PMI settings from environment.
 */
export function getPMISettingsFromEnv(): PMIOptions {
  return {
    smoothing: parseFloat(process.env.PMI_SMOOTHING || '0.5'),
    minFrequency: parseInt(process.env.PMI_MIN_FREQUENCY || '2', 10)
  };
}
