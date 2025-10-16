import { Pool } from 'pg';
import { handler } from '../../../../src/backend/lambdas/content/find-duplicates';
import { setupTestDatabase, teardownTestDatabase, resetTestData, createTestUser } from '../../repositories/test-setup';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ContentType, Visibility } from '@aws-community-hub/shared';

describe('Find Duplicates Lambda Handler', () => {
  let pool: Pool;
  let testUserId: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;

    // Ensure pg_trgm extension is installed
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  });

  afterAll(async () => {
    // Close lambda's pool connection before teardown
    const { closePool } = require('../../../../src/backend/lambdas/content/find-duplicates');
    await closePool();
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();

    // Create a test user
    const user = await createTestUser(pool, {
      email: 'test@example.com',
      username: 'testuser',
    });
    testUserId = user.id;
  });

  const createEvent = (
    queryParams: Record<string, string> = {},
    userId?: string
  ): APIGatewayProxyEvent => ({
    body: null,
    headers: {
      'Content-Type': 'application/json',
    },
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/content/duplicates',
    pathParameters: null,
    queryStringParameters: queryParams,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'test-request',
      stage: 'test',
      resourceId: 'test',
      resourcePath: '/content/duplicates',
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
      path: '/content/duplicates',
      accountId: 'test-account',
      apiId: 'test-api',
      protocol: 'HTTP/1.1',
      authorizer: userId
        ? {
            claims: {
              sub: userId,
            },
          }
        : null,
    },
    resource: '/content/duplicates',
  });

  const createContext = (): Context => ({
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'find-duplicates',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:find-duplicates',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/find-duplicates',
    logStreamName: '2024/01/01/[$LATEST]test',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  });

  const createTestContent = async (data: {
    title: string;
    tags?: string[];
    urls?: string[];
  }) => {
    const result = await pool.query(
      `INSERT INTO content (user_id, title, description, content_type, visibility, publish_date, capture_date, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        testUserId,
        data.title,
        'Test description',
        ContentType.BLOG,
        Visibility.PUBLIC,
        new Date(),
        new Date(),
        data.tags || [],
      ]
    );

    const contentId = result.rows[0].id;

    // Add URLs if provided
    if (data.urls && data.urls.length > 0) {
      for (const url of data.urls) {
        await pool.query(
          `INSERT INTO content_urls (content_id, url) VALUES ($1, $2)`,
          [contentId, url]
        );
      }
    }

    return contentId;
  };

  describe('Authentication', () => {
    it('should return 401 if user is not authenticated', async () => {
      const event = createEvent({}, undefined);
      const context = createContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 404 if user does not exist', async () => {
      const event = createEvent({}, 'non-existent-user-id');
      const context = createContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Parameter Validation', () => {
    it('should validate threshold parameter', async () => {
      const event = createEvent({ threshold: '1.5' }, testUserId);
      const context = createContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Threshold');
    });

    it('should validate fields parameter', async () => {
      const event = createEvent({ fields: 'title,invalid_field' }, testUserId);
      const context = createContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Invalid fields');
    });

    it('should use default threshold of 0.8', async () => {
      const event = createEvent({}, testUserId);
      const context = createContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.threshold).toBe(0.8);
    });

    it('should use default fields of title and tags', async () => {
      const event = createEvent({}, testUserId);
      const context = createContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.fields).toEqual(['title', 'tags']);
    });
  });

  describe('Duplicate Detection', () => {
    it('should find duplicates by title similarity', async () => {
      // Create content with similar titles
      await createTestContent({
        title: 'Introduction to AWS Lambda',
        tags: ['aws', 'lambda'],
      });

      await createTestContent({
        title: 'Introduction to AWS Lambda Functions',
        tags: ['aws', 'serverless'],
      });

      const event = createEvent({ threshold: '0.7', fields: 'title' }, testUserId);
      const context = createContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.duplicates).toBeDefined();
      expect(body.total).toBeGreaterThan(0);
    });

    it('should find duplicates by common tags', async () => {
      await createTestContent({
        title: 'AWS Lambda Tutorial',
        tags: ['aws', 'lambda', 'serverless'],
      });

      await createTestContent({
        title: 'Serverless Computing Guide',
        tags: ['aws', 'lambda', 'cloud'],
      });

      const event = createEvent({ fields: 'tags' }, testUserId);
      const context = createContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.duplicates).toBeDefined();
    });

    it('should find duplicates by common URLs', async () => {
      await createTestContent({
        title: 'First Article',
        urls: ['https://example.com/article1', 'https://example.com/shared'],
      });

      await createTestContent({
        title: 'Second Article',
        urls: ['https://example.com/article2', 'https://example.com/shared'],
      });

      const event = createEvent({ fields: 'urls' }, testUserId);
      const context = createContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.duplicates).toBeDefined();
    });

    it('should find duplicates for a specific content item', async () => {
      const contentId = await createTestContent({
        title: 'AWS Lambda Best Practices',
        tags: ['aws', 'lambda'],
      });

      await createTestContent({
        title: 'AWS Lambda Best Practices Guide',
        tags: ['aws', 'lambda', 'best-practices'],
      });

      const event = createEvent(
        { contentId, threshold: '0.7', fields: 'title,tags' },
        testUserId
      );
      const context = createContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.duplicates).toBeDefined();
    });

    it('should not find duplicates with high threshold', async () => {
      await createTestContent({
        title: 'AWS Lambda',
        tags: ['aws'],
      });

      await createTestContent({
        title: 'Amazon EC2',
        tags: ['ec2'],
      });

      const event = createEvent({ threshold: '0.95', fields: 'title' }, testUserId);
      const context = createContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.total).toBe(0);
    });

    it('should return empty array when no content exists', async () => {
      const event = createEvent({}, testUserId);
      const context = createContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.duplicates).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('should return empty array when only one content item exists', async () => {
      await createTestContent({
        title: 'Single Article',
        tags: ['single'],
      });

      const event = createEvent({}, testUserId);
      const context = createContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.duplicates).toEqual([]);
    });
  });

  describe('Response Format', () => {
    it('should return properly formatted duplicate results', async () => {
      await createTestContent({
        title: 'AWS Lambda Guide',
        tags: ['aws', 'lambda'],
        urls: ['https://example.com/guide1'],
      });

      await createTestContent({
        title: 'AWS Lambda Tutorial',
        tags: ['aws', 'lambda'],
        urls: ['https://example.com/guide2'],
      });

      const event = createEvent({ fields: 'title,tags' }, testUserId);
      const context = createContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);

      expect(body).toHaveProperty('duplicates');
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('threshold');
      expect(body).toHaveProperty('fields');

      if (body.duplicates.length > 0) {
        const duplicate = body.duplicates[0];
        expect(duplicate).toHaveProperty('content');
        expect(duplicate).toHaveProperty('similarity');
        expect(duplicate).toHaveProperty('matchedFields');

        expect(duplicate.content).toHaveProperty('id');
        expect(duplicate.content).toHaveProperty('title');
        expect(duplicate.content).toHaveProperty('tags');
        expect(duplicate.content).toHaveProperty('urls');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Temporarily drop the content table to simulate database error
      await pool.query('ALTER TABLE content RENAME TO content_backup');

      const event = createEvent({}, testUserId);
      const context = createContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');

      // Restore the table
      await pool.query('ALTER TABLE content_backup RENAME TO content');
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers in response', async () => {
      const event = createEvent({}, testUserId);
      const context = createContext();

      const result = await handler(event, context);

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(result.headers).toHaveProperty('Content-Type', 'application/json');
    });
  });
});
