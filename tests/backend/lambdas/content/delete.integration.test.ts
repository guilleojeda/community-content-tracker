import { Pool } from 'pg';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import {
  setupTestDatabase,
  teardownTestDatabase,
  resetTestData,
  createTestUser,
  createTestContent,
} from '../../repositories/test-setup';
import { handler } from '../../../../src/backend/lambdas/content/delete';
import * as database from '../../../../src/backend/services/database';
import { Visibility, ContentType } from '@aws-community-hub/shared';

describe('Content Delete Lambda Handler (integration)', () => {
  let pool: Pool;
  let ownerId: string;
  let adminId: string;

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
      username: 'content-owner',
      isAdmin: false,
      isAwsEmployee: false,
    });
    ownerId = owner.id;

    const admin = await createTestUser(pool, {
      username: 'content-admin',
      isAdmin: true,
      isAwsEmployee: false,
    });
    adminId = admin.id;
  });

  const createEvent = (
    userId: string,
    overrides: {
      isAdmin?: boolean;
      queryStringParameters?: Record<string, string>;
    } = {}
  ): APIGatewayProxyEvent => ({
    body: null,
    headers: {
      'Content-Type': 'application/json',
    },
    multiValueHeaders: {},
    httpMethod: 'DELETE',
    isBase64Encoded: false,
    path: '/content/{id}',
    pathParameters: { id: '' },
    queryStringParameters: overrides.queryStringParameters || null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'test-request',
      stage: 'test',
      resourceId: 'test',
      resourcePath: '/content/{id}',
      httpMethod: 'DELETE',
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
      path: '/content/{id}',
      accountId: 'test-account',
      apiId: 'test-api',
      protocol: 'HTTP/1.1',
      authorizer: {
        userId,
        isAdmin: overrides.isAdmin ?? false,
        claims: {
          sub: userId,
          'cognito:groups': overrides.isAdmin ? ['Admins'] : [],
        },
      },
    },
    resource: '/content/{id}',
  } as any);

  const createContext = (): Context => ({
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'deleteContent',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:deleteContent',
    memoryLimitInMB: '256',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/deleteContent',
    logStreamName: 'test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  });

  const createContentWithUrls = async (userId: string, overrides: Record<string, any> = {}) => {
    const content = await createTestContent(pool, userId, {
      title: 'Deletable Content',
      contentType: ContentType.BLOG,
      visibility: Visibility.PUBLIC,
      isClaimed: true,
      ...overrides,
    });

    await pool.query(
      'INSERT INTO content_urls (content_id, url) VALUES ($1, $2), ($1, $3)',
      [content.id, 'https://example.com/primary', 'https://mirror.example.com/primary']
    );

    return content;
  };

  it('soft deletes content and associated URLs for the owner', async () => {
    const content = await createContentWithUrls(ownerId, { isClaimed: false });

    const event = createEvent(ownerId);
    event.pathParameters = { id: content.id };

    const result = await handler(event, createContext());

    expect(result.statusCode).toBe(204);
    expect(result.body).toBe('');

    const contentRow = await pool.query('SELECT deleted_at FROM content WHERE id = $1', [content.id]);
    expect(contentRow.rows[0].deleted_at).not.toBeNull();

    const urlRows = await pool.query(
      'SELECT deleted_at FROM content_urls WHERE content_id = $1',
      [content.id]
    );
    expect(urlRows.rows).toHaveLength(2);
    urlRows.rows.forEach(row => {
      expect(row.deleted_at).not.toBeNull();
    });
  });

  it('force deletes content and cascades URLs for admins', async () => {
    const content = await createContentWithUrls(ownerId);

    const event = createEvent(adminId, {
      isAdmin: true,
      queryStringParameters: { force: 'true' },
    });
    event.pathParameters = { id: content.id };

    const result = await handler(event, createContext());
    expect(result.statusCode).toBe(204);

    const contentCheck = await pool.query('SELECT * FROM content WHERE id = $1', [content.id]);
    expect(contentCheck.rowCount).toBe(0);

    const urlCheck = await pool.query('SELECT * FROM content_urls WHERE content_id = $1', [content.id]);
    expect(urlCheck.rowCount).toBe(0);
  });
});
