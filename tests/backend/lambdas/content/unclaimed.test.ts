import { Pool } from 'pg';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import {
  setupTestDatabase,
  teardownTestDatabase,
  resetTestData,
  createTestUser,
  createTestContent,
} from '../../repositories/test-setup';
import { ContentType, Visibility } from '@aws-community-hub/shared';
import { handler } from '../../../../src/backend/lambdas/content/unclaimed';
import * as database from '../../../../src/backend/services/database';

describe('Unclaimed Content Lambda Handler (integration)', () => {
  let pool: Pool;
  let regularUserId: string;
  let awsEmployeeUserId: string;
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

    const regularUser = await createTestUser(pool, {
      username: 'regular-user',
      isAdmin: false,
      isAwsEmployee: false,
    });
    regularUserId = regularUser.id;

    const awsEmployee = await createTestUser(pool, {
      username: 'aws-employee',
      isAdmin: false,
      isAwsEmployee: true,
    });
    awsEmployeeUserId = awsEmployee.id;

    const adminUser = await createTestUser(pool, {
      username: 'admin-user',
      isAdmin: true,
      isAwsEmployee: false,
    });
    adminUserId = adminUser.id;
  });

  const createEvent = (
    userId: string | null,
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
      authorizer: userId
        ? {
            claims: {
              sub: userId,
              email: 'test@example.com',
            },
          }
        : undefined,
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

  const insertUrls = async (contentId: string, urls: string[]) => {
    for (const url of urls) {
      await pool.query(
        'INSERT INTO content_urls (content_id, url) VALUES ($1, $2)',
        [contentId, url]
      );
    }
  };

  it('lists unclaimed content with metadata and URLs', async () => {
    const unclaimed = await createTestContent(pool, regularUserId, {
      title: 'Unclaimed Blog Post',
      contentType: ContentType.BLOG,
      visibility: Visibility.PUBLIC,
      isClaimed: false,
      originalAuthor: 'Jane Doe',
    });
    await insertUrls(unclaimed.id, [
      'https://blog.example.com/post',
      'https://medium.example.com/post',
    ]);
    await pool.query(
      'UPDATE content SET original_author = $1 WHERE id = $2',
      ['Jane Doe', unclaimed.id]
    );

    await createTestContent(pool, regularUserId, {
      title: 'Claimed Blog Post',
      visibility: Visibility.PUBLIC,
      isClaimed: true,
    });

    const result = await handler(createEvent(regularUserId), createContext());
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);

    const item = body.items[0];
    expect(item.id).toBe(unclaimed.id);
    expect(item.isClaimed).toBe(false);
    expect(item.originalAuthor).toBe('Jane Doe');
    expect(item.urls).toHaveLength(2);
    expect(item.urls.map((u: any) => u.url)).toEqual(
      expect.arrayContaining([
        'https://blog.example.com/post',
        'https://medium.example.com/post',
      ])
    );
  });

  it('requires authentication', async () => {
    const result = await handler(createEvent(null), createContext());
    expect(result.statusCode).toBe(401);

    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('filters by content type', async () => {
    await createTestContent(pool, regularUserId, {
      title: 'Blog Content',
      visibility: Visibility.PUBLIC,
      contentType: ContentType.BLOG,
      isClaimed: false,
    });

    await createTestContent(pool, regularUserId, {
      title: 'Video Content',
      visibility: Visibility.PUBLIC,
      contentType: ContentType.YOUTUBE,
      isClaimed: false,
    });

    const event = createEvent(regularUserId, { contentType: ContentType.BLOG });
    const result = await handler(event, createContext());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].contentType).toBe(ContentType.BLOG);
  });

  it('supports pagination with limit and offset', async () => {
    for (let i = 0; i < 3; i++) {
      await createTestContent(pool, regularUserId, {
        title: `Unclaimed ${i}`,
        visibility: Visibility.PUBLIC,
        isClaimed: false,
      });
    }

    const firstPage = await handler(
      createEvent(regularUserId, { limit: '2', offset: '0' }),
      createContext()
    );
    const firstBody = JSON.parse(firstPage.body);
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.total).toBe(3);

    const secondPage = await handler(
      createEvent(regularUserId, { limit: '2', offset: '2' }),
      createContext()
    );
    const secondBody = JSON.parse(secondPage.body);
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.total).toBe(3);
  });

  it('sorts results by title ascending', async () => {
    await createTestContent(pool, regularUserId, {
      title: 'Zebra Article',
      visibility: Visibility.PUBLIC,
      isClaimed: false,
    });
    await createTestContent(pool, regularUserId, {
      title: 'Alpha Article',
      visibility: Visibility.PUBLIC,
      isClaimed: false,
    });

    const event = createEvent(regularUserId, { sortBy: 'title', sortOrder: 'asc' });
    const result = await handler(event, createContext());
    const body = JSON.parse(result.body);

    const titles = body.items.map((item: any) => item.title);
    expect(titles[0]).toBe('Alpha Article');
    expect(titles[1]).toBe('Zebra Article');
  });

  it('restricts AWS_ONLY visibility to AWS employees and admins', async () => {
    await createTestContent(pool, regularUserId, {
      title: 'Public Unclaimed',
      visibility: Visibility.PUBLIC,
      isClaimed: false,
    });

    const awsOnlyContent = await createTestContent(pool, regularUserId, {
      title: 'Internal Talk',
      visibility: Visibility.AWS_ONLY,
      isClaimed: false,
    });

    const regularResponse = await handler(createEvent(regularUserId), createContext());
    const regularBody = JSON.parse(regularResponse.body);
    expect(regularBody.items.find((item: any) => item.id === awsOnlyContent.id)).toBeUndefined();

    const employeeResponse = await handler(createEvent(awsEmployeeUserId), createContext());
    const employeeBody = JSON.parse(employeeResponse.body);
    expect(employeeBody.items.find((item: any) => item.id === awsOnlyContent.id)).toBeDefined();

    const adminResponse = await handler(createEvent(adminUserId), createContext());
    const adminBody = JSON.parse(adminResponse.body);
    expect(adminBody.items.find((item: any) => item.id === awsOnlyContent.id)).toBeDefined();
  });

  it('returns validation errors for invalid pagination parameters', async () => {
    const invalidLimit = await handler(
      createEvent(regularUserId, { limit: '-1' }),
      createContext()
    );
    expect(invalidLimit.statusCode).toBe(400);

    const invalidOffset = await handler(
      createEvent(regularUserId, { offset: 'not-a-number' }),
      createContext()
    );
    expect(invalidOffset.statusCode).toBe(400);
  });
});
