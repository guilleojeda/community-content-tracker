import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const bedrockSendMock = jest.fn();
const cloudwatchSendMock = jest.fn();

const { EmbeddingService } = require('../../../src/backend/services/EmbeddingService');

const setMockClients = (target: EmbeddingService) => {
  (target as any).client = { send: bedrockSendMock };
  (target as any).cloudwatch = { send: cloudwatchSendMock };
};

describe('EmbeddingService', () => {
  let service: EmbeddingService;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    bedrockSendMock.mockReset();
    cloudwatchSendMock.mockReset();
    cloudwatchSendMock.mockResolvedValue({});
    process.env.BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';
    process.env.BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'amazon.titan-embed-text-v1';
    service = new EmbeddingService();
    setMockClients(service);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('uses AWS_REGION when BEDROCK_REGION is not set', () => {
      const previousBedrock = process.env.BEDROCK_REGION;
      const previousAws = process.env.AWS_REGION;
      delete process.env.BEDROCK_REGION;
      process.env.AWS_REGION = 'us-west-1';

      expect(() => new EmbeddingService()).not.toThrow();

      if (previousBedrock === undefined) {
        delete process.env.BEDROCK_REGION;
      } else {
        process.env.BEDROCK_REGION = previousBedrock;
      }
      if (previousAws === undefined) {
        delete process.env.AWS_REGION;
      } else {
        process.env.AWS_REGION = previousAws;
      }
    });

    it('throws when no region is configured', () => {
      const previousBedrock = process.env.BEDROCK_REGION;
      const previousAws = process.env.AWS_REGION;
      delete process.env.BEDROCK_REGION;
      delete process.env.AWS_REGION;

      expect(() => new EmbeddingService()).toThrow('BEDROCK_REGION or AWS_REGION must be set');

      if (previousBedrock === undefined) {
        delete process.env.BEDROCK_REGION;
      } else {
        process.env.BEDROCK_REGION = previousBedrock;
      }
      if (previousAws === undefined) {
        delete process.env.AWS_REGION;
      } else {
        process.env.AWS_REGION = previousAws;
      }
    });

    it('accepts a region string in the constructor', async () => {
      const mockEmbedding = new Array(1536).fill(0.2);
      bedrockSendMock.mockResolvedValueOnce({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))) as any
      });

      const customService = new EmbeddingService('us-west-2');
      setMockClients(customService);
      const result = await customService.generateEmbedding('Custom region test');

      expect(result).toEqual(mockEmbedding);
    });

    it('throws when BEDROCK_MODEL_ID is missing', () => {
      const previousModelId = process.env.BEDROCK_MODEL_ID;
      delete process.env.BEDROCK_MODEL_ID;

      expect(() => new EmbeddingService()).toThrow('BEDROCK_MODEL_ID must be set');

      if (previousModelId === undefined) {
        delete process.env.BEDROCK_MODEL_ID;
      } else {
        process.env.BEDROCK_MODEL_ID = previousModelId;
      }
    });
  });

  describe('when generating an embedding for a single text', () => {
    it('should generate embedding vector from Bedrock Titan', async () => {
      // Arrange
      const inputText = 'AWS Lambda is a serverless compute service';
      const mockEmbedding = new Array(1536).fill(0).map((_, i) => i / 1536);

      bedrockSendMock.mockResolvedValueOnce({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))) as any
      });

      // Act
      const result = await service.generateEmbedding(inputText);

      // Assert
      expect(result).toHaveLength(1536);
      expect(result).toEqual(mockEmbedding);
      const command = bedrockSendMock.mock.calls[0]?.[0];
      expect(command).toBeInstanceOf(InvokeModelCommand);
      expect(command?.input).toMatchObject({
        modelId: 'amazon.titan-embed-text-v1',
        contentType: 'application/json',
        accept: 'application/json'
      });
    });

    it('should use cached embedding for repeated text', async () => {
      // Arrange
      const inputText = 'Cached content';
      const mockEmbedding = new Array(1536).fill(0.5);

      bedrockSendMock.mockResolvedValue({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))) as any
      });

      // Act
      await service.generateEmbedding(inputText);
      const cachedResult = await service.generateEmbedding(inputText);

      // Assert
      expect(cachedResult).toEqual(mockEmbedding);
      expect(bedrockSendMock).toHaveBeenCalledTimes(1);
    });

    it('should throw error when Bedrock API fails', async () => {
      // Arrange
      const inputText = 'Test content';
      bedrockSendMock.mockRejectedValueOnce(new Error('API Throttled'));

      // Act & Assert
      await expect(service.generateEmbedding(inputText)).rejects.toThrow('Failed to generate embedding');
    });

    it('should handle empty text input', async () => {
      // Arrange & Act & Assert
      await expect(service.generateEmbedding('')).rejects.toThrow('Text cannot be empty');
    });

    it('should handle very long text by truncating', async () => {
      // Arrange
      const longText = 'a'.repeat(10000);
      const mockEmbedding = new Array(1536).fill(0.1);

      bedrockSendMock.mockResolvedValueOnce({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))) as any
      });

      // Act
      const result = await service.generateEmbedding(longText);

      // Assert
      expect(result).toEqual(mockEmbedding);
      expect(bedrockSendMock).toHaveBeenCalled();
    });
  });

  describe('when generating embeddings in batch', () => {
    it('should generate embeddings for multiple texts', async () => {
      // Arrange
      const texts = [
        'First content piece',
        'Second content piece',
        'Third content piece'
      ];
      const mockEmbedding = new Array(1536).fill(0.3);

      bedrockSendMock.mockResolvedValue({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))) as any
      });

      // Act
      const results = await service.generateEmbeddings(texts);

      // Assert
      expect(results).toHaveLength(3);
      expect(results[0]).toHaveLength(1536);
      expect(bedrockSendMock).toHaveBeenCalledTimes(3);
    });

    it('should use cached embeddings in batch processing', async () => {
      // Arrange
      const texts = ['Content A', 'Content B', 'Content A']; // Duplicate
      const mockEmbedding = new Array(1536).fill(0.4);

      bedrockSendMock.mockResolvedValue({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))) as any
      });

      // Act
      const results = await service.generateEmbeddings(texts);

      // Assert
      expect(results).toHaveLength(3);
      expect(bedrockSendMock).toHaveBeenCalledTimes(2); // Only 2 unique
    });

    it('should handle partial failures in batch', async () => {
      // Arrange
      const texts = ['Good content', 'Bad content', 'Good content 2'];
      let callCount = 0;

      bedrockSendMock.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error('API Error');
        }
        return {
          body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
            embedding: new Array(1536).fill(0.5)
          }))) as any
        };
      });

      // Act & Assert
      await expect(service.generateEmbeddings(texts)).rejects.toThrow('Failed to generate embeddings');
    });

    it('should process empty array', async () => {
      // Act
      const results = await service.generateEmbeddings([]);

      // Assert
      expect(results).toEqual([]);
      expect(bedrockSendMock).not.toHaveBeenCalled();
    });
  });

  describe('when updating content embedding', () => {
    it('should generate embedding from title and description', async () => {
      // Arrange
      const title = 'Building Serverless Apps with AWS';
      const description = 'A comprehensive guide to AWS Lambda and serverless architecture';
      const mockEmbedding = new Array(1536).fill(0.6);

      bedrockSendMock.mockResolvedValueOnce({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))) as any
      });

      // Act
      const result = await service.generateContentEmbedding(title, description);

      // Assert
      expect(result).toEqual(mockEmbedding);
      const command = bedrockSendMock.mock.calls[0]?.[0];
      const bodyStr = new TextDecoder().decode(command.input.body as Uint8Array);
      const body = JSON.parse(bodyStr);
      expect(body.inputText).toContain(title);
      expect(body.inputText).toContain(description);
    });

    it('should handle content with only title', async () => {
      // Arrange
      const title = 'AWS Lambda Tutorial';
      const mockEmbedding = new Array(1536).fill(0.7);

      bedrockSendMock.mockResolvedValueOnce({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))) as any
      });

      // Act
      const result = await service.generateContentEmbedding(title);

      // Assert
      expect(result).toEqual(mockEmbedding);
    });

    it('should return null for empty title and description', async () => {
      // Act
      const result = await service.generateContentEmbedding('', '');

      // Assert
      expect(result).toBeNull();
      expect(bedrockSendMock).not.toHaveBeenCalled();
    });
  });

  describe('when handling rate limits', () => {
    it('should retry on throttling errors', async () => {
      // Arrange
      const inputText = 'Rate limited content';
      const mockEmbedding = new Array(1536).fill(0.8);
      let attemptCount = 0;

      bedrockSendMock.mockImplementation(() => {
        attemptCount++;
        if (attemptCount === 1) {
          const error: any = new Error('ThrottlingException');
          error.name = 'ThrottlingException';
          throw error;
        }
        return {
          body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
            embedding: mockEmbedding
          }))) as any
        };
      });

      // Act
      const result = await service.generateEmbedding(inputText);

      // Assert
      expect(result).toEqual(mockEmbedding);
      expect(attemptCount).toBe(2);
    });

    it('should fail after max retries', async () => {
      // Arrange
      const inputText = 'Always throttled';

      bedrockSendMock.mockImplementation(() => {
        const error: any = new Error('ThrottlingException');
        error.name = 'ThrottlingException';
        throw error;
      });

      // Act & Assert
      await expect(service.generateEmbedding(inputText)).rejects.toThrow('Failed to generate embedding');
    });
  });

  describe('cache management', () => {
    it('should clear cache', async () => {
      // Arrange
      const inputText = 'Cacheable content';
      const mockEmbedding = new Array(1536).fill(0.9);

      bedrockSendMock.mockResolvedValue({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))) as any
      });

      // Act
      await service.generateEmbedding(inputText);
      service.clearCache();
      await service.generateEmbedding(inputText);

      // Assert
      expect(bedrockSendMock).toHaveBeenCalledTimes(2);
    });

    it('should get cache stats', async () => {
      // Arrange
      const mockEmbedding = new Array(1536).fill(0.1);
      bedrockSendMock.mockResolvedValue({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))) as any
      });

      // Act
      await service.generateEmbedding('text1');
      await service.generateEmbedding('text2');
      await service.generateEmbedding('text1'); // Cache hit
      const stats = service.getCacheStats();

      // Assert
      expect(stats.size).toBe(2);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
    });
  });

  describe('performance metrics', () => {
    it('returns zeroed metrics when no calls have been made', () => {
      const metrics = service.getPerformanceMetrics();

      expect(metrics.apiCalls).toBe(0);
      expect(metrics.averageLatency).toBe(0);
      expect(metrics.cacheHitRate).toBe(0);
    });

    it('should track API calls and latency', async () => {
      // Arrange
      const mockEmbedding = new Array(1536).fill(0.5);
      bedrockSendMock.mockResolvedValue({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))) as any
      });

      // Act
      await service.generateEmbedding('text1');
      await service.generateEmbedding('text2');
      const metrics = service.getPerformanceMetrics();

      // Assert
      expect(metrics.apiCalls).toBe(2);
      expect(metrics.averageLatency).toBeGreaterThanOrEqual(0); // Can be 0 in tests due to fast mocks
      expect(metrics.cacheHitRate).toBe(0); // No cache hits yet
    });

    it('should calculate cache hit rate correctly', async () => {
      // Arrange
      const mockEmbedding = new Array(1536).fill(0.5);
      bedrockSendMock.mockResolvedValue({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))) as any
      });

      // Act
      await service.generateEmbedding('text1');
      await service.generateEmbedding('text1'); // Cache hit
      const metrics = service.getPerformanceMetrics();

      // Assert
      expect(metrics.cacheHitRate).toBe(50); // 1 hit, 1 miss = 50%
    });
  });

  describe('error handling', () => {
    it('should handle empty response body from Bedrock', async () => {
      // Arrange
      bedrockSendMock.mockResolvedValueOnce({
        body: undefined
      });

      // Act & Assert
      await expect(service.generateEmbedding('test')).rejects.toThrow('Empty response from Bedrock');
    });

    it('should handle invalid embedding format', async () => {
      // Arrange
      bedrockSendMock.mockResolvedValueOnce({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          notEmbedding: []
        }))) as any
      });

      // Act & Assert
      await expect(service.generateEmbedding('test')).rejects.toThrow('Invalid embedding format in response');
    });

    it('should handle non-array embedding in response', async () => {
      // Arrange
      bedrockSendMock.mockResolvedValueOnce({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          embedding: 'not-an-array'
        }))) as any
      });

      // Act & Assert
      await expect(service.generateEmbedding('test')).rejects.toThrow('Invalid embedding format in response');
    });

    it('should not retry on non-throttling errors', async () => {
      // Arrange
      const error: any = new Error('ValidationException');
      error.name = 'ValidationException';
      bedrockSendMock.mockRejectedValueOnce(error);

      // Act & Assert
      await expect(service.generateEmbedding('test')).rejects.toThrow('Failed to generate embedding');
      expect(bedrockSendMock).toHaveBeenCalledTimes(1); // No retries
    });
  });

  describe('CloudWatch metrics publishing', () => {
    it('should publish metrics on successful embedding generation', async () => {
      // Arrange
      const mockEmbedding = new Array(1536).fill(0.5);
      bedrockSendMock.mockResolvedValue({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))) as any
      });

      // Act
      await service.generateEmbedding('test content');

      // Wait for async metrics publishing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert - should have published metrics
      expect(cloudwatchSendMock).toHaveBeenCalled();
    });

    it('should handle metrics publishing failures gracefully', async () => {
      // Arrange
      const mockEmbedding = new Array(1536).fill(0.5);
      bedrockSendMock.mockResolvedValueOnce({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))) as any
      });
      cloudwatchSendMock.mockReset();
      cloudwatchSendMock.mockRejectedValueOnce(new Error('CloudWatch error'));

      // Act - should not throw even if metrics fail
      const result = await service.generateEmbedding('test content');

      // Assert
      expect(result).toEqual(mockEmbedding);
    });

    it('includes estimated cost metric with required dimensions', async () => {
      const mockEmbedding = new Array(1536).fill(0.5);
      bedrockSendMock.mockResolvedValueOnce({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))) as any
      });

      await service.generateEmbedding('cost metric validation');
      await new Promise(resolve => setTimeout(resolve, 100));

      const calls = cloudwatchSendMock.mock.calls
        .map(call => call[0])
        .filter(command => command instanceof PutMetricDataCommand);
      expect(calls.length).toBeGreaterThan(0);
      const metricData = calls[0].input.MetricData;
      const metricNames = (metricData ?? []).map(metric => metric.MetricName);

      expect(metricNames).toEqual(expect.arrayContaining([
        'EmbeddingAPICallCount',
        'EmbeddingAPILatency',
        'EstimatedCost',
        'CacheHitRate'
      ]));

      const estimatedCostMetric = metricData?.find(metric => metric.MetricName === 'EstimatedCost');
      expect(estimatedCostMetric).toBeDefined();
      expect(estimatedCostMetric?.Dimensions).toEqual(expect.arrayContaining([
        expect.objectContaining({ Name: 'ModelId', Value: 'amazon.titan-embed-text-v1' }),
        expect.objectContaining({ Name: 'Service', Value: 'Bedrock' })
      ]));
    });
  });

  describe('embedding update strategy', () => {
    it('should regenerate embedding when title changes', () => {
      // Arrange
      const oldTitle = 'Old Title';
      const oldDescription = 'Description text';
      const newTitle = 'New Title';

      // Act
      const result = service.shouldRegenerateEmbedding(
        oldTitle,
        oldDescription,
        newTitle,
        undefined
      );

      // Assert
      expect(result).toBe(true);
    });

    it('should regenerate embedding when description changes', () => {
      // Arrange
      const oldTitle = 'Title';
      const oldDescription = 'Old description';
      const newDescription = 'New description';

      // Act
      const result = service.shouldRegenerateEmbedding(
        oldTitle,
        oldDescription,
        undefined,
        newDescription
      );

      // Assert
      expect(result).toBe(true);
    });

    it('should regenerate embedding when both title and description change', () => {
      // Arrange
      const oldTitle = 'Old Title';
      const oldDescription = 'Old description';
      const newTitle = 'New Title';
      const newDescription = 'New description';

      // Act
      const result = service.shouldRegenerateEmbedding(
        oldTitle,
        oldDescription,
        newTitle,
        newDescription
      );

      // Assert
      expect(result).toBe(true);
    });

    it('should not regenerate embedding when nothing changes', () => {
      // Arrange
      const oldTitle = 'Title';
      const oldDescription = 'Description';

      // Act
      const result = service.shouldRegenerateEmbedding(
        oldTitle,
        oldDescription
      );

      // Assert
      expect(result).toBe(false);
    });

    it('should not regenerate when new values are same as old values', () => {
      // Arrange
      const oldTitle = 'Same Title';
      const oldDescription = 'Same Description';
      const newTitle = 'Same Title';
      const newDescription = 'Same Description';

      // Act
      const result = service.shouldRegenerateEmbedding(
        oldTitle,
        oldDescription,
        newTitle,
        newDescription
      );

      // Assert
      expect(result).toBe(false);
    });

    it('should regenerate when title is provided and different from old', () => {
      // Arrange
      const oldTitle = 'Original';
      const oldDescription = 'Desc';
      const newTitle = 'Updated';

      // Act
      const result = service.shouldRegenerateEmbedding(
        oldTitle,
        oldDescription,
        newTitle
      );

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('configuration overrides', () => {
    it('respects BEDROCK_MODEL_ID environment variable', async () => {
      process.env.BEDROCK_MODEL_ID = 'custom.model';
      const customService = new EmbeddingService();
      setMockClients(customService);
      const mockEmbedding = new Array(1536).fill(0.2);

      bedrockSendMock.mockResolvedValueOnce({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({ embedding: mockEmbedding }))) as any
      });

      await customService.generateEmbedding('env-configured content');

      const calls = bedrockSendMock.mock.calls;
      expect(calls[0]?.[0]?.input?.modelId).toBe('custom.model');
    });

    it('accepts explicit region and model overrides via constructor options', async () => {
      const customService = new EmbeddingService({ region: 'us-west-2', modelId: 'custom.model' });
      setMockClients(customService);
      const mockEmbedding = new Array(1536).fill(0.7);

      bedrockSendMock.mockResolvedValueOnce({
        body: new Uint8Array(new TextEncoder().encode(JSON.stringify({ embedding: mockEmbedding }))) as any
      });

      await customService.generateEmbedding('explicit configuration');

      const calls = bedrockSendMock.mock.calls;
      expect(calls[0]?.[0]?.input?.modelId).toBe('custom.model');
    });
  });
});
