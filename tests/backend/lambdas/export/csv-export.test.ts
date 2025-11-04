import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/export/csv-export';
import { getDatabasePool } from '../../../../src/backend/services/database';
import { BadgeType } from '@aws-community-hub/shared';

jest.mock('../../../../src/backend/services/database');

describe('CSV Export Lambda', () => {
  const mockPool = {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  };
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.TEST_DB_INMEMORY;
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const createMockEvent = (
    programType: string,
    userId: string = 'user-123'
  ): APIGatewayProxyEvent => ({
    httpMethod: 'POST',
    path: '/export/csv',
    headers: {},
    body: JSON.stringify({
      programType,
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    }),
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
      httpMethod: 'POST',
      path: '/export/csv',
      stage: 'test',
      requestId: 'request-id',
      requestTimeEpoch: 0,
      resourceId: 'resource-id',
      resourcePath: '/export/csv',
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
    resource: '/export/csv',
  } as any);

  it('should export in Community Builder format', async () => {
    const event = createMockEvent('community_builder');

    mockPool.query.mockResolvedValue({
      rows: [
        {
          title: 'My Blog Post',
          url: 'https://example.com/blog',
          publish_date: new Date('2024-06-01'),
          content_type: 'blog',
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    expect(response.headers?.['Content-Type']).toBe('text/csv');
    expect(response.body).toContain('Title,URL,PublishDate,ContentType');
    expect(response.body).toContain('My Blog Post');
  });

  it('should export in Hero format with metrics', async () => {
    const event = createMockEvent('hero');

    mockPool.query.mockResolvedValue({
      rows: [
        {
          title: 'Video Tutorial',
          url: 'https://youtube.com/watch',
          publish_date: new Date('2024-06-15'),
          content_type: 'youtube',
          metrics: { views: 1500, likes: 120 },
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Title,URL,PublishDate,ContentType,Views,Likes');
    expect(response.body).toContain('1500');
  });

  it('should export in Ambassador format with tags', async () => {
    const event = createMockEvent('ambassador');

    mockPool.query.mockResolvedValue({
      rows: [
        {
          title: 'Conference Talk',
          url: 'https://example.com/talk',
          publish_date: new Date('2024-06-20'),
          content_type: 'conference_talk',
          tags: ['AWS', 'Lambda', 'Serverless'],
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Title,URL,PublishDate,ContentType,Tags');
    expect(response.body).toContain('AWS;Lambda;Serverless');
  });

  it('should export in User Group Leader format with event date', async () => {
    const event = createMockEvent('user_group_leader');

    mockPool.query.mockResolvedValue({
      rows: [
        {
          title: 'AWS Meetup Event',
          url: 'https://example.com/meetup',
          publish_date: new Date('2024-06-25'),
          content_type: 'workshop',
          metrics: { eventDate: '2024-07-01' },
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    expect(response.headers?.['Content-Type']).toBe('text/csv');
    expect(response.headers?.['Content-Disposition']).toContain('user_group_leader_export.csv');
    expect(response.body).toContain('Title,URL,PublishDate,ContentType,EventDate');
    expect(response.body).toContain('AWS Meetup Event');
    expect(response.body).toContain('https://example.com/meetup');
    expect(response.body).toContain('2024-06-25');
    expect(response.body).toContain('workshop');
    expect(response.body).toContain('2024-07-01');
  });

  it('should handle missing event date in User Group Leader format', async () => {
    const event = createMockEvent('user_group_leader');

    mockPool.query.mockResolvedValue({
      rows: [
        {
          title: 'Content Without Event',
          url: 'https://example.com/content',
          publish_date: new Date('2024-06-25'),
          content_type: 'article',
          metrics: {},
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const lines = response.body.split('\n');
    expect(lines[0]).toBe('Title,URL,PublishDate,ContentType,EventDate');
    // Event date should be empty string when missing
    expect(lines[1]).toMatch(/Content Without Event,https:\/\/example\.com\/content,2024-06-25,article,$/);
  });

  it('should properly escape special characters in User Group Leader format', async () => {
    const event = createMockEvent('user_group_leader');

    mockPool.query.mockResolvedValue({
      rows: [
        {
          title: 'Event with "Quotes" and, Commas',
          url: 'https://example.com/event',
          publish_date: new Date('2024-06-25'),
          content_type: 'workshop',
          metrics: { eventDate: '2024-07-15' },
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const csvBody = response.body;
    // Check that quotes are properly escaped (double quotes become double-double quotes)
    expect(csvBody).toContain('"Event with ""Quotes"" and, Commas"');
  });

  it('should return 400 for invalid program type', async () => {
    const event = createMockEvent('invalid_program');

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  describe('Export History Tracking', () => {
    it('should log export event to analytics_events table', async () => {
      const event = createMockEvent('community_builder', 'user-123');

      // Mock content query (first call)
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            title: 'Test Content',
            url: 'https://example.com/test',
            publish_date: new Date('2024-06-01'),
            content_type: 'blog',
          },
          {
            title: 'Another Content',
            url: 'https://example.com/test2',
            publish_date: new Date('2024-06-15'),
            content_type: 'article',
          },
        ],
      });

      // Mock analytics insert query (second call)
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'event-123' }],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      expect(response.headers?.['Content-Type']).toBe('text/csv');

      // Verify both queries were called
      expect(mockPool.query).toHaveBeenCalledTimes(2);

      // Verify analytics query parameters
      const analyticsCall = mockPool.query.mock.calls[1];
      expect(analyticsCall[0]).toContain('INSERT INTO analytics_events');
      expect(analyticsCall[1][0]).toBe('user-123');
      expect(typeof analyticsCall[1][1]).toBe('string');
      expect(analyticsCall[1][2]).toBe('127.0.0.0');
      expect(analyticsCall[1][3]).toBe('test-agent');

      // Verify metadata structure
      const metadata = JSON.parse(analyticsCall[1][4]);
      expect(metadata).toHaveProperty('exportType', 'program');
      expect(metadata).toHaveProperty('exportFormat', 'community_builder');
      expect(metadata).toHaveProperty('programType', 'community_builder');
      expect(metadata).toHaveProperty('startDate', '2024-01-01');
      expect(metadata).toHaveProperty('endDate', '2024-12-31');
      expect(metadata).toHaveProperty('rowCount', 2);
      expect(metadata).toHaveProperty('generatedAt');
    });

    it('should not fail export if analytics logging fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const event = createMockEvent('hero', 'user-456');

      // Mock content query to succeed (first call)
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            title: 'Video Tutorial',
            url: 'https://youtube.com/watch',
            publish_date: new Date('2024-06-15'),
            content_type: 'youtube',
            metrics: { views: 1500, likes: 120 },
          },
        ],
      });

      // Mock analytics query to fail (second call)
      mockPool.query.mockRejectedValueOnce(new Error('Database connection lost'));

      const response = await handler(event, {} as any);

      // Export should still succeed
      expect(response.statusCode).toBe(200);
      expect(response.headers?.['Content-Type']).toBe('text/csv');
      expect(response.body).toContain('Title,URL,PublishDate,ContentType,Views,Likes');
      expect(response.body).toContain('Video Tutorial');
      expect(response.body).toContain('1500');

      // Verify queries were called in correct order
      expect(mockPool.query).toHaveBeenCalledTimes(2);

      // Verify content query was first
      const contentCall = mockPool.query.mock.calls[0];
      expect(contentCall[0]).toContain('SELECT');

      // Verify analytics query was second
      const analyticsCall = mockPool.query.mock.calls[1];
      expect(analyticsCall[0]).toContain('INSERT INTO analytics_events');

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to log export event:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should include correct metadata for different export formats', async () => {
      const event = createMockEvent('ambassador', 'user-789');

      // Mock content query
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            title: 'Conference Talk 1',
            url: 'https://example.com/talk1',
            publish_date: new Date('2024-06-20'),
            content_type: 'conference_talk',
            tags: ['AWS', 'Lambda'],
          },
          {
            title: 'Conference Talk 2',
            url: 'https://example.com/talk2',
            publish_date: new Date('2024-07-10'),
            content_type: 'conference_talk',
            tags: ['Serverless'],
          },
          {
            title: 'Workshop',
            url: 'https://example.com/workshop',
            publish_date: new Date('2024-08-05'),
            content_type: 'workshop',
            tags: ['DynamoDB'],
          },
        ],
      });

      // Mock analytics insert query
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'event-456' }],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);

      // Verify analytics query was called with ambassador format
      const analyticsCall = mockPool.query.mock.calls[1];
      const metadata = JSON.parse(analyticsCall[1][4]);
      expect(metadata.exportType).toBe('program');
      expect(metadata.programType).toBe('ambassador');
      expect(metadata.exportFormat).toBe('ambassador');
      expect(metadata.rowCount).toBe(3);
      expect(metadata.startDate).toBe('2024-01-01');
      expect(metadata.endDate).toBe('2024-12-31');
    });
  });

  it('should process exports using in-memory database mode', async () => {
    process.env.TEST_DB_INMEMORY = 'true';

    const contentRows = [
      {
        id: 'content-1',
        title: 'Primary Content',
        publish_date: new Date('2024-05-01'),
        content_type: 'blog',
        metrics: { views: 100 },
        tags: ['aws'],
      },
    ];

    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM content') && !sql.includes('content_urls')) {
        return { rows: contentRows };
      }

      if (sql.includes('SELECT content_id, url')) {
        return {
          rows: [
            {
              content_id: 'content-1',
              url: 'https://example.com/primary',
              created_at: new Date('2024-05-02'),
            },
          ],
        };
      }

      if (sql.includes('INSERT INTO analytics_events')) {
        return { rows: [{ id: 'event-1' }] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const response = await handler(createMockEvent('community_builder'), {} as any);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('https://example.com/primary');
    expect(mockPool.query).toHaveBeenCalledTimes(3);
  });

  it('returns 500 when request body is invalid JSON', async () => {
    const event = createMockEvent('community_builder');
    event.body = '{invalid-json';

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
