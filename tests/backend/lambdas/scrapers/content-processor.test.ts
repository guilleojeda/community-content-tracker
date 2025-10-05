import { SQSEvent, SQSRecord, Context } from 'aws-lambda';
import { ContentRepository } from '../../../../src/backend/repositories/ContentRepository';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { ContentProcessorMessage, ContentType } from '../../../../src/shared/types';

// Create mock functions that will be used
const mockFindByUrl = jest.fn();
const mockCreateContent = jest.fn();
const mockUpdateWithEmbedding = jest.fn();
const mockBedrockSend = jest.fn();
const mockCloudWatchSend = jest.fn();
const mockPoolQuery = jest.fn();

// Mock dependencies - must be done before importing handler
jest.mock('../../../../src/backend/repositories/ContentRepository', () => {
  return {
    ContentRepository: jest.fn().mockImplementation(() => ({
      findByUrl: mockFindByUrl,
      createContent: mockCreateContent,
      updateWithEmbedding: mockUpdateWithEmbedding,
    })),
  };
});

jest.mock('@aws-sdk/client-bedrock-runtime', () => {
  return {
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
      send: mockBedrockSend,
    })),
    InvokeModelCommand: jest.fn().mockImplementation((input) => ({ input })),
  };
});

jest.mock('@aws-sdk/client-cloudwatch', () => {
  return {
    CloudWatchClient: jest.fn().mockImplementation(() => ({
      send: mockCloudWatchSend,
    })),
    PutMetricDataCommand: jest.fn().mockImplementation((input) => ({ input })),
    StandardUnit: {
      Count: 'Count',
      Milliseconds: 'Milliseconds',
      None: 'None',
    },
  };
});

// Mock pg Pool
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: mockPoolQuery,
    connect: jest.fn(),
    end: jest.fn(),
  })),
}));

// Import handler AFTER mocks are set up
import { handler } from '../../../../src/backend/lambdas/scrapers/content-processor';

const mockContentRepository = ContentRepository as jest.MockedClass<typeof ContentRepository>;
const mockBedrockClient = BedrockRuntimeClient as jest.MockedClass<typeof BedrockRuntimeClient>;
const mockCloudWatchClient = CloudWatchClient as jest.MockedClass<typeof CloudWatchClient>;

// Get Pool mock
const { Pool } = require('pg');
const MockPool = Pool as jest.MockedClass<typeof Pool>;

describe('Content Processor Lambda', () => {
  let mockContext: Context;

  beforeEach(() => {
    jest.clearAllMocks();
    mockContext = {} as Context;
    process.env.BEDROCK_MODEL_ID = 'amazon.titan-embed-text-v1';
    process.env.BEDROCK_REGION = 'us-east-1';
    process.env.AWS_REGION = 'us-east-1';
    process.env.ENVIRONMENT = 'test';
  });

  const createSQSRecord = (message: ContentProcessorMessage): SQSRecord => ({
    messageId: 'test-message-id',
    receiptHandle: 'test-receipt-handle',
    body: JSON.stringify(message),
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '1234567890',
      SenderId: 'test-sender',
      ApproximateFirstReceiveTimestamp: '1234567890',
    },
    messageAttributes: {},
    md5OfBody: 'test-md5',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789:test-queue',
    awsRegion: 'us-east-1',
  });

  const createEvent = (messages: ContentProcessorMessage[]): SQSEvent => ({
    Records: messages.map(createSQSRecord),
  });

  describe('Success Cases - New Content', () => {
    it('should process new content with embedding generation', async () => {
      const message: ContentProcessorMessage = {
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Test Blog Post',
        description: 'This is a test description',
        contentType: ContentType.BLOG,
        url: 'https://example.com/blog/test-post',
        publishDate: '2024-01-01T00:00:00Z',
        metadata: { source: 'rss' },
      };

      const mockEmbedding = [0.1, 0.2, 0.3];
      const mockContent = {
        id: 'content-1',
        userId: 'user-1',
        title: message.title,
        contentType: message.contentType,
        visibility: 'private',
        urls: [message.url],
      };

      mockFindByUrl.mockResolvedValue(null);
      mockPoolQuery.mockResolvedValue({
        rows: [{ default_visibility: 'private' }],
      });
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({ embedding: mockEmbedding })),
      });
      mockCreateContent.mockResolvedValue(mockContent);
      mockUpdateWithEmbedding.mockResolvedValue({});
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent([message]);
      await handler(event, mockContext);

      expect(mockFindByUrl).toHaveBeenCalledWith(message.url);
      expect(mockBedrockSend).toHaveBeenCalledWith(expect.any(InvokeModelCommand));
      expect(mockCreateContent).toHaveBeenCalledWith({
        userId: message.userId,
        title: message.title,
        description: message.description,
        contentType: message.contentType,
        visibility: 'private',
        urls: [message.url],
        publishDate: new Date(message.publishDate!),
        tags: [],
      });
      expect(mockUpdateWithEmbedding).toHaveBeenCalledWith('content-1', {
        embedding: mockEmbedding,
        metadata: message.metadata,
      });
    });

    it('should use user default visibility when creating content', async () => {
      const message: ContentProcessorMessage = {
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Public Post',
        contentType: ContentType.BLOG,
        url: 'https://example.com/public',
      };

      mockFindByUrl.mockResolvedValue(null);
      mockPoolQuery.mockResolvedValue({
        rows: [{ default_visibility: 'public' }],
      });
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({ embedding: [0.1, 0.2] })),
      });
      mockCreateContent.mockResolvedValue({ id: 'content-1' });
      mockUpdateWithEmbedding.mockResolvedValue({});
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent([message]);
      await handler(event, mockContext);

      expect(mockCreateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          visibility: 'public',
        })
      );
    });

    it('should handle content without publishDate', async () => {
      const message: ContentProcessorMessage = {
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Undated Post',
        contentType: ContentType.BLOG,
        url: 'https://example.com/undated',
      };

      mockFindByUrl.mockResolvedValue(null);
      mockPoolQuery.mockResolvedValue({
        rows: [{ default_visibility: 'private' }],
      });
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({ embedding: [0.1] })),
      });
      mockCreateContent.mockResolvedValue({ id: 'content-1' });
      mockUpdateWithEmbedding.mockResolvedValue({});
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent([message]);
      await handler(event, mockContext);

      expect(mockCreateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          publishDate: undefined,
        })
      );
    });

    it('should create content without embedding when generation fails', async () => {
      const message: ContentProcessorMessage = {
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Test Post',
        contentType: ContentType.BLOG,
        url: 'https://example.com/test',
      };

      mockFindByUrl.mockResolvedValue(null);
      mockPoolQuery.mockResolvedValue({
        rows: [{ default_visibility: 'private' }],
      });
      mockBedrockSend.mockRejectedValue(new Error('Bedrock error'));
      mockCreateContent.mockResolvedValue({ id: 'content-1' });
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent([message]);
      await handler(event, mockContext);

      expect(mockCreateContent).toHaveBeenCalled();
      expect(mockUpdateWithEmbedding).not.toHaveBeenCalled();
    });
  });

  describe('Success Cases - Content Updates', () => {
    it('should update existing content when publishDate is newer', async () => {
      const message: ContentProcessorMessage = {
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Updated Post',
        description: 'Updated description',
        contentType: ContentType.BLOG,
        url: 'https://example.com/existing',
        publishDate: '2024-01-02T00:00:00Z',
        metadata: { updated: true },
      };

      const existingContent = {
        id: 'content-1',
        userId: 'user-1',
        publishDate: new Date('2024-01-01T00:00:00Z'),
      };

      const mockEmbedding = [0.5, 0.6];

      mockFindByUrl.mockResolvedValue(existingContent);
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({ embedding: mockEmbedding })),
      });
      mockUpdateWithEmbedding.mockResolvedValue({});
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent([message]);
      await handler(event, mockContext);

      expect(mockUpdateWithEmbedding).toHaveBeenCalledWith('content-1', {
        title: message.title,
        description: message.description,
        publishDate: new Date(message.publishDate!),
        embedding: mockEmbedding,
        metadata: message.metadata,
      });
      expect(mockCreateContent).not.toHaveBeenCalled();
    });

    it('should skip update when publishDate is older or equal', async () => {
      const message: ContentProcessorMessage = {
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Old Post',
        contentType: ContentType.BLOG,
        url: 'https://example.com/existing',
        publishDate: '2024-01-01T00:00:00Z',
      };

      const existingContent = {
        id: 'content-1',
        userId: 'user-1',
        publishDate: new Date('2024-01-02T00:00:00Z'),
      };

      mockFindByUrl.mockResolvedValue(existingContent);
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent([message]);
      await handler(event, mockContext);

      expect(mockUpdateWithEmbedding).not.toHaveBeenCalled();
      expect(mockCreateContent).not.toHaveBeenCalled();
      expect(mockBedrockSend).not.toHaveBeenCalled();
    });

    it('should skip duplicate content without publishDate', async () => {
      const message: ContentProcessorMessage = {
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Duplicate',
        contentType: ContentType.BLOG,
        url: 'https://example.com/duplicate',
      };

      const existingContent = {
        id: 'content-1',
        userId: 'user-1',
        publishDate: null,
      };

      mockFindByUrl.mockResolvedValue(existingContent);
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent([message]);
      await handler(event, mockContext);

      expect(mockUpdateWithEmbedding).not.toHaveBeenCalled();
      expect(mockCreateContent).not.toHaveBeenCalled();
    });
  });

  describe('Embedding Generation', () => {
    it('should generate embedding from title and description', async () => {
      const message: ContentProcessorMessage = {
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Amazing Post',
        description: 'With detailed content',
        contentType: ContentType.BLOG,
        url: 'https://example.com/amazing',
      };

      mockFindByUrl.mockResolvedValue(null);
      mockPoolQuery.mockResolvedValue({
        rows: [{ default_visibility: 'private' }],
      });
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({ embedding: [0.1, 0.2, 0.3] })),
      });
      mockCreateContent.mockResolvedValue({ id: 'content-1' });
      mockUpdateWithEmbedding.mockResolvedValue({});
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent([message]);
      await handler(event, mockContext);

      // Verify Bedrock was called
      expect(mockBedrockSend).toHaveBeenCalled();

      // Check the command passed to send()
      const bedrockCommand = mockBedrockSend.mock.calls[0][0];
      expect(bedrockCommand.input.modelId).toBe('amazon.titan-embed-text-v1');

      const requestBody = JSON.parse(bedrockCommand.input.body);
      expect(requestBody.inputText).toBe('Amazing Post With detailed content');
    });

    it('should handle empty embedding response', async () => {
      const message: ContentProcessorMessage = {
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Test',
        contentType: ContentType.BLOG,
        url: 'https://example.com/test',
      };

      mockFindByUrl.mockResolvedValue(null);
      mockPoolQuery.mockResolvedValue({
        rows: [{ default_visibility: 'private' }],
      });
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({ embedding: [] })),
      });
      mockCreateContent.mockResolvedValue({ id: 'content-1' });
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent([message]);
      await handler(event, mockContext);

      expect(mockUpdateWithEmbedding).not.toHaveBeenCalled();
    });

    it('should return empty embedding on Bedrock error', async () => {
      const message: ContentProcessorMessage = {
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Test',
        contentType: ContentType.BLOG,
        url: 'https://example.com/test',
      };

      mockFindByUrl.mockResolvedValue(null);
      mockPoolQuery.mockResolvedValue({
        rows: [{ default_visibility: 'private' }],
      });
      mockBedrockSend.mockRejectedValue(new Error('BEDROCK service unavailable'));
      mockCreateContent.mockResolvedValue({ id: 'content-1' });
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent([message]);
      await handler(event, mockContext);

      expect(mockCreateContent).toHaveBeenCalled();
      expect(mockUpdateWithEmbedding).not.toHaveBeenCalled();
    });
  });

  describe('CloudWatch Metrics', () => {
    it('should publish metrics for successful processing', async () => {
      const message: ContentProcessorMessage = {
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Test',
        contentType: ContentType.BLOG,
        url: 'https://example.com/test',
      };

      mockFindByUrl.mockResolvedValue(null);
      mockPoolQuery.mockResolvedValue({
        rows: [{ default_visibility: 'private' }],
      });
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({ embedding: [0.1] })),
      });
      mockCreateContent.mockResolvedValue({ id: 'content-1' });
      mockUpdateWithEmbedding.mockResolvedValue({});
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent([message]);
      await handler(event, mockContext);

      expect(mockCloudWatchSend).toHaveBeenCalledTimes(4);

      // Verify metric types - check commands passed to send()
      const metricCalls = mockCloudWatchSend.mock.calls;
      const metricNames = metricCalls
        .filter(call => call[0] && call[0].input && call[0].input.MetricData)
        .map(call => call[0].input.MetricData[0].MetricName);

      expect(metricNames).toContain('MessagesProcessed');
      expect(metricNames).toContain('MessagesFailed');
      expect(metricNames).toContain('ProcessingTime');
      expect(metricNames).toContain('ProcessingRate');
    });

    it('should not fail processing if metrics publishing fails', async () => {
      const message: ContentProcessorMessage = {
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Test',
        contentType: ContentType.BLOG,
        url: 'https://example.com/test',
      };

      mockFindByUrl.mockResolvedValue(null);
      mockPoolQuery.mockResolvedValue({
        rows: [{ default_visibility: 'private' }],
      });
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({ embedding: [0.1] })),
      });
      mockCreateContent.mockResolvedValue({ id: 'content-1' });
      mockUpdateWithEmbedding.mockResolvedValue({});
      mockCloudWatchSend.mockRejectedValue(new Error('CloudWatch error'));

      const event = createEvent([message]);

      await expect(handler(event, mockContext)).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should throw BEDROCK error to send message to DLQ', async () => {
      const message: ContentProcessorMessage = {
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Test',
        contentType: ContentType.BLOG,
        url: 'https://example.com/test',
      };

      mockFindByUrl.mockRejectedValue(new Error('BEDROCK critical error'));
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent([message]);

      await expect(handler(event, mockContext)).rejects.toThrow('BEDROCK');
    });

    it('should throw DATABASE error to send message to DLQ', async () => {
      const message: ContentProcessorMessage = {
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Test',
        contentType: ContentType.BLOG,
        url: 'https://example.com/test',
      };

      mockFindByUrl.mockRejectedValue(new Error('DATABASE connection failed'));
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent([message]);

      await expect(handler(event, mockContext)).rejects.toThrow('DATABASE');
    });

    it('should handle non-critical errors gracefully', async () => {
      const message: ContentProcessorMessage = {
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Test',
        contentType: ContentType.BLOG,
        url: 'https://example.com/test',
      };

      mockFindByUrl.mockResolvedValue(null);
      mockPoolQuery.mockRejectedValue(new Error('User query failed'));
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent([message]);

      await expect(handler(event, mockContext)).resolves.not.toThrow();
    });

    it('should continue processing other messages after error', async () => {
      const messages: ContentProcessorMessage[] = [
        {
          userId: 'user-1',
          channelId: 'channel-1',
          title: 'Bad Message',
          contentType: ContentType.BLOG,
          url: 'https://example.com/bad',
        },
        {
          userId: 'user-2',
          channelId: 'channel-2',
          title: 'Good Message',
          contentType: ContentType.BLOG,
          url: 'https://example.com/good',
        },
      ];

      mockFindByUrl
        .mockRejectedValueOnce(new Error('Error on first'))
        .mockResolvedValueOnce(null);

      mockPoolQuery.mockResolvedValue({
        rows: [{ default_visibility: 'private' }],
      });
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({ embedding: [0.1] })),
      });
      mockCreateContent.mockResolvedValue({ id: 'content-1' });
      mockUpdateWithEmbedding.mockResolvedValue({});
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent(messages);
      await handler(event, mockContext);

      expect(mockCreateContent).toHaveBeenCalledTimes(1);
    });
  });

  describe('Batch Processing', () => {
    it('should process multiple messages in sequence', async () => {
      const messages: ContentProcessorMessage[] = [
        {
          userId: 'user-1',
          channelId: 'channel-1',
          title: 'Post 1',
          contentType: ContentType.BLOG,
          url: 'https://example.com/post-1',
        },
        {
          userId: 'user-2',
          channelId: 'channel-2',
          title: 'Post 2',
          contentType: ContentType.YOUTUBE,
          url: 'https://example.com/post-2',
        },
        {
          userId: 'user-3',
          channelId: 'channel-3',
          title: 'Post 3',
          contentType: ContentType.PODCAST,
          url: 'https://example.com/post-3',
        },
      ];

      mockFindByUrl.mockResolvedValue(null);
      mockPoolQuery.mockResolvedValue({
        rows: [{ default_visibility: 'private' }],
      });
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({ embedding: [0.1, 0.2, 0.3] })),
      });
      mockCreateContent.mockResolvedValue({ id: 'content-1' });
      mockUpdateWithEmbedding.mockResolvedValue({});
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent(messages);
      await handler(event, mockContext);

      expect(mockFindByUrl).toHaveBeenCalledTimes(3);
      expect(mockCreateContent).toHaveBeenCalledTimes(3);
      expect(mockBedrockSend).toHaveBeenCalledTimes(3);
    });

    it('should report correct metrics for batch processing', async () => {
      const messages: ContentProcessorMessage[] = [
        {
          userId: 'user-1',
          channelId: 'channel-1',
          title: 'Success 1',
          contentType: ContentType.BLOG,
          url: 'https://example.com/success-1',
        },
        {
          userId: 'user-2',
          channelId: 'channel-2',
          title: 'Failed',
          contentType: ContentType.BLOG,
          url: 'https://example.com/failed',
        },
        {
          userId: 'user-3',
          channelId: 'channel-3',
          title: 'Success 2',
          contentType: ContentType.BLOG,
          url: 'https://example.com/success-2',
        },
      ];

      mockFindByUrl
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce(null);

      mockPoolQuery.mockResolvedValue({
        rows: [{ default_visibility: 'private' }],
      });
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({ embedding: [0.1] })),
      });
      mockCreateContent.mockResolvedValue({ id: 'content-1' });
      mockUpdateWithEmbedding.mockResolvedValue({});
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent(messages);
      await handler(event, mockContext);

      // Find the MessagesProcessed metric call
      const processedMetric = mockCloudWatchSend.mock.calls.find(
        call => call[0] && call[0].input && call[0].input.MetricData &&
                call[0].input.MetricData[0].MetricName === 'MessagesProcessed'
      );
      expect(processedMetric).toBeDefined();
      expect(processedMetric![0].input.MetricData[0].Value).toBe(2);

      // Find the MessagesFailed metric call
      const failedMetric = mockCloudWatchSend.mock.calls.find(
        call => call[0] && call[0].input && call[0].input.MetricData &&
                call[0].input.MetricData[0].MetricName === 'MessagesFailed'
      );
      expect(failedMetric).toBeDefined();
      expect(failedMetric![0].input.MetricData[0].Value).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed message body', async () => {
      const event: SQSEvent = {
        Records: [
          {
            messageId: 'test',
            receiptHandle: 'test',
            body: 'invalid json',
            attributes: {} as any,
            messageAttributes: {},
            md5OfBody: 'test',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn',
            awsRegion: 'us-east-1',
          },
        ],
      };

      mockCloudWatchSend.mockResolvedValue({});

      await expect(handler(event, mockContext)).resolves.not.toThrow();
    });

    it('should handle user not found (default to private)', async () => {
      const message: ContentProcessorMessage = {
        userId: 'nonexistent-user',
        channelId: 'channel-1',
        title: 'Test',
        contentType: ContentType.BLOG,
        url: 'https://example.com/test',
      };

      mockFindByUrl.mockResolvedValue(null);
      mockPoolQuery.mockResolvedValue({ rows: [] }); // No user found
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({ embedding: [0.1] })),
      });
      mockCreateContent.mockResolvedValue({ id: 'content-1' });
      mockUpdateWithEmbedding.mockResolvedValue({});
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent([message]);
      await handler(event, mockContext);

      expect(mockCreateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          visibility: 'private',
        })
      );
    });

    it('should handle empty SQS event', async () => {
      const event: SQSEvent = { Records: [] };
      mockCloudWatchSend.mockResolvedValue({});

      await handler(event, mockContext);

      expect(mockFindByUrl).not.toHaveBeenCalled();
      expect(mockCreateContent).not.toHaveBeenCalled();
    });
  });
});
