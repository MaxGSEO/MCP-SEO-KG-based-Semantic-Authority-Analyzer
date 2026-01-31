import type { Entity } from '../types/index.js';
import { createGraph, addEdge, type SimpleGraph } from './types.js';

export interface CooccurrenceOptions {
  windowSize?: number;      // Word window size (default: 5)
  minWeight?: number;       // Minimum edge weight (default: 2)
  normalize?: boolean;      // Normalize weights by max (default: false)
  usePositions?: boolean;   // Use character positions vs word positions (default: true)
}

interface MentionWithEntity {
  entityId: string;
  entityName: string;
  startPosition: number;
  endPosition: number;
}

export function buildCooccurrenceGraph(
  entities: Entity[],
  sourceText: string,
  options: CooccurrenceOptions = {}
): SimpleGraph {
  const {
    windowSize = 5,
    minWeight = 2,
    normalize = false,
    usePositions = true
  } = options;

  const graph = createGraph();

  // Flatten all mentions with their entity reference
  const mentions = flattenMentions(entities);

  // Sort by position
  mentions.sort((a, b) => a.startPosition - b.startPosition);

  // Calculate co-occurrences using sliding window
  const cooccurrences = calculateCooccurrences(
    mentions,
    sourceText,
    windowSize,
    usePositions
  );

  // Add edges to graph
  for (const [key, weight] of cooccurrences) {
    if (weight >= minWeight) {
      const [source, target] = key.split('|||');
      addEdge(graph, source, target, weight);
    }
  }

  // Optionally normalize weights
  if (normalize) {
    normalizeWeights(graph);
  }

  return graph;
}

function flattenMentions(entities: Entity[]): MentionWithEntity[] {
  const mentions: MentionWithEntity[] = [];

  for (const entity of entities) {
    for (const mention of entity.mentions) {
      mentions.push({
        entityId: entity.id,
        entityName: entity.name,
        startPosition: mention.startPosition,
        endPosition: mention.endPosition
      });
    }
  }

  return mentions;
}

function calculateCooccurrences(
  mentions: MentionWithEntity[],
  sourceText: string,
  windowSize: number,
  usePositions: boolean
): Map<string, number> {
  const cooccurrences = new Map<string, number>();

  if (usePositions) {
    // Character-position based window
    const windowChars = windowSize * 6; // Approximate 6 chars per word

    for (let i = 0; i < mentions.length; i++) {
      for (let j = i + 1; j < mentions.length; j++) {
        const distance = mentions[j].startPosition - mentions[i].endPosition;

        if (distance > windowChars) break; // Outside window
        if (distance < 0) continue; // Overlapping mentions

        // Don't count self-loops
        if (mentions[i].entityId === mentions[j].entityId) continue;

        // Create canonical edge key (alphabetically sorted)
        const key = [mentions[i].entityId, mentions[j].entityId].sort().join('|||');
        cooccurrences.set(key, (cooccurrences.get(key) || 0) + 1);
      }
    }
  } else {
    // Word-position based window
    const words = tokenizeWithPositions(sourceText);
    const mentionToWordIndex = mapMentionsToWords(mentions, words);

    for (let i = 0; i < mentions.length; i++) {
      const wordIndex1 = mentionToWordIndex.get(i);
      if (wordIndex1 === undefined) continue;

      for (let j = i + 1; j < mentions.length; j++) {
        const wordIndex2 = mentionToWordIndex.get(j);
        if (wordIndex2 === undefined) continue;

        const wordDistance = Math.abs(wordIndex2 - wordIndex1);

        if (wordDistance > windowSize) continue;
        if (mentions[i].entityId === mentions[j].entityId) continue;

        const key = [mentions[i].entityId, mentions[j].entityId].sort().join('|||');
        cooccurrences.set(key, (cooccurrences.get(key) || 0) + 1);
      }
    }
  }

  return cooccurrences;
}

interface WordWithPosition {
  word: string;
  startPosition: number;
  endPosition: number;
  index: number;
}

function tokenizeWithPositions(text: string): WordWithPosition[] {
  const words: WordWithPosition[] = [];
  const regex = /\b\w+\b/g;
  let match;
  let index = 0;

  while ((match = regex.exec(text)) !== null) {
    words.push({
      word: match[0],
      startPosition: match.index,
      endPosition: match.index + match[0].length,
      index: index++
    });
  }

  return words;
}

function mapMentionsToWords(
  mentions: MentionWithEntity[],
  words: WordWithPosition[]
): Map<number, number> {
  const mapping = new Map<number, number>();

  for (let i = 0; i < mentions.length; i++) {
    const mention = mentions[i];

    // Find the word that contains or is closest to this mention
    for (const word of words) {
      if (word.startPosition <= mention.startPosition &&
          word.endPosition >= mention.startPosition) {
        mapping.set(i, word.index);
        break;
      }
    }
  }

  return mapping;
}

function normalizeWeights(graph: SimpleGraph): void {
  let maxWeight = 0;

  // Find max weight
  for (const neighbors of graph.edges.values()) {
    for (const weight of neighbors.values()) {
      maxWeight = Math.max(maxWeight, weight);
    }
  }

  if (maxWeight === 0) return;

  // Normalize
  for (const neighbors of graph.edges.values()) {
    for (const [target, weight] of neighbors) {
      neighbors.set(target, weight / maxWeight);
    }
  }
}

// Build weighted co-occurrence graph using entity relevance
export function buildWeightedCooccurrenceGraph(
  entities: Entity[],
  sourceText: string,
  options: CooccurrenceOptions = {}
): SimpleGraph {
  const baseGraph = buildCooccurrenceGraph(entities, sourceText, options);

  // Create entity relevance map
  const relevanceMap = new Map<string, number>();
  for (const entity of entities) {
    relevanceMap.set(entity.id, entity.relevance);
  }

  // Adjust edge weights by combined relevance
  for (const [source, neighbors] of baseGraph.edges) {
    const sourceRelevance = relevanceMap.get(source) || 0.5;

    for (const [target, weight] of neighbors) {
      const targetRelevance = relevanceMap.get(target) || 0.5;
      const relevanceMultiplier = (sourceRelevance + targetRelevance) / 2;
      neighbors.set(target, weight * relevanceMultiplier);
    }
  }

  return baseGraph;
}

// Sentence-based co-occurrence
export function buildSentenceCooccurrenceGraph(
  entities: Entity[],
  sourceText: string,
  options: CooccurrenceOptions = {}
): SimpleGraph {
  const { minWeight = 2 } = options;

  const graph = createGraph();

  // Split into sentences
  const sentences = sourceText.split(/[.!?]+\s+/);
  let charOffset = 0;

  const cooccurrences = new Map<string, number>();

  for (const sentence of sentences) {
    const sentenceEnd = charOffset + sentence.length;

    // Find entities in this sentence
    const entitiesInSentence: Entity[] = [];

    for (const entity of entities) {
      for (const mention of entity.mentions) {
        if (mention.startPosition >= charOffset && mention.endPosition <= sentenceEnd) {
          entitiesInSentence.push(entity);
          break; // Only count entity once per sentence
        }
      }
    }

    // All pairs in sentence co-occur
    for (let i = 0; i < entitiesInSentence.length; i++) {
      for (let j = i + 1; j < entitiesInSentence.length; j++) {
        if (entitiesInSentence[i].id === entitiesInSentence[j].id) continue;

        const key = [entitiesInSentence[i].id, entitiesInSentence[j].id].sort().join('|||');
        cooccurrences.set(key, (cooccurrences.get(key) || 0) + 1);
      }
    }

    charOffset = sentenceEnd + 2; // Account for sentence delimiter
  }

  // Add edges
  for (const [key, weight] of cooccurrences) {
    if (weight >= minWeight) {
      const [source, target] = key.split('|||');
      addEdge(graph, source, target, weight);
    }
  }

  return graph;
}
