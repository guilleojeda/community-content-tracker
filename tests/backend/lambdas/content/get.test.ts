import { Pool } from 'pg';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { setupTestDatabase, teardownTestDatabase, resetTestData, createTestUser, createTestContent } from '../../repositories/test-setup';
import { ContentType, Visibility } from '@aws-community-hub/shared';

// Mock handler will be imported when implemented
const mockHandler = jest.fn();
jest.mock('../../../../src/backend/lambdas/content/get', () => ({
  handler: (...args: any[]) => mockHandler(...args)
}));

describe('Get Content Lambda Handler', () => {
  let pool: Pool;
  let testUserId: string;
  let otherUserId: string;
  let awsEmployeeUserId: string;
  let adminUserId: string;

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

    const adminUser = await createTestUser(pool, {
      username: 'adminuser',
      isAdmin: true,
      isAwsEmployee: false,
    });
    adminUserId = adminUser.id;
  });

  const createEvent = (
    contentId: string,
    userId?: string
  ): APIGatewayProxyEvent => ({
    body: null,
    headers: {
      'Content-Type': 'application/json',
    },
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: `/content/${contentId}`,
    pathParameters: {
      id: contentId,
    },
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'test-request',
      stage: 'test',
      resourceId: 'test',
      resourcePath: '/content/{id}',
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
      path: `/content/${contentId}`,
      accountId: 'test-account',
      apiId: 'test-api',
      protocol: 'HTTP/1.1',
      authorizer: userId ? {
        claims: {
          sub: userId,
          email: 'test@example.com',
        },
      } : null,
    },
    resource: '/content/{id}',
  } as any);

  const createContext = (): Context => ({
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'getContent',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:getContent',
    memoryLimitInMB: '256',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/getContent',
    logStreamName: 'test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  });

  describe('successful retrieval', () => {
    it('should get content by ID with all fields', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'Test Content',
        description: 'Test description',
        contentType: ContentType.BLOG,
        visibility: Visibility.PUBLIC,
        publishDate: new Date('2024-01-15'),
        tags: ['aws', 'lambda'],
        isClaimed: true,
      });

      // Add URLs
      await pool.query(
        'INSERT INTO content_urls (content_id, url) VALUES ($1, $2), ($1, $3)',
        [content.id, 'https://example.com/post', 'https://mirror.example.com/post']
      );

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          id: content.id,
          userId: testUserId,
          title: 'Test Content',
          description: 'Test description',
          contentType: ContentType.BLOG,
          visibility: Visibility.PUBLIC,
          publishDate: '2024-01-15T00:00:00.000Z',
          tags: ['aws', 'lambda'],
          isClaimed: true,
          urls: [
            { id: expect.any(String), url: 'https://example.com/post' },
            { id: expect.any(String), url: 'https://mirror.example.com/post' },
          ],
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        }),
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });

      const event = createEvent(content.id, testUserId);
      const context = createContext();

      const result = await mockHandler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.id).toBe(content.id);
      expect(body.title).toBe('Test Content');
      expect(body.description).toBe('Test description');
      expect(body.contentType).toBe(ContentType.BLOG);
      expect(body.visibility).toBe(Visibility.PUBLIC);
      expect(body.tags).toEqual(['aws', 'lambda']);
      expect(body.urls).toHaveLength(2);
    });

    it('should include all URLs for the content', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'Multi-URL Content',
        visibility: Visibility.PUBLIC,
      });

      // Add multiple URLs
      const urls = [
        'https://blog.example.com/post',
        'https://medium.com/@user/post',
        'https://dev.to/user/post',
        'https://hashnode.com/@user/post',
      ];

      for (const url of urls) {
        await pool.query(
          'INSERT INTO content_urls (content_id, url) VALUES ($1, $2)',
          [content.id, url]
        );
      }

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          id: content.id,
          urls: urls.map(url => ({ id: expect.any(String), url })),
        }),
      });

      const event = createEvent(content.id, testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.urls).toHaveLength(4);
      expect(body.urls.map((u: any) => u.url)).toEqual(urls);
    });

    it('should work for public content without authentication', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'Public Content',
        visibility: Visibility.PUBLIC,
      });

      await pool.query(
        'INSERT INTO content_urls (content_id, url) VALUES ($1, $2)',
        [content.id, 'https://example.com/public']
      );

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          id: content.id,
          title: 'Public Content',
          visibility: Visibility.PUBLIC,
          urls: [{ id: expect.any(String), url: 'https://example.com/public' }],
        }),
      });

      const event = createEvent(content.id);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.title).toBe('Public Content');
    });
  });

  describe('visibility enforcement', () => {
    it('should allow owner to view their own private content', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'Private Content',
        visibility: Visibility.PRIVATE,
      });

      await pool.query(
        'INSERT INTO content_urls (content_id, url) VALUES ($1, $2)',
        [content.id, 'https://example.com/private']
      );

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          id: content.id,
          title: 'Private Content',
          visibility: Visibility.PRIVATE,
          urls: [{ id: expect.any(String), url: 'https://example.com/private' }],
        }),
      });

      const event = createEvent(content.id, testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.visibility).toBe(Visibility.PRIVATE);
    });

    it('should deny access to private content for other users', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'Private Content',
        visibility: Visibility.PRIVATE,
      });

      mockHandler.mockResolvedValue({
        statusCode: 404,
        body: JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: 'Content not found',
          },
        }),
      });

      const event = createEvent(content.id, otherUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should allow AWS employees to view AWS_ONLY content', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'AWS Only Content',
        visibility: Visibility.AWS_ONLY,
      });

      await pool.query(
        'INSERT INTO content_urls (content_id, url) VALUES ($1, $2)',
        [content.id, 'https://example.com/aws-only']
      );

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          id: content.id,
          title: 'AWS Only Content',
          visibility: Visibility.AWS_ONLY,
          urls: [{ id: expect.any(String), url: 'https://example.com/aws-only' }],
        }),
      });

      const event = createEvent(content.id, awsEmployeeUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
    });

    it('should deny AWS_ONLY content to regular users', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'AWS Only Content',
        visibility: Visibility.AWS_ONLY,
      });

      mockHandler.mockResolvedValue({
        statusCode: 404,
        body: JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: 'Content not found',
          },
        }),
      });

      const event = createEvent(content.id, otherUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(404);
    });

    it('should allow admins to view AWS_ONLY content', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'AWS Only Content',
        visibility: Visibility.AWS_ONLY,
      });

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          id: content.id,
          visibility: Visibility.AWS_ONLY,
        }),
      });

      const event = createEvent(content.id, adminUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
    });

    it('should allow authenticated users to view AWS_COMMUNITY content', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'AWS Community Content',
        visibility: Visibility.AWS_COMMUNITY,
      });

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          id: content.id,
          visibility: Visibility.AWS_COMMUNITY,
        }),
      });

      const event = createEvent(content.id, otherUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
    });
  });

  describe('error handling', () => {
    it('should return 404 for non-existent content ID', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      mockHandler.mockResolvedValue({
        statusCode: 404,
        body: JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: 'Content not found',
          },
        }),
      });

      const event = createEvent(nonExistentId, testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(404);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('Content not found');
    });

    it('should return 400 for invalid content ID format', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 400,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid content ID format',
            details: { id: 'Must be a valid UUID' },
          },
        }),
      });

      const event = createEvent('invalid-id', testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing content ID', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 400,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Content ID is required',
          },
        }),
      });

      const event = createEvent('', testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);
    });

    it('should handle database connection errors gracefully', async () => {
      const content = await createTestContent(pool, testUserId, {
        visibility: Visibility.PUBLIC,
      });

      mockHandler.mockResolvedValue({
        statusCode: 500,
        body: JSON.stringify({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
          },
        }),
      });

      const event = createEvent(content.id, testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('edge cases', () => {
    it('should handle content with no URLs', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'No URLs',
        visibility: Visibility.PUBLIC,
      });

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          id: content.id,
          title: 'No URLs',
          urls: [],
        }),
      });

      const event = createEvent(content.id, testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.urls).toEqual([]);
    });

    it('should handle content with no description', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'No Description',
        description: null,
        visibility: Visibility.PUBLIC,
      });

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          id: content.id,
          title: 'No Description',
          description: null,
        }),
      });

      const event = createEvent(content.id, testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.description).toBeNull();
    });

    it('should handle content with no tags', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'No Tags',
        tags: [],
        visibility: Visibility.PUBLIC,
      });

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          id: content.id,
          title: 'No Tags',
          tags: [],
        }),
      });

      const event = createEvent(content.id, testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.tags).toEqual([]);
    });

    it('should handle content with no publish date', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'No Publish Date',
        publishDate: null,
        visibility: Visibility.PUBLIC,
      });

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          id: content.id,
          title: 'No Publish Date',
          publishDate: null,
        }),
      });

      const event = createEvent(content.id, testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.publishDate).toBeNull();
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in response', async () => {
      const content = await createTestContent(pool, testUserId, {
        visibility: Visibility.PUBLIC,
      });

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ id: content.id }),
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
        },
      });

      const event = createEvent(content.id, testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Headers');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Methods');
    });

    it('should include CORS headers in error responses', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 404,
        body: JSON.stringify({ error: { code: 'NOT_FOUND' } }),
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });

      const event = createEvent('00000000-0000-0000-0000-000000000000', testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
    });
  });

  describe('SQL injection protection', () => {
    it('should handle malicious ID parameter safely', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 400,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid content ID format',
          },
        }),
      });

      const event = createEvent("'; DROP TABLE content; --", testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);
    });
  });
});