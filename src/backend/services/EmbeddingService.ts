import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { createHash } from 'crypto';

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
}

export interface EmbeddingServiceOptions {
  region?: string;
  modelId?: string;
}

/**
 * Service for generating embeddings using Amazon Bedrock Titan
 * Implements caching and retry logic for optimal performance
 */
export class EmbeddingService {
  private readonly client: BedrockRuntimeClient;
  private readonly cloudwatch: CloudWatchClient;
  private readonly modelId: string;
  private readonly maxRetries: number = 3;
  private readonly maxInputLength: number = 8000; // Titan's max input length
  private readonly embeddingCache: Map<string, number[]> = new Map();
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private apiCalls: number = 0;
  private totalLatency: number = 0;

  constructor(optionsOrRegion?: EmbeddingServiceOptions | string) {
    const options: EmbeddingServiceOptions =
      typeof optionsOrRegion === 'string'
        ? { region: optionsOrRegion }
        : optionsOrRegion ?? {};

    const awsRegion =
      options.region ||
      process.env.AWS_REGION ||
      process.env.BEDROCK_REGION ||
      'us-east-1';

    this.modelId =
      options.modelId ||
      process.env.BEDROCK_MODEL_ID ||
      'amazon.titan-embed-text-v1';

    this.client = new BedrockRuntimeClient({ region: awsRegion });
    this.cloudwatch = new CloudWatchClient({ region: awsRegion });
  }

  /**
   * Generate embedding for a single text
   * Uses caching to avoid regenerating embeddings for the same text
   *
   * @param text - Input text to generate embedding for
   * @returns 1536-dimensional embedding vector
   * @throws Error if text is empty or Bedrock API fails
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    // Check cache first
    const cacheKey = this.getCacheKey(text);
    if (this.embeddingCache.has(cacheKey)) {
      this.cacheHits++;
      return this.embeddingCache.get(cacheKey)!;
    }

    this.cacheMisses++;

    // Truncate if too long
    const truncatedText = this.truncateText(text);

    try {
      const embedding = await this.invokeBedrockWithRetry(truncatedText);

      // Cache the result
      this.embeddingCache.set(cacheKey, embedding);

      return embedding;
    } catch (error: any) {
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   * Deduplicates inputs and uses caching for efficiency
   *
   * @param texts - Array of texts to generate embeddings for
   * @returns Array of embedding vectors in the same order as input
   * @throws Error if any embedding generation fails
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    try {
      // Process each text sequentially to leverage cache for duplicates within the batch
      const embeddings: number[][] = [];
      for (const text of texts) {
        const embedding = await this.generateEmbedding(text);
        embeddings.push(embedding);
      }
      return embeddings;
    } catch (error: any) {
      throw new Error(`Failed to generate embeddings: ${error.message}`);
    }
  }

  /**
   * Generate embedding for content by combining title and description
   * This is the standard way to embed content pieces
   *
   * @param title - Content title
   * @param description - Optional content description
   * @returns Embedding vector or null if both title and description are empty
   */
  async generateContentEmbedding(title: string, description?: string): Promise<number[] | null> {
    const titleText = title?.trim() || '';
    const descText = description?.trim() || '';

    if (!titleText && !descText) {
      return null;
    }

    // Combine title and description with appropriate weighting
    const combinedText = titleText + (descText ? ` ${descText}` : '');

    return this.generateEmbedding(combinedText);
  }

  /**
   * Invoke Bedrock model with exponential backoff retry logic
   * Handles throttling and transient errors
   *
   * @param text - Text to generate embedding for
   * @returns Embedding vector
   */
  private async invokeBedrockWithRetry(text: string): Promise<number[]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const startTime = Date.now();
        const result = await this.invokeBedrock(text);
        const latency = Date.now() - startTime;

        // Track metrics
        this.apiCalls++;
        this.totalLatency += latency;

        // Publish metrics to CloudWatch asynchronously (fire and forget)
        this.publishMetrics(latency).catch(err => {
          console.warn('Failed to publish CloudWatch metrics:', err.message);
        });

        return result;
      } catch (error: any) {
        lastError = error;

        // Only retry on throttling errors
        if (error.name === 'ThrottlingException' && attempt < this.maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          await this.sleep(delay);
          continue;
        }

        // Don't retry on other errors
        throw error;
      }
    }

    throw lastError!;
  }

  /**
   * Invoke Bedrock Titan embedding model
   *
   * @param text - Text to generate embedding for
   * @returns Embedding vector
   */
  private async invokeBedrock(text: string): Promise<number[]> {
    const command = new InvokeModelCommand({
      modelId: this.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(JSON.stringify({
        inputText: text
      }))
    });

    const response = await this.client.send(command);

    if (!response.body) {
      throw new Error('Empty response from Bedrock');
    }

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (!responseBody.embedding || !Array.isArray(responseBody.embedding)) {
      throw new Error('Invalid embedding format in response');
    }

    return responseBody.embedding;
  }

  /**
   * Truncate text to maximum input length for Titan model
   *
   * @param text - Input text
   * @returns Truncated text
   */
  private truncateText(text: string): string {
    if (text.length <= this.maxInputLength) {
      return text;
    }
    return text.substring(0, this.maxInputLength);
  }

  /**
   * Generate cache key for text
   * Uses a simple hash-like key based on text content
   *
   * @param text - Input text
   * @returns Cache key
   */
  private getCacheKey(text: string): string {
    // Use SHA-256 hash for guaranteed unique cache keys
    const normalized = text.trim().toLowerCase();
    return createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Sleep for specified milliseconds
   *
   * @param ms - Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Publish metrics to CloudWatch for cost monitoring and performance tracking
   *
   * @param latency - API call latency in milliseconds
   */
  private async publishMetrics(latency: number): Promise<void> {
    const namespace = 'CommunityContentHub/Embeddings';
    const timestamp = new Date();

    // Estimate cost: Titan Embeddings is $0.0001 per 1000 input tokens
    // Rough estimate: 1 token ≈ 4 characters
    const estimatedCost = 0.0001; // Cost per embedding call (approximate)

    const command = new PutMetricDataCommand({
      Namespace: namespace,
      MetricData: [
        {
          MetricName: 'EmbeddingAPICallCount',
          Value: 1,
          Unit: 'Count',
          Timestamp: timestamp,
          Dimensions: [
            { Name: 'ModelId', Value: this.modelId },
            { Name: 'Service', Value: 'Bedrock' }
          ]
        },
        {
          MetricName: 'EmbeddingAPILatency',
          Value: latency,
          Unit: 'Milliseconds',
          Timestamp: timestamp,
          Dimensions: [
            { Name: 'ModelId', Value: this.modelId }
          ]
        },
        {
          MetricName: 'EstimatedCost',
          Value: estimatedCost,
          Unit: 'None',
          Timestamp: timestamp,
          Dimensions: [
            { Name: 'ModelId', Value: this.modelId },
            { Name: 'Service', Value: 'Bedrock' }
          ]
        },
        {
          MetricName: 'CacheHitRate',
          Value: this.cacheHits + this.cacheMisses > 0
            ? (this.cacheHits / (this.cacheHits + this.cacheMisses)) * 100
            : 0,
          Unit: 'Percent',
          Timestamp: timestamp,
          Dimensions: [
            { Name: 'Service', Value: 'EmbeddingCache' }
          ]
        }
      ]
    });

    await this.cloudwatch.send(command);
  }

  /**
   * Clear the embedding cache
   * Useful for testing or memory management
   */
  clearCache(): void {
    this.embeddingCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.apiCalls = 0;
    this.totalLatency = 0;
  }

  /**
   * Get cache statistics for monitoring
   *
   * @returns Cache statistics
   */
  getCacheStats(): CacheStats {
    return {
      size: this.embeddingCache.size,
      hits: this.cacheHits,
      misses: this.cacheMisses
    };
  }

  /**
   * Get performance metrics for monitoring
   *
   * @returns Performance metrics
   */
  getPerformanceMetrics() {
    return {
      apiCalls: this.apiCalls,
      averageLatency: this.apiCalls > 0 ? this.totalLatency / this.apiCalls : 0,
      cacheHitRate: (this.cacheHits + this.cacheMisses) > 0
        ? (this.cacheHits / (this.cacheHits + this.cacheMisses)) * 100
        : 0
    };
  }

  /**
   * Determine if content embedding should be regenerated
   *
   * Returns true if title or description has changed, which are the fields
   * used for embedding generation. Other content changes (tags, URLs, etc.)
   * do not require re-embedding.
   *
   * @param oldTitle - Previous content title
   * @param oldDescription - Previous content description
   * @param newTitle - New content title (if changed)
   * @param newDescription - New content description (if changed)
   * @returns true if embedding should be regenerated
   */
  shouldRegenerateEmbedding(
    oldTitle: string,
    oldDescription: string,
    newTitle?: string,
    newDescription?: string
  ): boolean {
    // If either field is being updated and is different, regenerate
    const titleChanged = newTitle !== undefined && newTitle !== oldTitle;
    const descriptionChanged = newDescription !== undefined && newDescription !== oldDescription;

    return titleChanged || descriptionChanged;
  }
}

/**
 * Singleton instance for reuse across Lambda invocations
 */
let embeddingServiceInstance: EmbeddingService | null = null;

/**
 * Get or create singleton EmbeddingService instance
 *
 * @returns EmbeddingService instance
 */
export function getEmbeddingService(): EmbeddingService {
  if (!embeddingServiceInstance) {
    embeddingServiceInstance = new EmbeddingService();
  }
  return embeddingServiceInstance;
}
