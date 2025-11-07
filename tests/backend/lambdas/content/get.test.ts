import { Pool } from 'pg';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  setupTestDatabase,
  teardownTestDatabase,
  resetTestData,
  createTestUser,
  createTestContent,
} from '../../repositories/test-setup';
import { ContentType, Visibility } from '@aws-community-hub/shared';
import { handler } from '../../../../src/backend/lambdas/content/get';
import * as database from '../../../../src/backend/services/database';

describe('Get Content Lambda Handler', () => {
  let pool: Pool;
  let ownerId: string;
  let otherUserId: string;
  let awsEmployeeId: string;
  let adminUserId: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;
    process.env.DATABASE_URL = setup.connectionString;
    database.resetDatabaseCache();
    database.setTestDatabasePool(pool);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();

    const owner = await createTestUser(pool, {
      username: 'owner',
      isAdmin: false,
      isAwsEmployee: false,
    });
    ownerId = owner.id;

    const other = await createTestUser(pool, {
      username: 'other-user',
      isAdmin: false,
      isAwsEmployee: false,
    });
    otherUserId = other.id;

    const awsEmployee = await createTestUser(pool, {
      username: 'aws-employee',
      isAdmin: false,
      isAwsEmployee: true,
    });
    awsEmployeeId = awsEmployee.id;

    const admin = await createTestUser(pool, {
      username: 'admin-user',
      isAdmin: true,
      isAwsEmployee: false,
    });
    adminUserId = admin.id;
  });

  const createEvent = (contentId: string, userId?: string): APIGatewayProxyEvent => ({
    body: null,
    headers: { 'Content-Type': 'application/json' },
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: `/content/${contentId}`,
    pathParameters: { id: contentId },
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
      authorizer: userId
        ? {
            claims: {
              sub: userId,
              email: 'test@example.com',
            },
          }
        : undefined,
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
    it('returns full content metadata for the owner', async () => {
      const content = await createTestContent(pool, ownerId, {
        title: 'Owner Content',
        description: 'Detailed description',
        contentType: ContentType.BLOG,
        visibility: Visibility.PUBLIC,
        publishDate: new Date('2024-01-15T00:00:00Z'),
        tags: ['aws', 'lambda'],
        isClaimed: true,
      });

      await pool.query(
        'INSERT INTO content_urls (content_id, url) VALUES ($1, $2), ($1, $3)',
        [content.id, 'https://example.com/post', 'https://mirror.example.com/post']
      );

      const result = await handler(createEvent(content.id, ownerId), createContext());

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.id).toBe(content.id);
      expect(body.userId).toBe(ownerId);
      expect(body.title).toBe('Owner Content');
      expect(body.description).toBe('Detailed description');
      expect(body.tags).toEqual(['aws', 'lambda']);
      expect(body.urls.map((u: any) => u.url)).toEqual(
        expect.arrayContaining(['https://example.com/post', 'https://mirror.example.com/post'])
      );
    });

    it('allows anonymous access to public content', async () => {
      const content = await createTestContent(pool, ownerId, {
        title: 'Public Content',
        visibility: Visibility.PUBLIC,
      });

      await pool.query(
        'INSERT INTO content_urls (content_id, url) VALUES ($1, $2)',
        [content.id, 'https://example.com/public']
      );

      const result = await handler(createEvent(content.id), createContext());

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.title).toBe('Public Content');
      expect(body.urls).toHaveLength(1);
    });
  });

  describe('visibility and permissions', () => {
    it('allows owner to view private content', async () => {
      const content = await createTestContent(pool, ownerId, {
        title: 'Private Content',
        visibility: Visibility.PRIVATE,
      });

      const result = await handler(createEvent(content.id, ownerId), createContext());

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.visibility).toBe(Visibility.PRIVATE);
    });

    it('denies private content to other users', async () => {
      const content = await createTestContent(pool, ownerId, {
        title: 'Private Content',
        visibility: Visibility.PRIVATE,
      });

      const result = await handler(createEvent(content.id, otherUserId), createContext());

      expect(result.statusCode).toBe(404);
    });

    it('allows AWS employees to view aws_only content', async () => {
      const content = await createTestContent(pool, ownerId, {
        title: 'AWS Only Content',
        visibility: Visibility.AWS_ONLY,
      });

      const result = await handler(createEvent(content.id, awsEmployeeId), createContext());

      expect(result.statusCode).toBe(200);
    });

    it('denies aws_only content to regular users', async () => {
      const content = await createTestContent(pool, ownerId, {
        title: 'AWS Only Content',
        visibility: Visibility.AWS_ONLY,
      });

      const result = await handler(createEvent(content.id, otherUserId), createContext());

      expect(result.statusCode).toBe(404);
    });

    it('allows admins to view any content', async () => {
      const content = await createTestContent(pool, ownerId, {
        title: 'Private Content',
        visibility: Visibility.PRIVATE,
      });

      const result = await handler(createEvent(content.id, adminUserId), createContext());

      expect(result.statusCode).toBe(200);
    });
  });

  describe('validation and errors', () => {
    it('rejects invalid UUIDs', async () => {
      const result = await handler(createEvent('invalid-id', ownerId), createContext());

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 for non-existent content', async () => {
      const result = await handler(
        createEvent('00000000-0000-0000-0000-000000000000', ownerId),
        createContext()
      );

      expect(result.statusCode).toBe(404);
    });

    it('returns 404 when unauthenticated user requests private content', async () => {
      const content = await createTestContent(pool, ownerId, {
        title: 'Private Content',
        visibility: Visibility.PRIVATE,
      });

      const result = await handler(createEvent(content.id), createContext());

      expect(result.statusCode).toBe(404);
    });
  });

  describe('CORS headers', () => {
    it('includes CORS headers in success responses', async () => {
      const content = await createTestContent(pool, ownerId, {
        visibility: Visibility.PUBLIC,
      });

      const result = await handler(createEvent(content.id, ownerId), createContext());

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Headers');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Methods');
    });
  });
});

