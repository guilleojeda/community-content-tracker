import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/analytics/track-event';
import { getDatabasePool } from '../../../../src/backend/services/database';

jest.mock('../../../../src/backend/services/database');

describe('Analytics Track Event Lambda', () => {
  const mockPool = {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
  });

  const createMockEvent = (
    body: any,
    userId?: string
  ): APIGatewayProxyEvent => ({
    httpMethod: 'POST',
    path: '/analytics/track',
    headers: {},
    body: JSON.stringify(body),
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
      path: '/analytics/track',
      stage: 'test',
      requestId: 'request-id',
      requestTimeEpoch: 0,
      resourceId: 'resource-id',
      resourcePath: '/analytics/track',
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
      authorizer: userId ? {
        userId,
        claims: { sub: userId },
      } : undefined,
    },
    resource: '/analytics/track',
  } as any);

  it('should track page view event for authenticated user', async () => {
    const event = createMockEvent(
      {
        eventType: 'page_view',
        metadata: { page: '/dashboard', referrer: '/' },
      },
      'user-123'
    );

    mockPool.query
      .mockResolvedValueOnce({ rows: [{ granted: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'event-123' }] });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.tracked).toBe(true);
    expect(mockPool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('SELECT granted'),
      ['user-123']
    );
    expect(mockPool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO analytics_events'),
      expect.arrayContaining(['page_view', 'user-123'])
    );
  });

  it('should track search event with query metadata', async () => {
    const event = createMockEvent(
      {
        eventType: 'search',
        metadata: { query: 'AWS Lambda', resultsCount: 42 },
      },
      'user-123'
    );

    mockPool.query
      .mockResolvedValueOnce({ rows: [{ granted: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'event-124' }] });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.eventId).toBe('event-124');
  });

  it('should track anonymous page view', async () => {
    const event = createMockEvent({
      eventType: 'page_view',
      metadata: { page: '/public' },
    });

    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'event-125' }] });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.tracked).toBe(true);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO analytics_events'),
      expect.arrayContaining(['page_view', null])
    );
  });

  it('should return 400 for invalid event type', async () => {
    const event = createMockEvent({
      eventType: 'invalid_event',
      metadata: {},
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should handle database errors gracefully', async () => {
    const event = createMockEvent({
      eventType: 'page_view',
      metadata: {},
    });

    mockPool.query.mockRejectedValue(new Error('Database error'));

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('should track batch events', async () => {
    const event = createMockEvent(
      {
        events: [
          { eventType: 'page_view', metadata: { page: '/' } },
          { eventType: 'search', metadata: { query: 'lambda' } },
        ],
      },
      'user-999'
    );

    mockPool.query
      .mockResolvedValueOnce({ rows: [{ granted: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'evt-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'evt-2' }] });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.count).toBe(2);
    expect(body.data.eventIds).toEqual(['evt-1', 'evt-2']);
  });

  describe('Consent Checking', () => {
    it('should track event when user has granted analytics consent', async () => {
      const event = createMockEvent(
        {
          eventType: 'page_view',
          metadata: { page: '/dashboard' },
        },
        'user-123'
      );

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ granted: true }],
        })
        .mockResolvedValueOnce({ rows: [{ id: 'event-126' }] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.tracked).toBe(true);
      expect(mockPool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SELECT granted'),
        ['user-123']
      );
    });

    it('should NOT track event when user has not granted consent', async () => {
      const event = createMockEvent(
        {
          eventType: 'page_view',
          metadata: { page: '/dashboard' },
        },
        'user-123'
      );

      mockPool.query.mockResolvedValueOnce({
        rows: [{ granted: false }],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tracked).toBe(false);
      expect(body.data.message).toContain('consent');
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('should track event for anonymous users without consent check', async () => {
      const event = createMockEvent({
        eventType: 'page_view',
        metadata: { page: '/public' },
      });

      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'event-127' }] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tracked).toBe(true);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('should handle missing consent record as not granted', async () => {
      const event = createMockEvent(
        {
          eventType: 'search',
          metadata: { query: 'test' },
        },
        'user-123'
      );

      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tracked).toBe(false);
      expect(body.data.message).toContain('consent');
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });
  });
});
