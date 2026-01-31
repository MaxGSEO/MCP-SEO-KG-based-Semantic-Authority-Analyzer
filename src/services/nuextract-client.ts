/**
 * NuExtract 2.0 Client
 *
 * Schema-guided extraction client supporting both HuggingFace Inference API
 * and local vLLM deployment.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import Bottleneck from 'bottleneck';

// ============================================
// TYPES
// ============================================

export type NuExtractMode = 'huggingface' | 'vllm';

export interface NuExtractOptions {
  /** Temperature for generation (0 recommended for extraction) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
}

export interface ExtractedEntity {
  name: string;
  type: string;
  evidence: string;
  sectionHeading?: string;
}

export interface ExtractedRelation {
  subject: string;
  predicate: string;
  object: string;
  evidence: string;
  polarity: 'positive' | 'negative' | 'neutral';
  modality: 'asserted' | 'hypothetical' | 'recommendation';
}

// ============================================
// EXTRACTION TEMPLATES
// ============================================

/**
 * Entity extraction template.
 * Uses verbatim-string to force exact quotes from source.
 */
export const ENTITY_TEMPLATE = {
  entities: [
    {
      name: "verbatim-string",
      type: ["Person", "Organization", "Product", "Technology",
             "Concept", "Place", "Event", "Metric"],
      evidence: "verbatim-string"
    }
  ]
};

/**
 * Relation extraction template.
 * Controlled predicates prevent hallucinated relation types.
 */
export const RELATION_TEMPLATE = {
  relations: [
    {
      subject: "verbatim-string",
      predicate: [
        "defines", "includes", "requires", "causes", "improves",
        "compares_to", "uses", "part_of", "located_in", "measures",
        "created_by", "affects", "enables", "prevents", "produces"
      ],
      object: "verbatim-string",
      evidence: "verbatim-string",
      polarity: ["positive", "negative", "neutral"],
      modality: ["asserted", "hypothetical", "recommendation"]
    }
  ]
};

/**
 * Page intent template.
 */
export const INTENT_TEMPLATE = {
  page_intent: {
    primary: ["informational", "commercial", "transactional", "navigational"],
    secondary: ["informational", "commercial", "transactional", "navigational", null],
    target_audience: "string",
    main_topic: "verbatim-string"
  }
};

/**
 * Claims extraction template.
 */
export const CLAIMS_TEMPLATE = {
  claims: [
    {
      statement: "verbatim-string",
      type: ["fact", "opinion", "statistic", "recommendation", "definition"],
      confidence_markers: "string",
      evidence: "verbatim-string"
    }
  ]
};

// ============================================
// NUEXTRACT CLIENT
// ============================================

export class NuExtractClient {
  private mode: NuExtractMode;
  private hfToken: string;
  private vllmUrl: string;
  private client: AxiosInstance;
  private limiter: Bottleneck;

  constructor(options: {
    mode?: NuExtractMode;
    hfToken?: string;
    vllmUrl?: string;
    maxConcurrent?: number;
    minTime?: number;
  } = {}) {
    this.mode = options.mode || (process.env.NUEXTRACT_MODE as NuExtractMode) || 'huggingface';
    this.hfToken = options.hfToken || process.env.NUEXTRACT_HF_TOKEN || process.env.HF_TOKEN || '';
    this.vllmUrl = options.vllmUrl || process.env.NUEXTRACT_VLLM_URL || 'http://localhost:8001';

    // Create axios client based on mode
    if (this.mode === 'huggingface') {
      this.client = axios.create({
        baseURL: 'https://api-inference.huggingface.co/models/numind/NuExtract-2.0-4B',
        timeout: 120000, // 2 minute timeout
        headers: {
          'Authorization': `Bearer ${this.hfToken}`,
          'Content-Type': 'application/json'
        }
      });
    } else {
      this.client = axios.create({
        baseURL: this.vllmUrl,
        timeout: 120000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    // Rate limiter (HuggingFace has rate limits)
    this.limiter = new Bottleneck({
      maxConcurrent: options.maxConcurrent ?? 1,
      minTime: options.minTime ?? (this.mode === 'huggingface' ? 2000 : 500)
    });
  }

  /**
   * Extract structured data from text using a template.
   *
   * @param text - Source text to extract from
   * @param template - Extraction template (JSON schema)
   * @param options - Extraction options
   * @returns Parsed extraction result
   */
  async extract<T>(
    text: string,
    template: object,
    options: NuExtractOptions = {}
  ): Promise<T> {
    return this.limiter.schedule(() => this.executeExtraction<T>(text, template, options));
  }

  private async executeExtraction<T>(
    text: string,
    template: object,
    options: NuExtractOptions
  ): Promise<T> {
    const prompt = this.buildPrompt(text, template);

    try {
      let output: string;

      if (this.mode === 'huggingface') {
        output = await this.callHuggingFace(prompt, options);
      } else {
        output = await this.callVLLM(prompt, options);
      }

      return this.parseOutput<T>(output);
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response?.status === 503) {
          throw new Error(
            'NuExtract model is loading. Please wait a moment and try again. ' +
            '(HuggingFace models may take 20-30 seconds to warm up)'
          );
        }
        if (error.response?.status === 401) {
          throw new Error(
            'Invalid HuggingFace token. Please set NUEXTRACT_HF_TOKEN or HF_TOKEN environment variable.'
          );
        }
        if (error.code === 'ECONNREFUSED') {
          throw new Error(
            `NuExtract service not available at ${this.vllmUrl}. ` +
            'Please start the vLLM server or use HuggingFace mode.'
          );
        }
      }
      throw error;
    }
  }

  private buildPrompt(text: string, template: object): string {
    // NuExtract expects a specific prompt format
    return `<|input|>
### Template:
${JSON.stringify(template, null, 2)}

### Text:
${text}
<|output|>`;
  }

  private async callHuggingFace(prompt: string, options: NuExtractOptions): Promise<string> {
    const response = await this.client.post('', {
      inputs: prompt,
      parameters: {
        temperature: options.temperature ?? 0,
        max_new_tokens: options.maxTokens ?? 2048,
        return_full_text: false
      }
    });

    // HuggingFace returns an array
    const result = Array.isArray(response.data) ? response.data[0] : response.data;
    return result?.generated_text || '';
  }

  private async callVLLM(prompt: string, options: NuExtractOptions): Promise<string> {
    const response = await this.client.post('/v1/chat/completions', {
      model: 'numind/NuExtract-2.0-4B',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 2048
    });

    return response.data.choices?.[0]?.message?.content || '';
  }

  private parseOutput<T>(output: string): T {
    // Clean up the output
    let cleaned = output
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    // Remove any text before the first { or [
    const jsonStart = Math.min(
      cleaned.indexOf('{') === -1 ? Infinity : cleaned.indexOf('{'),
      cleaned.indexOf('[') === -1 ? Infinity : cleaned.indexOf('[')
    );
    if (jsonStart !== Infinity && jsonStart > 0) {
      cleaned = cleaned.slice(jsonStart);
    }

    // Remove any text after the last } or ]
    const lastBrace = cleaned.lastIndexOf('}');
    const lastBracket = cleaned.lastIndexOf(']');
    const jsonEnd = Math.max(lastBrace, lastBracket);
    if (jsonEnd !== -1 && jsonEnd < cleaned.length - 1) {
      cleaned = cleaned.slice(0, jsonEnd + 1);
    }

    try {
      return JSON.parse(cleaned);
    } catch {
      // Try to extract JSON object from the output
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          // Fall through
        }
      }

      // Try array format
      const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          return JSON.parse(arrayMatch[0]);
        } catch {
          // Fall through
        }
      }

      throw new Error(`Failed to parse NuExtract output: ${cleaned.slice(0, 200)}...`);
    }
  }

  /**
   * Extract entities from text.
   */
  async extractEntities(text: string): Promise<{ entities: ExtractedEntity[] }> {
    return this.extract<{ entities: ExtractedEntity[] }>(text, ENTITY_TEMPLATE);
  }

  /**
   * Extract relations from text.
   */
  async extractRelations(text: string): Promise<{ relations: ExtractedRelation[] }> {
    return this.extract<{ relations: ExtractedRelation[] }>(text, RELATION_TEMPLATE);
  }

  /**
   * Extract page intent.
   */
  async extractIntent(text: string): Promise<{
    page_intent: {
      primary: string;
      secondary: string | null;
      target_audience: string;
      main_topic: string;
    };
  }> {
    return this.extract(text, INTENT_TEMPLATE);
  }

  /**
   * Check if the NuExtract service is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      if (this.mode === 'vllm') {
        const response = await this.client.get('/health', { timeout: 5000 });
        return response.status === 200;
      } else {
        // HuggingFace - just check if we have a token
        return Boolean(this.hfToken);
      }
    } catch {
      return false;
    }
  }
}

// ============================================
// SINGLETON
// ============================================

let clientInstance: NuExtractClient | null = null;

/**
 * Get the singleton NuExtract client instance.
 */
export function getNuExtractClient(): NuExtractClient {
  if (!clientInstance) {
    clientInstance = new NuExtractClient();
  }
  return clientInstance;
}

/**
 * Create a new NuExtract client with custom options.
 */
export function createNuExtractClient(options?: {
  mode?: NuExtractMode;
  hfToken?: string;
  vllmUrl?: string;
}): NuExtractClient {
  return new NuExtractClient(options);
}

export const nuExtractClient = getNuExtractClient();
