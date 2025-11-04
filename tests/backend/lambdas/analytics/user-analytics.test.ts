import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/analytics/user-analytics';
import { getDatabasePool } from '../../../../src/backend/services/database';
import { getCacheClient } from '../../../../src/backend/services/cache/cache';

jest.mock('../../../../src/backend/services/database');
jest.mock('../../../../src/backend/services/cache/cache');

describe('User Analytics Lambda', () => {
  const mockPool = {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  };

  const mockCache = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const originalEnv = { ...process.env };

  const createMockEvent = (
    userId: string = 'user-123',
    query?: Record<string, string>
  ): APIGatewayProxyEvent =>
    ({
      httpMethod: 'GET',
      path: '/analytics/user',
      headers: {},
      body: null,
      isBase64Encoded: false,
      pathParameters: null,
      queryStringParameters: query || null,
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
    } as APIGatewayProxyEvent);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.ENABLE_QUERY_PROFILING;
    delete process.env.TEST_DB_INMEMORY;

    mockPool.query.mockReset();
    mockCache.get.mockReset();
    mockCache.set.mockReset();

    mockCache.get.mockResolvedValue(null);
    mockCache.set.mockResolvedValue(undefined);

    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
    (getCacheClient as jest.Mock).mockResolvedValue(mockCache);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns user analytics with content distribution', async () => {
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

    const response = await handler(createMockEvent(), {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.contentByType).toEqual({ blog: 25, youtube: 10 });
    expect(body.data.timeSeries).toHaveLength(2);
    expect(mockCache.set).toHaveBeenCalledWith(
      expect.stringContaining('analytics:user-123:day'),
      expect.objectContaining({ success: true }),
      300
    );
  });

  it('filters analytics by date range', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await handler(
      createMockEvent('user-123', {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      }),
      {} as any
    );

    expect(response.statusCode).toBe(200);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('publish_date'),
      expect.arrayContaining(['user-123', '2024-01-01', '2024-12-31'])
    );
  });

  it('returns 401 when the user is not authenticated', async () => {
    const event = createMockEvent();
    delete (event.requestContext as any).authorizer;

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.code).toBe('AUTH_REQUIRED');
  });

  it('groups time series data by day by default', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { date: new Date('2024-01-01'), views: 50 },
          { date: new Date('2024-01-02'), views: 75 },
        ],
      });

    const response = await handler(createMockEvent(), {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.groupBy).toBe('day');
    expect(body.data.timeSeries).toHaveLength(2);
  });

  it('supports week grouping', async () => {
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

    const response = await handler(createMockEvent('user-123', { groupBy: 'week' }), {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.groupBy).toBe('week');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("DATE_TRUNC('week'"),
      expect.any(Array)
    );
  });

  it('supports month grouping', async () => {
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

    const response = await handler(createMockEvent('user-123', { groupBy: 'month' }), {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.groupBy).toBe('month');
    expect(body.data.timeSeries).toHaveLength(3);
  });

  it('defaults to day grouping for invalid groupBy values', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ date: new Date('2024-01-01'), views: 50 }],
      });

    const response = await handler(
      createMockEvent('user-123', { groupBy: 'invalid_value' }),
      {} as any
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.groupBy).toBe('day');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("DATE_TRUNC('day'"),
      expect.any(Array)
    );
  });

  it('handles case-insensitive groupBy values', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ date: new Date('2024-01-01'), views: 300 }],
      });

    const response = await handler(createMockEvent('user-123', { groupBy: 'WEEK' }), {} as any);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data.groupBy).toBe('week');
  });

  it('guards against SQL injection attempts in groupBy', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ date: new Date('2024-01-01'), views: 50 }],
      });

    const response = await handler(
      createMockEvent('user-123', { groupBy: "day'; DROP TABLE users; --" }),
      {} as any
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data.groupBy).toBe('day');
    expect(mockPool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('DROP TABLE'),
      expect.any(Array)
    );
  });

  it('returns cached analytics when cache hit occurs', async () => {
    const cachedPayload = {
      success: true,
      data: {
        contentByType: { blog: 3 },
        topTags: [{ tag: 'aws', count: 2 }],
        topContent: [],
        timeSeries: [],
        dateRange: null,
        groupBy: 'day',
      },
    };
    mockCache.get.mockResolvedValue(cachedPayload);

    const response = await handler(createMockEvent('cached-user'), {} as any);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(cachedPayload);
    expect(mockPool.query).not.toHaveBeenCalled();
    expect(mockCache.set).not.toHaveBeenCalled();
  });

  it('profiles queries when profiling is enabled', async () => {
    process.env.ENABLE_QUERY_PROFILING = 'true';

    const explainCalls: string[] = [];
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('EXPLAIN ANALYZE')) {
        explainCalls.push(sql);
        return { rows: [] };
      }
      if (sql.includes('GROUP BY content_type')) {
        return { rows: [{ content_type: 'blog', count: 1 }] };
      }
      if (sql.includes('UNNEST(tags)')) {
        return { rows: [{ tag: 'lambda', count: 1 }] };
      }
      if (sql.includes("COALESCE((metrics->>'views')::int")) {
        return {
          rows: [{ id: 'c1', title: 'Top Content', content_type: 'blog', views: 10 }],
        };
      }
      if (sql.includes('analytics_events')) {
        return { rows: [{ date: new Date('2024-01-01'), views: '5' }] };
      }
      return { rows: [] };
    });

    const response = await handler(createMockEvent('profile-user'), {} as any);

    expect(response.statusCode).toBe(200);
    expect(explainCalls.length).toBeGreaterThanOrEqual(3);
    explainCalls.forEach((statement) => expect(statement).toMatch(/^EXPLAIN ANALYZE/));
  });

  it('aggregates analytics using in-memory mode when TEST_DB_INMEMORY is true', async () => {
    process.env.TEST_DB_INMEMORY = 'true';

    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('GROUP BY content_type')) {
        return { rows: [{ content_type: 'blog', count: 2 }] };
      }
      if (sql.includes('SELECT tags FROM content')) {
        return { rows: [{ tags: ['aws', 'ai'] }, { tags: ['aws'] }] };
      }
      if (sql.includes("COALESCE((metrics->>'views')::int")) {
        return {
          rows: [{ id: 'id-1', title: 'Content', content_type: 'blog', views: 5 }],
        };
      }
      if (sql.includes('analytics_events')) {
        return {
          rows: [
            { created_at: new Date('2024-01-01T00:00:00Z') },
            { created_at: new Date('2024-01-01T10:00:00Z') },
            { created_at: new Date('2024-01-02T00:00:00Z') },
          ],
        };
      }
      return { rows: [] };
    });

    const response = await handler(createMockEvent('mem-user'), {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.topTags).toEqual([
      { tag: 'aws', count: 2 },
      { tag: 'ai', count: 1 },
    ]);
    expect(body.data.timeSeries).toEqual([
      { date: '2024-01-01T00:00:00.000Z', views: 2 },
      { date: '2024-01-02T00:00:00.000Z', views: 1 },
    ]);
  });

  it('aggregates weekly analytics in in-memory mode', async () => {
    process.env.TEST_DB_INMEMORY = 'true';

    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('GROUP BY content_type')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT tags FROM content')) {
        return { rows: [] };
      }
      if (sql.includes("COALESCE((metrics->>'views')::int")) {
        return { rows: [] };
      }
      if (sql.includes('analytics_events')) {
        return {
          rows: [
            { created_at: new Date('2024-04-01T12:00:00Z') }, // Monday
            { created_at: new Date('2024-04-02T03:00:00Z') }, // same week
            { created_at: new Date('2024-04-10T00:00:00Z') }, // next week
          ],
        };
      }
      return { rows: [] };
    });

    const response = await handler(createMockEvent('mem-week', { groupBy: 'week' }), {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.groupBy).toBe('week');
    expect(body.data.timeSeries).toEqual([
      { date: '2024-04-01T00:00:00.000Z', views: 2 },
      { date: '2024-04-08T00:00:00.000Z', views: 1 },
    ]);
  });

  it('aggregates monthly analytics in in-memory mode', async () => {
    process.env.TEST_DB_INMEMORY = 'true';

    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('GROUP BY content_type')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT tags FROM content')) {
        return { rows: [] };
      }
      if (sql.includes("COALESCE((metrics->>'views')::int")) {
        return { rows: [] };
      }
      if (sql.includes('analytics_events')) {
        return {
          rows: [
            { created_at: new Date('2024-01-15T00:00:00Z') },
            { created_at: new Date('2024-02-20T00:00:00Z') },
            { created_at: new Date('2024-02-21T00:00:00Z') },
          ],
        };
      }
      return { rows: [] };
    });

    const response = await handler(createMockEvent('mem-month', { groupBy: 'month' }), {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.groupBy).toBe('month');
    expect(body.data.timeSeries).toEqual([
      { date: '2024-01-01T00:00:00.000Z', views: 1 },
      { date: '2024-02-01T00:00:00.000Z', views: 2 },
    ]);
  });

  it('logs a warning when profiling a query fails', async () => {
    process.env.ENABLE_QUERY_PROFILING = 'true';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    let explainInvocation = 0;
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('EXPLAIN ANALYZE')) {
        explainInvocation += 1;
        if (explainInvocation === 1) {
          throw new Error('profile fail');
        }
        return { rows: [] };
      }

      if (sql.includes('GROUP BY content_type')) {
        return { rows: [{ content_type: 'blog', count: 1 }] };
      }

      if (sql.includes('UNNEST(tags)')) {
        return { rows: [{ tag: 'lambda', count: 1 }] };
      }

      if (sql.includes("COALESCE((metrics->>'views')::int")) {
        return {
          rows: [{ id: 'c1', title: 'Top Content', content_type: 'blog', views: 10 }],
        };
      }

      if (sql.includes('analytics_events')) {
        return { rows: [{ date: new Date('2024-01-01'), views: '5' }] };
      }

      return { rows: [] };
    });

    const response = await handler(createMockEvent('warn-user'), {} as any);

    expect(response.statusCode).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith('Analytics profiling failed:', 'profile fail');

    warnSpy.mockRestore();
  });
});
