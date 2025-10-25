import { Pool } from 'pg';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { setupTestDatabase, teardownTestDatabase, resetTestData, createTestUser, createTestContent } from '../../repositories/test-setup';
import { ContentType, Visibility } from '@aws-community-hub/shared';

// Mock handler will be imported when implemented
const mockHandler = jest.fn();
jest.mock('../../../../src/backend/lambdas/content/unclaimed', () => ({
  handler: (...args: any[]) => mockHandler(...args)
}));

describe('Unclaimed Content Lambda Handler', () => {
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
    path: '/content/unclaimed',
    pathParameters: null,
    queryStringParameters: queryParams || null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'test-request',
      stage: 'test',
      resourceId: 'test',
      resourcePath: '/content/unclaimed',
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
      path: '/content/unclaimed',
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
    resource: '/content/unclaimed',
  } as any);

  const createContext = (): Context => ({
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'unclaimedContent',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:unclaimedContent',
    memoryLimitInMB: '256',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/unclaimedContent',
    logStreamName: 'test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  });

  describe('successful unclaimed content listing', () => {
    it('should list unclaimed content with all fields', async () => {
      // Create unclaimed content
      const unclaimed1 = await createTestContent(pool, testUserId, {
        title: 'Unclaimed Blog Post',
        description: 'Great article about AWS',
        contentType: ContentType.BLOG,
        visibility: Visibility.PUBLIC,
        isClaimed: false,
        originalAuthor: 'John Doe',
        publishDate: new Date('2024-01-15'),
        tags: ['aws', 'serverless'],
      });

      const unclaimed2 = await createTestContent(pool, testUserId, {
        title: 'Unclaimed YouTube Video',
        contentType: ContentType.YOUTUBE,
        visibility: Visibility.PUBLIC,
        isClaimed: false,
        originalAuthor: 'Jane Smith',
      });

      // Add URLs
      await pool.query(
        'INSERT INTO content_urls (content_id, url) VALUES ($1, $2), ($1, $3)',
        [unclaimed1.id, 'https://blog.example.com/post', 'https://medium.com/post']
      );
      await pool.query(
        'INSERT INTO content_urls (content_id, url) VALUES ($1, $2)',
        [unclaimed2.id, 'https://youtube.com/watch?v=123']
      );

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            {
              id: unclaimed1.id,
              title: 'Unclaimed Blog Post',
              description: 'Great article about AWS',
              contentType: ContentType.BLOG,
              visibility: Visibility.PUBLIC,
              isClaimed: false,
              originalAuthor: 'John Doe',
              publishDate: '2024-01-15T00:00:00.000Z',
              tags: ['aws', 'serverless'],
              urls: [
                { id: expect.any(String), url: 'https://blog.example.com/post' },
                { id: expect.any(String), url: 'https://medium.com/post' },
              ],
            },
            {
              id: unclaimed2.id,
              title: 'Unclaimed YouTube Video',
              contentType: ContentType.YOUTUBE,
              isClaimed: false,
              originalAuthor: 'Jane Smith',
              urls: [
                { id: expect.any(String), url: 'https://youtube.com/watch?v=123' },
              ],
            },
          ],
          total: 2,
          limit: 20,
          offset: 0,
        }),
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': 'http://localhost:3000',
        },
      });

      const event = createEvent(testUserId);
      const context = createContext();

      const result = await mockHandler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(2);
      expect(body.items[0].isClaimed).toBe(false);
      expect(body.items[0].originalAuthor).toBe('John Doe');
      expect(body.items[0].urls).toHaveLength(2);
      expect(body.items[1].urls).toHaveLength(1);
    });

    it('should only return unclaimed content (isClaimed = false)', async () => {
      // Create mix of claimed and unclaimed content
      const unclaimed = await createTestContent(pool, testUserId, {
        title: 'Unclaimed Content',
        visibility: Visibility.PUBLIC,
        isClaimed: false,
        originalAuthor: 'Original Author',
      });

      await createTestContent(pool, testUserId, {
        title: 'Claimed Content',
        visibility: Visibility.PUBLIC,
        isClaimed: true,
      });

      await createTestContent(pool, otherUserId, {
        title: 'Another Claimed Content',
        visibility: Visibility.PUBLIC,
        isClaimed: true,
      });

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            {
              id: unclaimed.id,
              title: 'Unclaimed Content',
              isClaimed: false,
              originalAuthor: 'Original Author',
            },
          ],
          total: 1,
        }),
      });

      const event = createEvent(testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].isClaimed).toBe(false);
    });

    it('should include all URLs for each unclaimed content', async () => {
      const unclaimed = await createTestContent(pool, testUserId, {
        title: 'Multi-URL Unclaimed Content',
        visibility: Visibility.PUBLIC,
        isClaimed: false,
        originalAuthor: 'Content Creator',
      });

      // Add multiple URLs
      const urls = [
        'https://blog.example.com/post',
        'https://medium.com/post',
        'https://dev.to/post',
        'https://hashnode.com/post',
      ];

      for (const url of urls) {
        await pool.query(
          'INSERT INTO content_urls (content_id, url) VALUES ($1, $2)',
          [unclaimed.id, url]
        );
      }

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            {
              id: unclaimed.id,
              urls: urls.map(url => ({ id: expect.any(String), url })),
            },
          ],
          total: 1,
        }),
      });

      const event = createEvent(testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items[0].urls).toHaveLength(4);
      expect(body.items[0].urls.map((u: any) => u.url)).toEqual(urls);
    });
  });

  describe('pagination', () => {
    beforeEach(async () => {
      // Create 30 unclaimed content items
      for (let i = 1; i <= 30; i++) {
        await createTestContent(pool, testUserId, {
          title: `Unclaimed Content ${i}`,
          visibility: Visibility.PUBLIC,
          isClaimed: false,
          originalAuthor: `Author ${i}`,
        });
      }
    });

    it('should paginate with default limit', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: Array(20).fill(null).map((_, i) => ({
            id: expect.any(String),
            title: `Unclaimed Content ${i + 1}`,
            isClaimed: false,
          })),
          total: 30,
          limit: 20,
          offset: 0,
        }),
      });

      const event = createEvent(testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(20);
      expect(body.total).toBe(30);
      expect(body.limit).toBe(20);
      expect(body.offset).toBe(0);
    });

    it('should handle custom limit', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: Array(10).fill(null).map(() => ({
            id: expect.any(String),
            isClaimed: false,
          })),
          total: 30,
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
          items: Array(10).fill(null).map((_, i) => ({
            id: expect.any(String),
            title: `Unclaimed Content ${i + 21}`,
          })),
          total: 30,
          limit: 20,
          offset: 20,
        }),
      });

      const event = createEvent(testUserId, { offset: '20' });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(10);
      expect(body.offset).toBe(20);
    });
  });

  describe('sorting', () => {
    beforeEach(async () => {
      await createTestContent(pool, testUserId, {
        title: 'Zebra Article',
        publishDate: new Date('2024-01-15'),
        visibility: Visibility.PUBLIC,
        isClaimed: false,
        originalAuthor: 'Author Z',
      });
      await createTestContent(pool, testUserId, {
        title: 'Alpha Article',
        publishDate: new Date('2024-03-20'),
        visibility: Visibility.PUBLIC,
        isClaimed: false,
        originalAuthor: 'Author A',
      });
      await createTestContent(pool, testUserId, {
        title: 'Beta Article',
        publishDate: new Date('2024-02-10'),
        visibility: Visibility.PUBLIC,
        isClaimed: false,
        originalAuthor: 'Author B',
      });
    });

    it('should sort by date descending by default', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            { title: 'Alpha Article', publishDate: '2024-03-20' },
            { title: 'Beta Article', publishDate: '2024-02-10' },
            { title: 'Zebra Article', publishDate: '2024-01-15' },
          ],
          total: 3,
        }),
      });

      const event = createEvent(testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items[0].title).toBe('Alpha Article');
      expect(body.items[2].title).toBe('Zebra Article');
    });

    it('should sort by date ascending', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            { title: 'Zebra Article', publishDate: '2024-01-15' },
            { title: 'Beta Article', publishDate: '2024-02-10' },
            { title: 'Alpha Article', publishDate: '2024-03-20' },
          ],
          total: 3,
        }),
      });

      const event = createEvent(testUserId, { sortBy: 'date', sortOrder: 'asc' });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items[0].title).toBe('Zebra Article');
      expect(body.items[2].title).toBe('Alpha Article');
    });

    it('should sort by title ascending', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            { title: 'Alpha Article' },
            { title: 'Beta Article' },
            { title: 'Zebra Article' },
          ],
          total: 3,
        }),
      });

      const event = createEvent(testUserId, { sortBy: 'title', sortOrder: 'asc' });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items[0].title).toBe('Alpha Article');
      expect(body.items[2].title).toBe('Zebra Article');
    });

    it('should sort by title descending', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            { title: 'Zebra Article' },
            { title: 'Beta Article' },
            { title: 'Alpha Article' },
          ],
          total: 3,
        }),
      });

      const event = createEvent(testUserId, { sortBy: 'title', sortOrder: 'desc' });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items[0].title).toBe('Zebra Article');
      expect(body.items[2].title).toBe('Alpha Article');
    });
  });

  describe('visibility filtering', () => {
    it('should respect visibility rules for unclaimed content', async () => {
      // Public - visible to all
      await createTestContent(pool, testUserId, {
        title: 'Public Unclaimed',
        visibility: Visibility.PUBLIC,
        isClaimed: false,
        originalAuthor: 'Public Author',
      });

      // Private - should not appear in unclaimed list
      await createTestContent(pool, testUserId, {
        title: 'Private Unclaimed',
        visibility: Visibility.PRIVATE,
        isClaimed: false,
        originalAuthor: 'Private Author',
      });

      // AWS Only
      await createTestContent(pool, testUserId, {
        title: 'AWS Only Unclaimed',
        visibility: Visibility.AWS_ONLY,
        isClaimed: false,
        originalAuthor: 'AWS Author',
      });

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            { title: 'Public Unclaimed', visibility: Visibility.PUBLIC },
          ],
          total: 1,
        }),
      });

      const event = createEvent(testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      // Regular user should only see public unclaimed content
      expect(body.items).toHaveLength(1);
      expect(body.items[0].visibility).toBe(Visibility.PUBLIC);
    });

    it('should show AWS_ONLY unclaimed content to AWS employees', async () => {
      await createTestContent(pool, testUserId, {
        title: 'Public Unclaimed',
        visibility: Visibility.PUBLIC,
        isClaimed: false,
      });

      await createTestContent(pool, testUserId, {
        title: 'AWS Only Unclaimed',
        visibility: Visibility.AWS_ONLY,
        isClaimed: false,
      });

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            { title: 'Public Unclaimed', visibility: Visibility.PUBLIC },
            { title: 'AWS Only Unclaimed', visibility: Visibility.AWS_ONLY },
          ],
          total: 2,
        }),
      });

      const event = createEvent(awsEmployeeUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(2);
    });
  });

  describe('content type filtering', () => {
    beforeEach(async () => {
      await createTestContent(pool, testUserId, {
        title: 'Unclaimed Blog',
        contentType: ContentType.BLOG,
        visibility: Visibility.PUBLIC,
        isClaimed: false,
      });

      await createTestContent(pool, testUserId, {
        title: 'Unclaimed Video',
        contentType: ContentType.YOUTUBE,
        visibility: Visibility.PUBLIC,
        isClaimed: false,
      });

      await createTestContent(pool, testUserId, {
        title: 'Unclaimed Repo',
        contentType: ContentType.GITHUB,
        visibility: Visibility.PUBLIC,
        isClaimed: false,
      });
    });

    it('should filter by content type', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            { title: 'Unclaimed Blog', contentType: ContentType.BLOG },
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
            { title: 'Unclaimed Blog', contentType: ContentType.BLOG },
            { title: 'Unclaimed Video', contentType: ContentType.YOUTUBE },
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

  describe('authentication', () => {
    it('should require authentication', async () => {
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
  });

  describe('error handling', () => {
    it('should handle invalid limit parameter', async () => {
      mockHandler.mockResolvedValue({
        statusCode: 400,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid limit parameter',
          },
        }),
      });

      const event = createEvent(testUserId, { limit: '-5' });
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);
    });

    it('should handle database errors gracefully', async () => {
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
    });
  });

  describe('edge cases', () => {
    it('should return empty array when no unclaimed content exists', async () => {
      // Create only claimed content
      await createTestContent(pool, testUserId, {
        title: 'Claimed Content',
        visibility: Visibility.PUBLIC,
        isClaimed: true,
      });

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

    it('should handle unclaimed content with no URLs', async () => {
      const unclaimed = await createTestContent(pool, testUserId, {
        title: 'No URLs Unclaimed',
        visibility: Visibility.PUBLIC,
        isClaimed: false,
        originalAuthor: 'Author',
      });

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            {
              id: unclaimed.id,
              title: 'No URLs Unclaimed',
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

    it('should handle unclaimed content with no original author', async () => {
      const unclaimed = await createTestContent(pool, testUserId, {
        title: 'No Author',
        visibility: Visibility.PUBLIC,
        isClaimed: false,
        originalAuthor: null,
      });

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          items: [
            {
              id: unclaimed.id,
              originalAuthor: null,
            },
          ],
          total: 1,
        }),
      });

      const event = createEvent(testUserId);
      const result = await mockHandler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items[0].originalAuthor).toBeNull();
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in response', async () => {
      await createTestContent(pool, testUserId, {
        visibility: Visibility.PUBLIC,
        isClaimed: false,
      });

      mockHandler.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ items: [], total: 0 }),
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': 'http://localhost:3000',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
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
