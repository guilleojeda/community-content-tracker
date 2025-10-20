import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/content/detect-duplicates';
import { getDatabasePool } from '../../../../src/backend/services/database';

jest.mock('../../../../src/backend/services/database');

// Mock CloudWatch SDK
jest.mock('@aws-sdk/client-cloudwatch', () => {
  // Create mock inside the factory to avoid hoisting issues
  const mockSend = jest.fn().mockResolvedValue({});

  // Mock the PutMetricDataCommand constructor to store input
  class MockPutMetricDataCommand {
    public input: any;

    constructor(input: any) {
      this.input = input;
    }
  }

  return {
    CloudWatchClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    PutMetricDataCommand: MockPutMetricDataCommand,
    // Export the mock send so we can access it in tests
    __getMockSend: () => mockSend,
  };
});

// Get the mock send function after module is loaded
const { __getMockSend } = require('@aws-sdk/client-cloudwatch');
const mockCloudWatchSendFn = __getMockSend();

describe('Detect Duplicates Lambda', () => {
  const mockPool = {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
    mockCloudWatchSendFn.mockResolvedValue({});
  });

  const createMockEvent = (
    userId: string = 'user-123',
    method: string = 'GET'
  ): APIGatewayProxyEvent => ({
    httpMethod: method,
    path: '/content/duplicates',
    headers: {},
    body: null,
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123',
      apiId: 'api-id',
      protocol: 'HTTP/1.1',
      httpMethod: method,
      path: '/content/duplicates',
      stage: 'test',
      requestId: 'request-id',
      requestTimeEpoch: 0,
      resourceId: 'resource-id',
      resourcePath: '/content/duplicates',
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: 'test-agent',
        userArn: null,
      },
      authorizer: {
        userId,
        claims: { sub: userId },
      },
    },
    resource: '/content/duplicates',
  } as any);

  it('should detect title similarity duplicates', async () => {
    const event = createMockEvent();

    mockPool.query.mockResolvedValue({
      rows: [
        {
          id1: 'content-1',
          id2: 'content-2',
          title1: 'AWS Lambda Tutorial',
          title2: 'AWS Lambda Tutorial - Part 1',
          similarity: 0.95,
          similarity_type: 'title',
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.duplicates).toHaveLength(1);
    expect(body.data.duplicates[0].similarityType).toBe('title');
    expect(body.data.duplicates[0].similarity).toBe(0.95);
  });

  it('should detect URL duplicates', async () => {
    const event = createMockEvent();

    mockPool.query.mockResolvedValue({
      rows: [
        {
          id1: 'content-1',
          id2: 'content-2',
          title1: 'Blog Post',
          title2: 'Same Blog Post',
          similarity: 1.0,
          similarity_type: 'url',
          url: 'https://example.com/blog',
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.duplicates[0].similarityType).toBe('url');
    expect(body.data.duplicates[0].url).toBe('https://example.com/blog');
  });

  it('should detect embedding similarity duplicates', async () => {
    const event = createMockEvent();

    mockPool.query.mockResolvedValue({
      rows: [
        {
          id1: 'content-1',
          id2: 'content-2',
          title1: 'How to use AWS Lambda',
          title2: 'AWS Lambda usage guide',
          similarity: 0.97,
          similarity_type: 'embedding',
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.duplicates[0].similarityType).toBe('embedding');
  });

  it('should return empty array when no duplicates found', async () => {
    const event = createMockEvent();

    mockPool.query.mockResolvedValue({ rows: [] });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.duplicates).toHaveLength(0);
  });

  it('should require authentication', async () => {
    const event = createMockEvent();
    delete (event.requestContext as any).authorizer;

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('should detect URL duplicates with normalization (http vs https, www vs non-www)', async () => {
    const event = createMockEvent();

    // Mock the title similarity query to return no results
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    // Mock the URL fetch query to return content with URL variants
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'content-1',
          title: 'Blog Post Version 1',
          url: 'http://www.example.com/blog',
        },
        {
          id: 'content-2',
          title: 'Blog Post Version 2',
          url: 'https://example.com/blog/',
        },
        {
          id: 'content-3',
          title: 'Blog Post Version 3',
          url: 'http://example.com/blog?utm_source=twitter',
        },
      ],
    });

    // Mock the embedding similarity query to return no results
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);

    // Should detect 3 duplicate pairs: (1,2), (1,3), (2,3)
    // All three URLs normalize to the same value
    expect(body.data.duplicates.length).toBeGreaterThanOrEqual(3);

    // Verify that URL duplicates were detected
    const urlDuplicates = body.data.duplicates.filter(
      (d: any) => d.similarityType === 'url'
    );
    expect(urlDuplicates.length).toBe(3);

    // All should have similarity of 1.0
    urlDuplicates.forEach((dup: any) => {
      expect(dup.similarity).toBe(1.0);
    });

    // Verify the normalized URL is returned
    expect(urlDuplicates[0].url).toBe('https://example.com/blog');
  });

  it('should not detect duplicates for different normalized URLs', async () => {
    const event = createMockEvent();

    mockPool.query.mockResolvedValueOnce({ rows: [] });

    // URLs that should NOT be considered duplicates after normalization
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'content-1',
          title: 'Blog Post',
          url: 'https://example.com/blog1',
        },
        {
          id: 'content-2',
          title: 'Different Blog Post',
          url: 'https://example.com/blog2',
        },
      ],
    });

    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);

    // Should not detect any URL duplicates
    const urlDuplicates = body.data.duplicates.filter(
      (d: any) => d.similarityType === 'url'
    );
    expect(urlDuplicates.length).toBe(0);
  });

  it('should persist detected duplicates to duplicate_pairs table', async () => {
    const event = createMockEvent();

    // Mock title similarity query
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id1: 'content-1',
          id2: 'content-2',
          title1: 'AWS Lambda Tutorial',
          title2: 'AWS Lambda Tutorial - Part 1',
          similarity: 0.95,
          similarity_type: 'title',
        },
      ],
    });

    // Mock URL fetch query
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    // Mock embedding similarity query
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    // Mock duplicate persistence INSERT query
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);

    // Verify persistence query was called
    const persistenceCalls = mockPool.query.mock.calls.filter((call) =>
      call[0].includes('INSERT INTO duplicate_pairs')
    );
    expect(persistenceCalls.length).toBe(1);

    // Verify persistence query parameters
    const persistenceCall = persistenceCalls[0];
    expect(persistenceCall[0]).toContain('ON CONFLICT (content_id_1, content_id_2) DO NOTHING');
    expect(persistenceCall[1]).toEqual(['content-1', 'content-2', 'title', 0.95]);
  });

  it('should publish CloudWatch metrics for duplicates detected', async () => {
    const event = createMockEvent();

    // Mock title similarity query
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id1: 'content-1',
          id2: 'content-2',
          title1: 'Title A',
          title2: 'Title B',
          similarity: 0.95,
          similarity_type: 'title',
        },
      ],
    });

    // Mock URL fetch query
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'content-3',
          title: 'URL Content',
          url: 'https://example.com/blog',
        },
        {
          id: 'content-4',
          title: 'URL Content 2',
          url: 'http://www.example.com/blog/',
        },
      ],
    });

    // Mock embedding similarity query
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id1: 'content-5',
          id2: 'content-6',
          title1: 'Embedding A',
          title2: 'Embedding B',
          similarity: 0.97,
          similarity_type: 'embedding',
        },
      ],
    });

    // Mock persistence queries (3 duplicates: 1 title, 1 url, 1 embedding)
    mockPool.query.mockResolvedValue({ rowCount: 1 });

    await handler(event, {} as any);

    // Verify CloudWatch metrics were published
    expect(mockCloudWatchSendFn).toHaveBeenCalledTimes(1);

    const metricCommand = mockCloudWatchSendFn.mock.calls[0][0];
    expect(metricCommand).toBeDefined();
    expect(metricCommand.input).toBeDefined();

    const metricInput = metricCommand.input;
    expect(metricInput.Namespace).toBe('ContentHub');
    expect(metricInput.MetricData).toHaveLength(4);

    // Check total duplicates metric
    const totalMetric = metricInput.MetricData.find((m: any) => m.MetricName === 'DuplicatesDetected');
    expect(totalMetric).toBeDefined();
    expect(totalMetric.Value).toBe(3);
    expect(totalMetric.Unit).toBe('Count');

    // Check title duplicates metric
    const titleMetric = metricInput.MetricData.find((m: any) => m.MetricName === 'TitleDuplicates');
    expect(titleMetric).toBeDefined();
    expect(titleMetric.Value).toBe(1);

    // Check URL duplicates metric
    const urlMetric = metricInput.MetricData.find((m: any) => m.MetricName === 'UrlDuplicates');
    expect(urlMetric).toBeDefined();
    expect(urlMetric.Value).toBe(1);

    // Check embedding duplicates metric
    const embeddingMetric = metricInput.MetricData.find((m: any) => m.MetricName === 'EmbeddingDuplicates');
    expect(embeddingMetric).toBeDefined();
    expect(embeddingMetric.Value).toBe(1);
  });

  it('should handle duplicate persistence errors gracefully', async () => {
    const event = createMockEvent();

    // Mock title similarity query
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id1: 'content-1',
          id2: 'content-2',
          title1: 'Title A',
          title2: 'Title B',
          similarity: 0.95,
          similarity_type: 'title',
        },
      ],
    });

    // Mock URL fetch query
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    // Mock embedding similarity query
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    // Mock persistence query to throw error
    mockPool.query.mockRejectedValueOnce(new Error('Database error'));

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    const response = await handler(event, {} as any);

    // Detection should still succeed
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.duplicates).toHaveLength(1);

    // Error should be logged
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to persist duplicates:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it('should support scheduled mode (EventBridge source)', async () => {
    // Create EventBridge scheduled event
    const scheduledEvent = {
      source: 'aws.events',
      'detail-type': 'Scheduled Event',
      detail: {},
    };

    // Mock query for fetching all users
    mockPool.query.mockResolvedValueOnce({
      rows: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
    });

    // Mock queries for user-1 (title, url fetch, embedding)
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id1: 'content-1',
          id2: 'content-2',
          title1: 'Title A',
          title2: 'Title B',
          similarity: 0.95,
          similarity_type: 'title',
        },
      ],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    // Mock persistence for user-1
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

    // Mock queries for user-2 (title, url fetch, embedding)
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id1: 'content-3',
          id2: 'content-4',
          title1: 'Embedding A',
          title2: 'Embedding B',
          similarity: 0.97,
          similarity_type: 'embedding',
        },
      ],
    });

    // Mock persistence for user-2
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

    const response = await handler(scheduledEvent, {} as any);

    // Scheduled events don't return a response
    expect(response).toBeUndefined();

    // Verify it processed all users
    expect(consoleLogSpy).toHaveBeenCalledWith('Running scheduled duplicate detection for all users');
    expect(consoleLogSpy).toHaveBeenCalledWith('Processing duplicates for user: user-1');
    expect(consoleLogSpy).toHaveBeenCalledWith('Processing duplicates for user: user-2');

    // Verify metrics were published with aggregated data
    expect(mockCloudWatchSendFn).toHaveBeenCalledTimes(1);
    const metricCommand = mockCloudWatchSendFn.mock.calls[0][0];
    const metricInput = metricCommand.input;

    const totalMetric = metricInput.MetricData.find((m: any) => m.MetricName === 'DuplicatesDetected');
    expect(totalMetric.Value).toBe(2); // 1 title + 1 embedding across both users

    consoleLogSpy.mockRestore();
  });
});
