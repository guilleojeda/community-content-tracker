import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/search/advanced-search';
import { getDatabasePool } from '../../../../src/backend/services/database';

jest.mock('../../../../src/backend/services/database');

describe('Advanced Search Lambda', () => {
  const mockPool = {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
  });

  const createMockEvent = (queryParams: any): APIGatewayProxyEvent => ({
    httpMethod: 'GET',
    path: '/search/advanced',
    headers: {},
    body: null,
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters: queryParams,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123',
      apiId: 'api-id',
      protocol: 'HTTP/1.1',
      httpMethod: 'GET',
      path: '/search/advanced',
      stage: 'test',
      requestId: 'request-id',
      requestTimeEpoch: 0,
      resourceId: 'resource-id',
      resourcePath: '/search/advanced',
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
      authorizer: undefined,
    },
    resource: '/search/advanced',
  } as any);

  it('should support boolean AND operator', async () => {
    const event = createMockEvent({ query: 'AWS AND Lambda' });

    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'content-1',
          title: 'AWS Lambda Tutorial',
          description: 'Learn AWS Lambda',
          content_type: 'blog',
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['AWS&Lambda'])
    );
  });

  it('should support boolean OR operator', async () => {
    const event = createMockEvent({ query: 'AWS OR Lambda' });

    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'content-1',
          title: 'AWS Services',
          description: 'Overview of AWS',
          content_type: 'blog',
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('|'),
      expect.any(Array)
    );
  });

  it('should support boolean NOT operator', async () => {
    const event = createMockEvent({ query: 'AWS NOT Lambda' });

    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'content-1',
          title: 'AWS EC2 Guide',
          description: 'Learn EC2',
          content_type: 'blog',
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['AWS!Lambda'])
    );
  });

  it('should support exact phrase matching with quotes', async () => {
    const event = createMockEvent({ query: '"AWS Lambda"' });

    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'content-1',
          title: 'AWS Lambda Functions',
          description: 'AWS Lambda guide',
          content_type: 'blog',
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([expect.stringContaining('<->')])
    );
  });

  it('should support wildcard search', async () => {
    const event = createMockEvent({ query: 'Lamb*' });

    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'content-1',
          title: 'Lambda Functions',
          description: 'Lambda guide',
          content_type: 'blog',
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([expect.stringContaining(':*')])
    );
  });

  it('should apply visibility filters for public search', async () => {
    const event = createMockEvent({ query: 'AWS' });

    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'content-1',
          title: 'AWS Guide',
          description: 'Learn AWS',
          content_type: 'blog',
          visibility: 'public',
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[0]).toContain('visibility');
    expect(callArgs[1][1]).toContain('public');
  });

  it('should return CSV format when format=csv is specified', async () => {
    const event = createMockEvent({ query: 'AWS Lambda', format: 'csv' });

    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'content-1',
          title: 'AWS Lambda Tutorial',
          description: 'Learn AWS Lambda',
          content_type: 'blog',
          publish_date: '2024-01-15',
          url: 'https://example.com/lambda-tutorial',
          rank: 0.9,
        },
        {
          id: 'content-2',
          title: 'Lambda Best Practices',
          description: 'Lambda optimization tips',
          content_type: 'video',
          publish_date: '2024-01-20',
          url: 'https://example.com/lambda-best-practices',
          rank: 0.85,
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/csv');
    expect(response.headers['Content-Disposition']).toContain('attachment');
    expect(response.headers['Content-Disposition']).toContain('search_results.csv');

    const lines = response.body.split('\n');
    expect(lines[0]).toBe('Title,Description,ContentType,PublishDate,URL');
    expect(lines[1]).toContain('AWS Lambda Tutorial');
    expect(lines[1]).toContain('Learn AWS Lambda');
    expect(lines[1]).toContain('blog');
    expect(lines[1]).toContain('2024-01-15');
    expect(lines[1]).toContain('https://example.com/lambda-tutorial');
    expect(lines[2]).toContain('Lambda Best Practices');
  });

  it('should properly escape special characters in CSV output', async () => {
    const event = createMockEvent({ query: 'test', format: 'csv' });

    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'content-1',
          title: 'Title with "quotes"',
          description: 'Description with, commas',
          content_type: 'blog',
          publish_date: '2024-01-15',
          url: 'https://example.com/test',
          rank: 0.9,
        },
        {
          id: 'content-2',
          title: 'Title with\nnewline',
          description: 'Normal description',
          content_type: 'video',
          publish_date: '2024-01-20',
          url: 'https://example.com/test2',
          rank: 0.85,
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const csvBody = response.body;

    // Check that quotes are properly escaped (double quotes become double-double quotes)
    expect(csvBody).toContain('"Title with ""quotes"""');

    // Check that commas are properly handled (field is quoted)
    expect(csvBody).toContain('"Description with, commas"');

    // Check that newlines are properly escaped (field is quoted and contains actual newline)
    expect(csvBody).toContain('"Title with\nnewline"');
  });

  it('should return error for invalid format parameter', async () => {
    const event = createMockEvent({ query: 'AWS', format: 'xml' });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('Invalid format');
  });

  it('should handle empty search results in CSV format', async () => {
    const event = createMockEvent({ query: 'nonexistent', format: 'csv' });

    mockPool.query.mockResolvedValue({
      rows: [],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/csv');

    const lines = response.body.split('\n');
    expect(lines[0]).toBe('Title,Description,ContentType,PublishDate,URL');
    expect(lines.length).toBe(1); // Only headers
  });

  it('should handle null/undefined values in CSV format', async () => {
    const event = createMockEvent({ query: 'test', format: 'csv' });

    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'content-1',
          title: 'Test Title',
          description: null,
          content_type: 'blog',
          publish_date: null,
          url: null,
          rank: 0.9,
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const lines = response.body.split('\n');
    expect(lines[1]).toContain('Test Title');
    expect(lines[1].split(',').length).toBe(5); // All columns present
  });

  it('should default to JSON format when format parameter is not specified', async () => {
    const event = createMockEvent({ query: 'AWS' });

    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'content-1',
          title: 'AWS Guide',
          description: 'Learn AWS',
          content_type: 'blog',
          publish_date: '2024-01-15',
          url: 'https://example.com/aws',
          rank: 0.9,
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.results).toBeDefined();
    expect(Array.isArray(body.data.results)).toBe(true);
  });

  it('should filter results by withinIds parameter (search within results)', async () => {
    const event = createMockEvent({
      query: 'AWS',
      withinIds: 'content-1,content-3,content-5',
    });

    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'content-1',
          title: 'AWS Lambda Tutorial',
          description: 'Learn AWS Lambda',
          content_type: 'blog',
          publish_date: '2024-01-15',
          url: 'https://example.com/lambda',
          rank: 0.9,
        },
        {
          id: 'content-3',
          title: 'AWS S3 Guide',
          description: 'Learn AWS S3',
          content_type: 'blog',
          publish_date: '2024-01-20',
          url: 'https://example.com/s3',
          rank: 0.85,
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);

    // Verify the query includes the withinIds filter
    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[0]).toContain('c.id = ANY');
    // The withinIds array should be the 3rd parameter (index 2) after tsQuery and visibilityFilter
    expect(callArgs[1][3]).toEqual(['content-1', 'content-3', 'content-5']);
  });

  it('should handle empty withinIds parameter gracefully', async () => {
    const event = createMockEvent({
      query: 'AWS',
      withinIds: '',
    });

    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'content-1',
          title: 'AWS Guide',
          description: 'Learn AWS',
          content_type: 'blog',
          publish_date: '2024-01-15',
          url: 'https://example.com/aws',
          rank: 0.9,
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);

    // Should not include withinIds filter when empty
    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[0]).not.toContain('c.id = ANY');
  });

  it('should handle whitespace in withinIds parameter', async () => {
    const event = createMockEvent({
      query: 'AWS',
      withinIds: 'content-1, content-2 , content-3',
    });

    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'content-1',
          title: 'AWS Lambda Tutorial',
          description: 'Learn AWS Lambda',
          content_type: 'blog',
          publish_date: '2024-01-15',
          url: 'https://example.com/lambda',
          rank: 0.9,
        },
      ],
    });

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);

    // Verify whitespace is trimmed
    const callArgs = mockPool.query.mock.calls[0];
    const withinIdsArray = callArgs[1].find((arg: any) => Array.isArray(arg) && arg.includes('content-1'));
    expect(withinIdsArray).toBeDefined();
    expect(withinIdsArray).toContain('content-1');
    expect(withinIdsArray).toContain('content-2');
    expect(withinIdsArray).toContain('content-3');
  });
});
