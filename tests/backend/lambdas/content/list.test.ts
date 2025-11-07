import { Pool } from 'pg';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { setupTestDatabase, teardownTestDatabase, resetTestData, createTestUser, createTestContent } from '../../repositories/test-setup';
import { ContentType, Visibility } from '@aws-community-hub/shared';
import { handler } from '../../../../src/backend/lambdas/content/list';
import * as database from '../../../../src/backend/services/database';
import { ContentRepository } from '../../../../src/backend/repositories/ContentRepository';

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
    database.resetDatabaseCache();
    database.setTestDatabasePool(pool);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();

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
      const otherContent = await createTestContent(pool, otherUserId, {
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

      const event = createEvent(testUserId);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.total).toBe(2);
      expect(body.items).toHaveLength(2);

      const itemById = new Map(body.items.map((item: any) => [item.id, item]));
      expect(itemById.get(content1.id)?.userId).toBe(testUserId);
      expect(itemById.get(content2.id)?.userId).toBe(testUserId);
      expect(itemById.has(otherContent.id)).toBe(false);

      const content1Urls = (itemById.get(content1.id)?.urls || []).map((url: any) => url.url);
      const content2Urls = (itemById.get(content2.id)?.urls || []).map((url: any) => url.url);

      expect(content1Urls).toEqual(expect.arrayContaining(['https://example.com/1', 'https://example.com/1-alt']));
      expect(content2Urls).toEqual(['https://example.com/2']);
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

      const event = createEvent(testUserId);
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(1);
      const urls = body.items[0].urls.map((url: any) => url.url);
      expect(urls).toEqual(expect.arrayContaining([
        'https://blog.example.com/post',
        'https://medium.com/@user/post',
        'https://dev.to/user/post',
      ]));
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
      const event = createEvent(testUserId);
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(20);
      expect(body.total).toBe(25);
      expect(body.limit).toBe(20);
      expect(body.offset).toBe(0);
    });

    it('should handle custom limit parameter', async () => {
      const event = createEvent(testUserId, { limit: '10' });
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(10);
      expect(body.total).toBe(25);
      expect(body.limit).toBe(10);
      expect(body.offset).toBe(0);
    });

    it('should handle offset parameter', async () => {
      const event = createEvent(testUserId, { offset: '20' });
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(5);
      expect(body.total).toBe(25);
      expect(body.limit).toBe(20);
      expect(body.offset).toBe(20);
    });

    it('should handle combined limit and offset', async () => {
      const event = createEvent(testUserId, { limit: '5', offset: '10' });
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(5);
      expect(body.total).toBe(25);
      expect(body.limit).toBe(5);
      expect(body.offset).toBe(10);
    });

    it('should return empty array when offset exceeds total', async () => {
      const event = createEvent(testUserId, { offset: '100' });
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(25);
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
      const event = createEvent(testUserId);
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      const titles = body.items.map((item: any) => item.title);
      expect(titles).toEqual(['Alpha Post', 'Beta Post', 'Zebra Post']);
    });

    it('should sort by date ascending', async () => {
      const event = createEvent(testUserId, { sortBy: 'date', sortOrder: 'asc' });
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      const titles = body.items.map((item: any) => item.title);
      expect(titles).toEqual(['Zebra Post', 'Beta Post', 'Alpha Post']);
    });

    it('should sort by title ascending', async () => {
      const event = createEvent(testUserId, { sortBy: 'title', sortOrder: 'asc' });
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      const titles = body.items.map((item: any) => item.title);
      expect(titles).toEqual(['Alpha Post', 'Beta Post', 'Zebra Post']);
    });

    it('should sort by title descending', async () => {
      const event = createEvent(testUserId, { sortBy: 'title', sortOrder: 'desc' });
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      const titles = body.items.map((item: any) => item.title);
      expect(titles).toEqual(['Zebra Post', 'Beta Post', 'Alpha Post']);
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
      const event = createEvent(testUserId);
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      const titles = body.items.map((item: any) => item.title);
      expect(body.items).toHaveLength(4);
      expect(titles).toEqual(expect.arrayContaining([
        'Public Content',
        'Private Content',
        'AWS Only Content',
        'AWS Community Content',
      ]));
    });

    it('should filter by visibility parameter', async () => {
      const event = createEvent(testUserId, { visibility: Visibility.PUBLIC });
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].visibility).toBe(Visibility.PUBLIC);
    });

    it('should support multiple visibility filters', async () => {
      const event = createEvent(testUserId, {
        visibility: `${Visibility.PUBLIC},${Visibility.PRIVATE}`,
      });
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      const visibilities = body.items.map((item: any) => item.visibility);
      expect(body.items).toHaveLength(2);
      expect(visibilities).toEqual(expect.arrayContaining([Visibility.PUBLIC, Visibility.PRIVATE]));
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
      const event = createEvent(testUserId, { contentType: ContentType.BLOG });
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].contentType).toBe(ContentType.BLOG);
    });

    it('should support multiple content types', async () => {
      const event = createEvent(testUserId, {
        contentType: `${ContentType.BLOG},${ContentType.YOUTUBE}`,
      });
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      const types = body.items.map((item: any) => item.contentType);
      expect(body.items).toHaveLength(2);
      expect(types).toEqual(expect.arrayContaining([ContentType.BLOG, ContentType.YOUTUBE]));
    });
  });

  describe('error handling', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const event = createEvent(testUserId);
      event.requestContext.authorizer = null;

      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_REQUIRED');
    });

    it('should handle invalid limit parameter', async () => {
      const event = createEvent(testUserId, { limit: '-5' });
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.limit).toBeDefined();
    });

    it('should handle invalid offset parameter', async () => {
      const event = createEvent(testUserId, { offset: 'invalid' });
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.offset).toBeDefined();
    });

    it('should handle database connection errors', async () => {
      const spy = jest
        .spyOn(ContentRepository.prototype, 'findByUserId')
        .mockRejectedValue(new Error('Simulated failure'));

      const event = createEvent(testUserId);
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      spy.mockRestore();

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('edge cases', () => {
    it('should return empty array when user has no content', async () => {
      const event = createEvent(testUserId);
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('should handle content with no URLs', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'No URLs Content',
        visibility: Visibility.PUBLIC,
      });

      const event = createEvent(testUserId);
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      const body = JSON.parse(result.body);
      const item = body.items.find((i: any) => i.id === content.id);
      expect(item?.urls).toEqual([]);
    });

    it('should handle very large limit gracefully', async () => {
      const event = createEvent(testUserId, { limit: '10000' });
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in response', async () => {
      await createTestContent(pool, testUserId, {
        visibility: Visibility.PUBLIC,
      });

      const event = createEvent(testUserId);
      const result = await handler(event, createContext()) as APIGatewayProxyResult;

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Headers');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Methods');
    });
  });
});
