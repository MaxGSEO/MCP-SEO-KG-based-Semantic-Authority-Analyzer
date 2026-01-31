import axios from 'axios';
import Bottleneck from 'bottleneck';
import type {
  Entity,
  EntityType,
  TextRazorResponse,
  TextRazorEntity
} from '../types/index.js';

const TEXTRAZOR_API_URL = 'https://api.textrazor.com/';

export interface TextRazorConfig {
  apiKey: string;
  extractors: string[];
  languageOverride?: string;
  cleanupMode?: 'raw' | 'cleanHTML' | 'stripTags';
}

// Rate limiter for TextRazor API (5 requests per second max)
const rateLimiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 200
});

export class TextRazorClient {
  private apiKey: string;
  private defaultExtractors = ['entities', 'topics'];

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.TEXTRAZOR_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('TEXTRAZOR_API_KEY not set. Get a free key at https://www.textrazor.com/');
    }
  }

  async analyzeUrl(url: string, options: Partial<TextRazorConfig> = {}): Promise<TextRazorResponse> {
    return rateLimiter.schedule(() => this.analyze({ url }, options));
  }

  async analyzeText(text: string, options: Partial<TextRazorConfig> = {}): Promise<TextRazorResponse> {
    return rateLimiter.schedule(() => this.analyze({ text }, options));
  }

  private async analyze(
    input: { url?: string; text?: string },
    options: Partial<TextRazorConfig>
  ): Promise<TextRazorResponse> {
    const params = new URLSearchParams();

    if (input.url) {
      params.append('url', input.url);
    } else if (input.text) {
      params.append('text', input.text);
    }

    params.append('extractors', (options.extractors || this.defaultExtractors).join(','));

    if (options.languageOverride) {
      params.append('languageOverride', options.languageOverride);
    }

    if (options.cleanupMode) {
      params.append('cleanup.mode', options.cleanupMode);
    }

    try {
      const response = await axios.post(TEXTRAZOR_API_URL, params.toString(), {
        headers: {
          'X-TextRazor-Key': this.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 30000
      });

      return response.data.response;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 400) {
          throw new Error('Invalid input: ' + (error.response.data?.error || 'Bad request'));
        }
        if (error.response?.status === 403) {
          throw new Error('API key invalid or rate limit exceeded');
        }
        if (error.response?.status === 413) {
          throw new Error('Document too large. Max 200KB for text.');
        }
      }
      throw error;
    }
  }
}

// Map DBpedia types to our EntityType enum
function mapTextRazorType(dbpediaTypes: string[]): EntityType {
  const typeMap: Record<string, EntityType> = {
    'Person': 'Person',
    'Organisation': 'Organization',
    'Organization': 'Organization',
    'Company': 'Organization',
    'Place': 'Place',
    'Location': 'Place',
    'Country': 'Place',
    'City': 'Place',
    'Product': 'Product',
    'Software': 'Technology',
    'ProgrammingLanguage': 'Technology',
    'Event': 'Event',
    'Work': 'CreativeWork',
    'Film': 'CreativeWork',
    'Book': 'CreativeWork',
    'Album': 'CreativeWork',
    'Disease': 'MedicalCondition',
    'Drug': 'Drug'
  };

  for (const dbType of dbpediaTypes) {
    const simpleName = dbType.split('/').pop() || '';
    if (typeMap[simpleName]) {
      return typeMap[simpleName];
    }
  }

  return 'Concept'; // Default for unmatched types
}

function extractCanonicalName(entity: TextRazorEntity): string {
  // Use entityId as canonical name, or matched text if entityId is a URL
  if (entity.entityId && !entity.entityId.startsWith('http')) {
    return entity.entityId.replace(/_/g, ' ');
  }
  return entity.matchedText;
}

function extractContext(text: string, start: number, end: number, padding: number): string {
  const contextStart = Math.max(0, start - padding);
  const contextEnd = Math.min(text.length, end + padding);
  return text.slice(contextStart, contextEnd);
}

function findSentenceIndex(position: number, text: string): number {
  const beforePosition = text.slice(0, position);
  return (beforePosition.match(/[.!?]+\s/g) || []).length;
}

function generateEntityId(name: string): string {
  return `local_${name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}`;
}

export function convertTextRazorEntity(tr: TextRazorEntity, sourceText: string): Entity {
  return {
    id: tr.wikidataId || generateEntityId(tr.entityId || tr.matchedText),
    name: extractCanonicalName(tr),
    type: mapTextRazorType(tr.type || []),
    wikidataId: tr.wikidataId,
    wikipediaUrl: tr.wikiLink,
    confidence: tr.confidenceScore,
    relevance: tr.relevanceScore,
    mentions: [{
      startPosition: tr.startingPos,
      endPosition: tr.endingPos,
      text: tr.matchedText,
      sentenceIndex: findSentenceIndex(tr.startingPos, sourceText),
      context: extractContext(sourceText, tr.startingPos, tr.endingPos, 50)
    }],
    dbpediaTypes: tr.type,
    freebaseId: tr.freebaseId
  };
}

export function mergeEntityMentions(entities: Entity[]): Entity[] {
  const entityMap = new Map<string, Entity>();

  for (const entity of entities) {
    const key = entity.wikidataId || entity.name.toLowerCase();

    if (entityMap.has(key)) {
      const existing = entityMap.get(key)!;
      // Merge mentions
      existing.mentions.push(...entity.mentions);
      // Update confidence (max)
      existing.confidence = Math.max(existing.confidence, entity.confidence);
      // Update relevance (average weighted by mention count)
      const totalMentions = existing.mentions.length;
      existing.relevance = (existing.relevance * (totalMentions - entity.mentions.length) +
                           entity.relevance * entity.mentions.length) / totalMentions;
    } else {
      entityMap.set(key, { ...entity, mentions: [...entity.mentions] });
    }
  }

  return Array.from(entityMap.values());
}

export async function extractEntitiesFromTextRazor(
  client: TextRazorClient,
  source: string,
  sourceType: 'url' | 'text',
  minConfidence: number = 0.5
): Promise<{ entities: Entity[]; topics: string[]; cleanedText: string }> {
  const response = sourceType === 'url'
    ? await client.analyzeUrl(source, { cleanupMode: 'stripTags' })
    : await client.analyzeText(source);

  const cleanedText = response.cleanedText || source;
  const rawEntities = response.entities || [];
  const topics = (response.topics || [])
    .filter(t => t.score > 0.5)
    .map(t => t.label);

  // Convert and filter by confidence
  const entities = rawEntities
    .filter(e => e.confidenceScore >= minConfidence)
    .map(e => convertTextRazorEntity(e, cleanedText));

  // Merge duplicate entities
  const merged = mergeEntityMentions(entities);

  // Sort by relevance
  merged.sort((a, b) => b.relevance - a.relevance);

  return { entities: merged, topics, cleanedText };
}
