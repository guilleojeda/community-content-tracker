import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/analytics/user-analytics';
import { getDatabasePool } from '../../../../src/backend/services/database';

jest.mock('../../../../src/backend/services/database');

describe('User Analytics Lambda', () => {
  const mockPool = {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
  });

  const createMockEvent = (userId: string = 'user-123', dateRange?: any): APIGatewayProxyEvent => ({
    httpMethod: 'GET',
    path: '/analytics/user',
    headers: {},
    body: null,
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters: dateRange || null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123',
      apiId: 'api-id',
      protocol: 'HTTP/1.1',
      httpMethod: 'GET',
      path: '/analytics/user',
      stage: 'test',
      requestId: 'request-id',
      requestTimeEpoch: 0,
      resourceId: 'resource-id',
      resourcePath: '/analytics/user',
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
    resource: '/analytics/user',
  } as any);

  it('should return user analytics with content distribution', async () => {
    const event = createMockEvent('user-123');

    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          { content_type: 'blog', count: 25 },
          { content_type: 'youtube', count: 10 },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { tag: 'AWS', count: 15 },
          { tag: 'Lambda', count: 8 },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'content-1',
            title: 'Popular Content',
            views: 1500,
            content_type: 'blog',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { date: new Date('2024-01-01'), views: 100 },
          { date: new Date('2024-01-02'), views: 150 },
        ],
      });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('contentByType');
    expect(body.data).toHaveProperty('topTags');
    expect(body.data).toHaveProperty('topContent');
    expect(body.data).toHaveProperty('timeSeries');
    expect(body.data.contentByType).toEqual({
      blog: 25,
      youtube: 10,
    });
    expect(body.data.timeSeries).toHaveLength(2);
  });

  it('should filter analytics by date range', async () => {
    const event = createMockEvent('user-123', {
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    });

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('publish_date'),
      expect.any(Array)
    );
  });

  it('should return 401 when user is not authenticated', async () => {
    const event = createMockEvent('user-123');
    delete (event.requestContext as any).authorizer;

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('should return time series data grouped by day', async () => {
    const event = createMockEvent('user-123');

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { date: new Date('2024-01-01'), views: 50 },
          { date: new Date('2024-01-02'), views: 75 },
          { date: new Date('2024-01-03'), views: 100 },
        ],
      });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.timeSeries).toHaveLength(3);
    expect(body.data.timeSeries[0]).toHaveProperty('date');
    expect(body.data.timeSeries[0]).toHaveProperty('views');
    expect(body.data.groupBy).toBe('day');
  });

  it('should return time series data grouped by week', async () => {
    const event = createMockEvent('user-123', { groupBy: 'week' });

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { date: new Date('2024-01-01'), views: 300 },
          { date: new Date('2024-01-08'), views: 450 },
        ],
      });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.timeSeries).toHaveLength(2);
    expect(body.data.groupBy).toBe('week');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("DATE_TRUNC('week'"),
      expect.any(Array)
    );
  });

  it('should return time series data grouped by month', async () => {
    const event = createMockEvent('user-123', { groupBy: 'month' });

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { date: new Date('2024-01-01'), views: 1200 },
          { date: new Date('2024-02-01'), views: 1500 },
          { date: new Date('2024-03-01'), views: 1800 },
        ],
      });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.timeSeries).toHaveLength(3);
    expect(body.data.groupBy).toBe('month');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("DATE_TRUNC('month'"),
      expect.any(Array)
    );
  });

  it('should default to day grouping for invalid groupBy values', async () => {
    const event = createMockEvent('user-123', { groupBy: 'invalid_value' });

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ date: new Date('2024-01-01'), views: 50 }],
      });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.groupBy).toBe('day');
    // Verify that 'day' is used in the SQL query, not the invalid value
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("DATE_TRUNC('day'"),
      expect.any(Array)
    );
    // Ensure the invalid value was NOT used in the query (SQL injection protection)
    expect(mockPool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('invalid_value'),
      expect.any(Array)
    );
  });

  it('should handle case-insensitive groupBy values', async () => {
    const event = createMockEvent('user-123', { groupBy: 'WEEK' });

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ date: new Date('2024-01-01'), views: 300 }],
      });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.groupBy).toBe('week');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("DATE_TRUNC('week'"),
      expect.any(Array)
    );
  });

  it('should prevent SQL injection via groupBy parameter', async () => {
    // Attempt SQL injection via groupBy parameter
    const event = createMockEvent('user-123', {
      groupBy: "day'; DROP TABLE users; --",
    });

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ date: new Date('2024-01-01'), views: 50 }],
      });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    // Should default to 'day' since the injection attempt is invalid
    expect(body.data.groupBy).toBe('day');
    // Verify the SQL injection attempt was NOT executed
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("DATE_TRUNC('day'"),
      expect.any(Array)
    );
    expect(mockPool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('DROP TABLE'),
      expect.any(Array)
    );
  });
});
