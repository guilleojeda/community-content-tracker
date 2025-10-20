import { Pool } from 'pg';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { setupTestDatabase, teardownTestDatabase, resetTestData, createTestUser, createTestContent } from '../../repositories/test-setup';
import { ContentType, Visibility } from '@aws-community-hub/shared';

// Mock handler will be imported when implemented
const mockHandler = jest.fn();
jest.mock('../../../../src/backend/lambdas/content/list', () => ({
  handler: (...args: any[]) => mockHandler(...args)
}));

describe('List Content Lambda Handler', () => {
  let pool: Pool;
  let testUserId: string;
  let otherUserId: string;
  let awsEmployeeUserId: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;

    // Set required environment variables
    process.env.DATABASE_URL = setup.connectionString;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();
    jest.clearAllMocks();

    // Create test users
    const testUser = await createTestUser(pool, {
      username: 'testuser',
      isAdmin: false,
      isAwsEmployee: false,
    });
    testUserId = testUser.id;

    const otherUser = await createTestUser(pool, {
      username: 'otheruser',
      isAdmin: false,
      isAwsEmployee: false,
    });
    otherUserId = otherUser.id;

    const awsEmployee = await createTestUser(pool, {
      username: 'awsemployee',
      isAdmin: false,
      isAwsEmployee: true,
    });
    awsEmployeeUserId = awsEmployee.id;
  });

  const createEvent = (
    userId: string,
    queryParams?: Record<string, string>
  ): APIGatewayProxyEvent => ({
    body: null,
    headers: {
      'Content-Type': 'application/json',
    },
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/content',
    pathParameters: null,
    queryStringParameters: queryParams || null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'test-request',
      stage: 'test',
      resourceId: 'test',
      resourcePath: '/content',
      httpMethod: 'GET',
      requestTime: new Date().toISOString(),
      requestTimeEpoch: Date.now(),
      identity: {
        cognitoIdentityPoolId: null,
        accountId: null,
        cognitoIdentityId: null,
        caller: null,
        sourceIp: '127.0.0.1',
        principalOrgId: null,
        accessKey: null,
        cognitoAuthenticationType: null,
        cognitoAuthenticationProvider: null,
        userAgent: 'test-agent',
        userArn: null,
        user: null,
        apiKey: null,
        apiKeyId: null,
        clientCert: null,
      },
      path: '/content',
      accountId: 'test-account',
      apiId: 'test-api',
      protocol: 'HTTP/1.1',
      authorizer: {
        claims: {
          sub: userId,
          email: 'test@example.com',
        },
      },
    },
    resource: '/content',
  } as any);

  const createContext = (): Context => ({
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'listContent',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:listContent',
    memoryLimitInMB: '256',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/listContent',
    logStreamName: 'test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  });

  describe('successful listing', () => {
    it('should list all content for authenticated user', async () => {
      // Create test content
      const content1 = await createTestContent(pool, testUserId, {
        title: 'Content 1',
        visibility: Visibility.PUBLIC,
      });
      const content2 = await createTestContent(pool, testUserId, {
        title: 'Content 2',
        visibility: Visibility.PRIVATE,
      });
      await createTestContent(pool, otherUserId, {
        title: 'Other User Content',
        visibility: Visibility.PUBLIC,
      });

      // Add URLs to content
      await pool.query(
        'INSERT INTO content_urls (content_id, url) VALUES ($1, $2), ($1, $3)',
        [content1.id, 'https://example.com/1', 'https://example.com/1-alt']
      );
      await pool.query(
        'INSERT INTO content_urls (content_id, url) VALUES ($1, $2)',
        [content2.id, 'https://example.com/2']
      );

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            {
              id: content1.id,
              userId: testUserId,
              title: 'Content 1',
              visibility: Visibility.PUBLIC,
              urls: [
                { id: expect.any(String), url: 'https://example.com/1' },
                { id: expect.any(String), url: 'https://example.com/1-alt' },
              ],
            },
            {
              id: content2.id,
              userId: testUserId,
              title: 'Content 2',
              visibility: Visibility.PRIVATE,
              urls: [
                { id: expect.any(String), url: 'https://example.com/2' },
              ],
            },
          ],
          total: 2,
          limit: 20,
          offset: 0,
        }),
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });

      const event = createEvent(testUserId);
      const context = createContext();

      const result = await mockHandler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(body.items[0].urls).toHaveLength(2);
      expect(body.items[1].urls).toHaveLength(1);
    });

    it('should include all URLs for each content item', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'Multi-URL Content',
        visibility: Visibility.PUBLIC,
      });

      // Add multiple URLs
      await pool.query(
        `INSERT INTO content_urls (content_id, url) VALUES
         ($1, 'https://blog.example.com/post'),
         ($1, 'https://medium.com/@user/post'),
         ($1, 'https://dev.to/user/post')`,
        [content.id]
      );

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            {
              id: content.id,
              urls: [
                { id: expect.any(String), url: 'https://blog.example.com/post' },
                { id: expect.any(String), url: 'https://medium.com/@user/post' },
                { id: expect.any(String), url: 'https://dev.to/user/post' },
              ],
            },
          ],
          total: 1,
        }),
      });

      const event = createEvent(testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items[0].urls).toHaveLength(3);
    });
  });

  describe('pagination', () => {
    beforeEach(async () => {
      // Create 25 content items
      for (let i = 1; i <= 25; i++) {
        await createTestContent(pool, testUserId, {
          title: `Content ${i}`,
          visibility: Visibility.PUBLIC,
        });
      }
    });

    it('should paginate results with default limit', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: Array(20).fill(null).map((_, i) => ({
            id: expect.any(String),
            title: `Content ${i + 1}`,
          })),
          total: 25,
          limit: 20,
          offset: 0,
        }),
      });

      const event = createEvent(testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(20);
      expect(body.total).toBe(25);
      expect(body.limit).toBe(20);
      expect(body.offset).toBe(0);
    });

    it('should handle custom limit parameter', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: Array(10).fill(null).map(() => ({ id: expect.any(String) })),
          total: 25,
          limit: 10,
          offset: 0,
        }),
      });

      const event = createEvent(testUserId, { limit: '10' });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(10);
      expect(body.limit).toBe(10);
    });

    it('should handle offset parameter', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: Array(5).fill(null).map((_, i) => ({
            id: expect.any(String),
            title: `Content ${i + 21}`,
          })),
          total: 25,
          limit: 20,
          offset: 20,
        }),
      });

      const event = createEvent(testUserId, { offset: '20' });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(5);
      expect(body.offset).toBe(20);
    });

    it('should handle combined limit and offset', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: Array(5).fill(null).map((_, i) => ({
            id: expect.any(String),
            title: `Content ${i + 11}`,
          })),
          total: 25,
          limit: 5,
          offset: 10,
        }),
      });

      const event = createEvent(testUserId, { limit: '5', offset: '10' });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(5);
      expect(body.limit).toBe(5);
      expect(body.offset).toBe(10);
    });

    it('should return empty array when offset exceeds total', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [],
          total: 25,
          limit: 20,
          offset: 100,
        }),
      });

      const event = createEvent(testUserId, { offset: '100' });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(0);
    });
  });

  describe('sorting', () => {
    beforeEach(async () => {
      // Create content with different dates and titles
      await createTestContent(pool, testUserId, {
        title: 'Zebra Post',
        publishDate: new Date('2024-01-15'),
        visibility: Visibility.PUBLIC,
      });
      await createTestContent(pool, testUserId, {
        title: 'Alpha Post',
        publishDate: new Date('2024-03-20'),
        visibility: Visibility.PUBLIC,
      });
      await createTestContent(pool, testUserId, {
        title: 'Beta Post',
        publishDate: new Date('2024-02-10'),
        visibility: Visibility.PUBLIC,
      });
    });

    it('should sort by date descending by default', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            { title: 'Alpha Post', publishDate: '2024-03-20' },
            { title: 'Beta Post', publishDate: '2024-02-10' },
            { title: 'Zebra Post', publishDate: '2024-01-15' },
          ],
          total: 3,
        }),
      });

      const event = createEvent(testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items[0].title).toBe('Alpha Post');
      expect(body.items[2].title).toBe('Zebra Post');
    });

    it('should sort by date ascending', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            { title: 'Zebra Post', publishDate: '2024-01-15' },
            { title: 'Beta Post', publishDate: '2024-02-10' },
            { title: 'Alpha Post', publishDate: '2024-03-20' },
          ],
          total: 3,
        }),
      });

      const event = createEvent(testUserId, { sortBy: 'date', sortOrder: 'asc' });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items[0].title).toBe('Zebra Post');
      expect(body.items[2].title).toBe('Alpha Post');
    });

    it('should sort by title ascending', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            { title: 'Alpha Post' },
            { title: 'Beta Post' },
            { title: 'Zebra Post' },
          ],
          total: 3,
        }),
      });

      const event = createEvent(testUserId, { sortBy: 'title', sortOrder: 'asc' });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items[0].title).toBe('Alpha Post');
      expect(body.items[2].title).toBe('Zebra Post');
    });

    it('should sort by title descending', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            { title: 'Zebra Post' },
            { title: 'Beta Post' },
            { title: 'Alpha Post' },
          ],
          total: 3,
        }),
      });

      const event = createEvent(testUserId, { sortBy: 'title', sortOrder: 'desc' });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items[0].title).toBe('Zebra Post');
      expect(body.items[2].title).toBe('Alpha Post');
    });
  });

  describe('visibility filtering', () => {
    beforeEach(async () => {
      await createTestContent(pool, testUserId, {
        title: 'Public Content',
        visibility: Visibility.PUBLIC,
      });
      await createTestContent(pool, testUserId, {
        title: 'Private Content',
        visibility: Visibility.PRIVATE,
      });
      await createTestContent(pool, testUserId, {
        title: 'AWS Only Content',
        visibility: Visibility.AWS_ONLY,
      });
      await createTestContent(pool, testUserId, {
        title: 'AWS Community Content',
        visibility: Visibility.AWS_COMMUNITY,
      });
    });

    it('should show all content to the owner', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            { title: 'Public Content' },
            { title: 'Private Content' },
            { title: 'AWS Only Content' },
            { title: 'AWS Community Content' },
          ],
          total: 4,
        }),
      });

      const event = createEvent(testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(4);
    });

    it('should filter by visibility parameter', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            { title: 'Public Content', visibility: Visibility.PUBLIC },
          ],
          total: 1,
        }),
      });

      const event = createEvent(testUserId, { visibility: Visibility.PUBLIC });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].visibility).toBe(Visibility.PUBLIC);
    });

    it('should support multiple visibility filters', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            { title: 'Public Content', visibility: Visibility.PUBLIC },
            { title: 'Private Content', visibility: Visibility.PRIVATE },
          ],
          total: 2,
        }),
      });

      const event = createEvent(testUserId, {
        visibility: `${Visibility.PUBLIC},${Visibility.PRIVATE}`,
      });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(2);
    });
  });

  describe('content type filtering', () => {
    beforeEach(async () => {
      await createTestContent(pool, testUserId, {
        title: 'Blog Post',
        contentType: ContentType.BLOG,
        visibility: Visibility.PUBLIC,
      });
      await createTestContent(pool, testUserId, {
        title: 'YouTube Video',
        contentType: ContentType.YOUTUBE,
        visibility: Visibility.PUBLIC,
      });
      await createTestContent(pool, testUserId, {
        title: 'GitHub Repo',
        contentType: ContentType.GITHUB,
        visibility: Visibility.PUBLIC,
      });
    });

    it('should filter by content type', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            { title: 'Blog Post', contentType: ContentType.BLOG },
          ],
          total: 1,
        }),
      });

      const event = createEvent(testUserId, { contentType: ContentType.BLOG });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].contentType).toBe(ContentType.BLOG);
    });

    it('should support multiple content types', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            { title: 'Blog Post', contentType: ContentType.BLOG },
            { title: 'YouTube Video', contentType: ContentType.YOUTUBE },
          ],
          total: 2,
        }),
      });

      const event = createEvent(testUserId, {
        contentType: `${ContentType.BLOG},${ContentType.YOUTUBE}`,
      });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(2);
    });
  });

  describe('error handling', () => {
    it('should return 401 for unauthenticated requests', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 401,
        body: JSON.stringify({
          error: {
            code: 'AUTH_REQUIRED',
            message: 'Authentication required',
          },
        }),
      });

      const event = createEvent(testUserId);
      event.requestContext.authorizer = null;

      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_REQUIRED');
    });

    it('should handle invalid limit parameter', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 400,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid limit parameter',
            details: { limit: 'Must be between 1 and 100' },
          },
        }),
      });

      const event = createEvent(testUserId, { limit: '-5' });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle invalid offset parameter', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 400,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid offset parameter',
            details: { offset: 'Must be non-negative' },
          },
        }),
      });

      const event = createEvent(testUserId, { offset: 'invalid' });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle database connection errors', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 500,
        body: JSON.stringify({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
          },
        }),
      });

      const event = createEvent(testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('edge cases', () => {
    it('should return empty array when user has no content', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [],
          total: 0,
          limit: 20,
          offset: 0,
        }),
      });

      const event = createEvent(testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('should handle content with no URLs', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'No URLs Content',
        visibility: Visibility.PUBLIC,
      });

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            {
              id: content.id,
              title: 'No URLs Content',
              urls: [],
            },
          ],
          total: 1,
        }),
      });

      const event = createEvent(testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items[0].urls).toEqual([]);
    });

    it('should handle very large limit gracefully', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 400,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Limit exceeds maximum allowed value',
            details: { limit: 'Maximum is 100' },
          },
        }),
      });

      const event = createEvent(testUserId, { limit: '10000' });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in response', async () => {
      await createTestContent(pool, testUserId, {
        visibility: Visibility.PUBLIC,
      });

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ items: [], total: 0 }),
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
        },
      });

      const event = createEvent(testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Headers');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Methods');
    });
  });
});
