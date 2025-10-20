import { Pool } from 'pg';
import { handler } from '../../../../src/backend/lambdas/content/create';
import { setupTestDatabase, teardownTestDatabase, resetTestData, createTestUser } from '../../repositories/test-setup';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ContentType, Visibility } from '@aws-community-hub/shared';
import * as database from '../../../../src/backend/services/database';

describe('Content Create Lambda Handler', () => {
  let pool: Pool;
  let testUser: any;
  let adminUser: any;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;

    // Set required environment variables
    process.env.DATABASE_URL = setup.connectionString;

    // Reset database cache to ensure getDatabasePool() returns the test pool
    database.resetDatabaseCache();
    database.setTestDatabasePool(pool);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  let originalPoolConnect: any;

  beforeEach(async () => {
    await resetTestData();
    jest.clearAllMocks();

    // Save original pool.connect in case tests modify it
    originalPoolConnect = pool.connect;

    // Create test users
    testUser = await createTestUser(pool, {
      email: 'test@example.com',
      username: 'testuser',
      defaultVisibility: 'public',
      isAdmin: false
    });

    adminUser = await createTestUser(pool, {
      email: 'admin@example.com',
      username: 'adminuser',
      defaultVisibility: 'aws_community',
      isAdmin: true
    });
  });

  afterEach(async () => {
    // Ensure pool.connect is always restored after each test
    if (originalPoolConnect && pool.connect !== originalPoolConnect) {
      pool.connect = originalPoolConnect;
    }
  });

  const createEvent = (body: any, userId?: string): APIGatewayProxyEvent => {
    const actualUserId = userId ?? testUser?.id;
    return {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
      multiValueHeaders: {},
      httpMethod: 'POST',
      isBase64Encoded: false,
      path: '/content',
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {
        requestId: 'test-request',
        stage: 'test',
        resourceId: 'test',
        resourcePath: '/content',
        httpMethod: 'POST',
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
          userId: actualUserId,
          claims: {
            sub: actualUserId,
            email: 'test@example.com'
          }
        },
      },
      resource: '/content',
    } as any;
  };

  const createContext = (): Context => ({
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'content-create',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:content-create',
    memoryLimitInMB: '256',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/content-create',
    logStreamName: 'test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  });

  describe('successful content creation', () => {
    it('should create content with user\'s default visibility', async () => {
      const requestBody = {
        title: 'My AWS Blog Post',
        description: 'A comprehensive guide to AWS Lambda',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/aws-lambda'],
        tags: ['aws', 'lambda', 'serverless']
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('id');
      expect(body.title).toBe('My AWS Blog Post');
      expect(body.description).toBe('A comprehensive guide to AWS Lambda');
      expect(body.contentType).toBe(ContentType.BLOG);
      expect(body.visibility).toBe('public'); // User's default visibility
      expect(body.userId).toBe(testUser.id);
      expect(body.isClaimed).toBe(true);
      expect(body.tags).toEqual(['aws', 'lambda', 'serverless']);
      expect(body.urls).toHaveLength(1);
      expect(body.urls[0].url).toBe('https://blog.example.com/aws-lambda');

      // Verify content was stored in database
      const contentResult = await pool.query('SELECT * FROM content WHERE id = $1', [body.id]);
      expect(contentResult.rows).toHaveLength(1);

      // Verify URL was stored
      const urlResult = await pool.query('SELECT * FROM content_urls WHERE content_id = $1', [body.id]);
      expect(urlResult.rows).toHaveLength(1);
    });

    it('should create content with explicit visibility override', async () => {
      const requestBody = {
        title: 'Private Notes',
        contentType: ContentType.BLOG,
        visibility: Visibility.PRIVATE,
        urls: ['https://blog.example.com/private-notes']
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.visibility).toBe(Visibility.PRIVATE);
    });

    it('should create content with all supported content types', async () => {
      const contentTypes = [
        ContentType.BLOG,
        ContentType.YOUTUBE,
        ContentType.GITHUB,
        ContentType.CONFERENCE_TALK,
        ContentType.PODCAST
      ];

      for (const contentType of contentTypes) {
        const requestBody = {
          title: `Test ${contentType}`,
          contentType,
          urls: [`https://example.com/${contentType}`]
        };

        const event = createEvent(requestBody);
        const context = createContext();

        const result = await handler(event, context) as APIGatewayProxyResult;

        expect(result.statusCode).toBe(201);

        const body = JSON.parse(result.body);
        expect(body.contentType).toBe(contentType);
      }
    });

    it('should create content with multiple URLs', async () => {
      const requestBody = {
        title: 'Multi-platform Content',
        contentType: ContentType.BLOG,
        urls: [
          'https://blog.example.com/post',
          'https://medium.com/@user/post',
          'https://dev.to/user/post'
        ]
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.urls).toHaveLength(3);
      expect(body.urls.map((u: any) => u.url)).toEqual(requestBody.urls);
    });

    it('should store tags as array', async () => {
      const requestBody = {
        title: 'Tagged Content',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/tagged'],
        tags: ['aws', 'serverless', 'lambda', 'dynamodb']
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.tags).toEqual(['aws', 'serverless', 'lambda', 'dynamodb']);
      expect(Array.isArray(body.tags)).toBe(true);

      // Verify tags are stored correctly in database
      const contentResult = await pool.query('SELECT tags FROM content WHERE id = $1', [body.id]);
      expect(Array.isArray(contentResult.rows[0].tags)).toBe(true);
      expect(contentResult.rows[0].tags).toEqual(['aws', 'serverless', 'lambda', 'dynamodb']);
    });

    it('should create content with empty tags array', async () => {
      const requestBody = {
        title: 'Untagged Content',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/untagged']
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.tags).toEqual([]);
      expect(Array.isArray(body.tags)).toBe(true);
    });

    it('should create content with optional publish date', async () => {
      const publishDate = '2024-01-15T10:30:00Z';
      const requestBody = {
        title: 'Scheduled Post',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/scheduled'],
        publishDate
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.publishDate).toBeDefined();
    });
  });

  describe('unclaimed content creation', () => {
    it('should create unclaimed content for later claiming', async () => {
      const requestBody = {
        title: 'AWS re:Invent Keynote',
        contentType: ContentType.CONFERENCE_TALK,
        urls: ['https://youtube.com/watch?v=keynote'],
        originalAuthor: 'Werner Vogels',
        isClaimed: false
      };

      const event = createEvent(requestBody, adminUser.id);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.isClaimed).toBe(false);
      expect(body.originalAuthor).toBe('Werner Vogels');
      expect(body.userId).toBe(adminUser.id);

      // Verify in database
      const contentResult = await pool.query('SELECT * FROM content WHERE id = $1', [body.id]);
      const content = contentResult.rows[0];
      expect(content.is_claimed).toBe(false);
      expect(content.original_author).toBe('Werner Vogels');
    });

    it('should create unclaimed podcast content', async () => {
      const requestBody = {
        title: 'AWS Podcast Episode 123',
        contentType: ContentType.PODCAST,
        urls: ['https://podcast.example.com/episode-123'],
        originalAuthor: 'Jane Smith',
        isClaimed: false,
        description: 'Discussion about AWS best practices'
      };

      const event = createEvent(requestBody, adminUser.id);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.isClaimed).toBe(false);
      expect(body.originalAuthor).toBe('Jane Smith');
      expect(body.contentType).toBe(ContentType.PODCAST);
    });

    it('should require originalAuthor when isClaimed is false', async () => {
      const requestBody = {
        title: 'Conference Talk',
        contentType: ContentType.CONFERENCE_TALK,
        urls: ['https://youtube.com/watch?v=talk'],
        isClaimed: false
        // Missing originalAuthor
      };

      const event = createEvent(requestBody, adminUser.id);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.fields?.originalAuthor).toBeDefined();
    });
  });

  describe('content type validation', () => {
    it('should validate content type is one of allowed values', async () => {
      const requestBody = {
        title: 'Invalid Content',
        contentType: 'invalid_type',
        urls: ['https://example.com/content']
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.fields?.contentType).toBeDefined();
    });

    it('should accept conference_talk content type', async () => {
      const requestBody = {
        title: 'My Conference Talk',
        contentType: ContentType.CONFERENCE_TALK,
        urls: ['https://youtube.com/watch?v=talk']
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.contentType).toBe(ContentType.CONFERENCE_TALK);
    });

    it('should accept podcast content type', async () => {
      const requestBody = {
        title: 'My Podcast Episode',
        contentType: ContentType.PODCAST,
        urls: ['https://podcast.example.com/episode']
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.contentType).toBe(ContentType.PODCAST);
    });
  });

  describe('URL deduplication', () => {
    it('should prevent duplicate URLs within same content', async () => {
      const requestBody = {
        title: 'Content with Duplicate URLs',
        contentType: ContentType.BLOG,
        urls: [
          'https://blog.example.com/post',
          'https://blog.example.com/post', // Duplicate
          'https://medium.com/@user/post'
        ]
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      // Should deduplicate URLs
      expect(body.urls).toHaveLength(2);
      expect(body.urls.map((u: any) => u.url).sort()).toEqual([
        'https://blog.example.com/post',
        'https://medium.com/@user/post'
      ].sort());
    });

    it('should check for URL deduplication across existing content', async () => {
      // Create first content with URL
      const firstContent = {
        title: 'First Content',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/unique-post']
      };

      const event1 = createEvent(firstContent);
      const context1 = createContext();
      const result1 = await handler(event1, context1) as APIGatewayProxyResult;
      expect(result1.statusCode).toBe(201);

      // Try to create second content with same URL
      const secondContent = {
        title: 'Second Content',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/unique-post']
      };

      const event2 = createEvent(secondContent);
      const context2 = createContext();
      const result2 = await handler(event2, context2) as APIGatewayProxyResult;

      expect(result2.statusCode).toBe(409);

      const body = JSON.parse(result2.body);
      expect(body.error.code).toBe('DUPLICATE_RESOURCE');
      expect(body.error.message).toContain('URL');
    });

    it('should allow same URL for different users', async () => {
      // Create content with first user
      const firstContent = {
        title: 'First User Content',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/shared-topic']
      };

      const event1 = createEvent(firstContent, testUser.id);
      const context1 = createContext();
      const result1 = await handler(event1, context1) as APIGatewayProxyResult;
      expect(result1.statusCode).toBe(201);

      // Create second user
      const secondUser = await createTestUser(pool, {
        email: 'second@example.com',
        username: 'seconduser'
      });

      // Create content with second user using same URL
      const secondContent = {
        title: 'Second User Content',
        contentType: ContentType.YOUTUBE,
        urls: ['https://blog.example.com/shared-topic']
      };

      const event2 = createEvent(secondContent, secondUser.id);
      const context2 = createContext();
      const result2 = await handler(event2, context2) as APIGatewayProxyResult;

      // Should succeed - different users can have same URL
      expect(result2.statusCode).toBe(201);
    });
  });

  describe('owner verification via JWT', () => {
    it('should verify owner via JWT from authorizer context', async () => {
      const requestBody = {
        title: 'User Content',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/user-content']
      };

      const event = createEvent(requestBody, testUser.id);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.userId).toBe(testUser.id);

      // Verify in database
      const contentResult = await pool.query('SELECT * FROM content WHERE id = $1', [body.id]);
      expect(contentResult.rows[0].user_id).toBe(testUser.id);
    });

    it('should reject request without authentication', async () => {
      const requestBody = {
        title: 'Anonymous Content',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/anonymous']
      };

      const event = createEvent(requestBody);
      // Remove authorizer context to simulate unauthenticated request
      event.requestContext.authorizer = null;

      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(401);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_REQUIRED');
    });

    it('should reject request with invalid user ID in JWT', async () => {
      const requestBody = {
        title: 'Invalid User Content',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/invalid']
      };

      const event = createEvent(requestBody, 'non-existent-user-id');
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(401);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_INVALID');
    });
  });

  describe('validation errors', () => {
    it('should handle invalid input - missing title', async () => {
      const requestBody = {
        // Missing title
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/post']
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.fields?.title).toBeDefined();
    });

    it('should handle missing required fields - contentType', async () => {
      const requestBody = {
        title: 'Content without Type',
        // Missing contentType
        urls: ['https://blog.example.com/post']
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.fields?.contentType).toBeDefined();
    });

    it('should handle missing required fields - urls', async () => {
      const requestBody = {
        title: 'Content without URLs',
        contentType: ContentType.BLOG
        // Missing urls
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.fields?.urls).toBeDefined();
    });

    it('should handle empty URLs array', async () => {
      const requestBody = {
        title: 'Content with Empty URLs',
        contentType: ContentType.BLOG,
        urls: []
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.fields?.urls).toBeDefined();
    });

    it('should validate URL format', async () => {
      const requestBody = {
        title: 'Content with Invalid URLs',
        contentType: ContentType.BLOG,
        urls: ['not-a-valid-url', 'also-invalid']
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.fields?.urls).toBeDefined();
    });

    it('should validate visibility value', async () => {
      const requestBody = {
        title: 'Invalid Visibility',
        contentType: ContentType.BLOG,
        visibility: 'invalid_visibility',
        urls: ['https://blog.example.com/post']
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.fields?.visibility).toBeDefined();
    });

    it('should validate title length', async () => {
      const requestBody = {
        title: 'a'.repeat(501), // Exceeds max length
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/post']
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.fields?.title).toBeDefined();
    });

    it('should validate tags format', async () => {
      const requestBody = {
        title: 'Content with Invalid Tags',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/post'],
        tags: 'not-an-array' // Should be array
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.fields?.tags).toBeDefined();
    });

    it('should validate publishDate format', async () => {
      const requestBody = {
        title: 'Content with Invalid Date',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/post'],
        publishDate: 'not-a-date'
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.fields?.publishDate).toBeDefined();
    });
  });

  describe('malformed request handling', () => {
    it('should return 400 for invalid JSON', async () => {
      const event = createEvent({});
      event.body = 'invalid json';

      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing body', async () => {
      const event = createEvent({});
      event.body = null as any;

      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in response', async () => {
      const requestBody = {
        title: 'CORS Test',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/cors']
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Headers');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Methods');
    });

    it('should include CORS headers in error responses', async () => {
      const requestBody = {
        title: 'Error CORS Test',
        contentType: 'invalid_type',
        urls: ['https://blog.example.com/error']
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);
      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
    });
  });

  describe('database transaction handling', () => {
    it('should rollback on database error', async () => {
      // Ensure testUser is available
      expect(testUser).toBeDefined();
      expect(testUser.id).toBeDefined();

      const requestBody = {
        title: 'Transaction Test',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/transaction']
      };

      const event = createEvent(requestBody, testUser.id);
      const context = createContext();

      // Mock the ContentRepository.create method to simulate a database error
      const ContentRepository = require('../../../../src/backend/repositories/ContentRepository').ContentRepository;
      const originalCreate = ContentRepository.prototype.create;

      ContentRepository.prototype.create = jest.fn().mockRejectedValue(
        new Error('Simulated database error during transaction')
      );

      try {
        const result = await handler(event, context) as APIGatewayProxyResult;

        expect(result.statusCode).toBe(500);
        const body = JSON.parse(result.body);
        expect(body.error.code).toBe('INTERNAL_ERROR');

        // Verify content was not created (transaction rolled back)
        const contentResult = await pool.query('SELECT * FROM content WHERE title = $1', ['Transaction Test']);
        expect(contentResult.rows).toHaveLength(0);
      } finally {
        // Restore original method
        ContentRepository.prototype.create = originalCreate;
      }
    });
  });

  describe('edge cases', () => {
    it('should handle very long description', async () => {
      // Ensure testUser is properly initialized
      expect(testUser).toBeDefined();
      expect(testUser.id).toBeDefined();

      const requestBody = {
        title: 'Long Description Content',
        description: 'a'.repeat(5000),
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/long']
      };

      const event = createEvent(requestBody, testUser.id);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.description).toBe('a'.repeat(5000));
    });

    it('should handle maximum number of tags', async () => {
      // Ensure testUser is properly initialized
      expect(testUser).toBeDefined();
      expect(testUser.id).toBeDefined();

      const tags = Array.from({ length: 50 }, (_, i) => `tag${i}`);
      const requestBody = {
        title: 'Many Tags Content',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/tags'],
        tags
      };

      const event = createEvent(requestBody, testUser.id);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.tags).toHaveLength(50);
    });

    it('should handle maximum number of URLs', async () => {
      // Ensure testUser is properly initialized
      expect(testUser).toBeDefined();
      expect(testUser.id).toBeDefined();

      const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/url${i}`);
      const requestBody = {
        title: 'Many URLs Content',
        contentType: ContentType.BLOG,
        urls
      };

      const event = createEvent(requestBody, testUser.id);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.urls).toHaveLength(10);
    });

    it('should trim whitespace from title and tags', async () => {
      // Ensure testUser is properly initialized
      expect(testUser).toBeDefined();
      expect(testUser.id).toBeDefined();

      const requestBody = {
        title: '  Trimmed Title  ',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/trim'],
        tags: ['  tag1  ', '  tag2  ']
      };

      const event = createEvent(requestBody, testUser.id);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.title).toBe('Trimmed Title');
      expect(body.tags).toEqual(['tag1', 'tag2']);
    });

    it('should handle special characters in title', async () => {
      // Ensure testUser is properly initialized
      expect(testUser).toBeDefined();
      expect(testUser.id).toBeDefined();

      const requestBody = {
        title: 'AWS Lambda™: The Complete Guide (2024) <Updated>',
        contentType: ContentType.BLOG,
        urls: ['https://blog.example.com/special']
      };

      const event = createEvent(requestBody, testUser.id);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.title).toBe('AWS Lambda™: The Complete Guide (2024) <Updated>');
    });
  });
});
