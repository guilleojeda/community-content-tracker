import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/analytics/export-analytics';
import { getDatabasePool } from '../../../../src/backend/services/database';

jest.mock('../../../../src/backend/services/database');

describe('Export Analytics Lambda', () => {
  const mockPool = {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  const createMockEvent = (userId: string = 'user-123', body: any = {}): APIGatewayProxyEvent => ({
    httpMethod: 'POST',
    path: '/analytics/export',
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
      path: '/analytics/export',
      stage: 'test',
      requestId: 'request-id',
      requestTimeEpoch: 0,
      resourceId: 'resource-id',
      resourcePath: '/analytics/export',
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
    resource: '/analytics/export',
  } as any);

  it('should generate CSV with analytics data', async () => {
    const event = createMockEvent('user-123', {});

    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          date: new Date('2024-01-15'),
          content_type: 'blog',
          title: 'AWS Lambda Best Practices',
          views: 1500,
          likes: 50,
          comments: 12,
        },
        {
          date: new Date('2024-01-10'),
          content_type: 'youtube',
          title: 'Serverless Tutorial',
          views: 2500,
          likes: 80,
          comments: 25,
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    expect(response.headers?.['Content-Type']).toBe('text/csv');
    expect(response.headers?.['Content-Disposition']).toContain('analytics_export.csv');

    const csvLines = response.body.split('\n');
    expect(csvLines[0]).toBe('Date,ContentType,Title,Views,Likes,Comments');
    expect(csvLines[1]).toContain('2024-01-15');
    expect(csvLines[1]).toContain('blog');
    expect(csvLines[1]).toContain('AWS Lambda Best Practices');
    expect(csvLines[1]).toContain('1500');
    expect(csvLines[1]).toContain('50');
    expect(csvLines[1]).toContain('12');

    const analyticsCall = mockPool.query.mock.calls.find(call => {
      const params = call[1];
      if (!Array.isArray(params) || params.length < 5) {
        return false;
      }
      if (typeof params[4] !== 'string') {
        return false;
      }
      try {
        const parsed = JSON.parse(params[4]);
        return parsed.exportType === 'analytics';
      } catch {
        return false;
      }
    });
    expect(analyticsCall).toBeDefined();
    const metadata = JSON.parse(analyticsCall?.[1][4]);
    expect(metadata.exportType).toBe('analytics');
    expect(metadata.rowCount).toBe(2);
  });

  it('should properly escape CSV fields with commas', async () => {
    const event = createMockEvent('user-123', {});

    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          date: new Date('2024-01-15'),
          content_type: 'blog',
          title: 'Lambda, API Gateway, and DynamoDB',
          views: 1000,
          likes: 30,
          comments: 5,
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const csvLines = response.body.split('\n');
    expect(csvLines[1]).toContain('"Lambda, API Gateway, and DynamoDB"');
  });

  it('should filter CSV data by date range', async () => {
    const event = createMockEvent('user-123', {
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });

    mockPool.query.mockResolvedValueOnce({
      rows: [],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    expect(mockPool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('publish_date BETWEEN'),
      ['user-123', '2024-01-01', '2024-01-31']
    );
  });

  it('should return 401 when user is not authenticated', async () => {
    const event = createMockEvent('user-123', {});
    delete (event.requestContext as any).authorizer;

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('should handle null metrics gracefully', async () => {
    const event = createMockEvent('user-123', {});

    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          date: new Date('2024-01-15'),
          content_type: 'blog',
          title: 'New Content',
          views: null,
          likes: null,
          comments: null,
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const csvLines = response.body.split('\n');
    expect(csvLines[1]).toContain('0,0,0');
  });

  it('should handle empty title fields', async () => {
    const event = createMockEvent('user-123', {});

    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          date: new Date('2024-01-15'),
          content_type: 'blog',
          title: null,
          views: 100,
          likes: 10,
          comments: 2,
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const csvLines = response.body.split('\n');
    expect(csvLines[1]).toBe('2024-01-15,blog,,100,10,2');
  });

  it('should return 500 on database error', async () => {
    const event = createMockEvent('user-123', {});

    mockPool.query.mockRejectedValueOnce(new Error('Database error'));

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
