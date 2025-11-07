import { Pool } from 'pg';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import {
  setupTestDatabase,
  teardownTestDatabase,
  resetTestData,
  createTestUser,
  createTestContent,
} from '../../repositories/test-setup';
import { handler as mergeHandler } from '../../../../src/backend/lambdas/content/merge';
import { handler as unmergeHandler } from '../../../../src/backend/lambdas/content/unmerge';
import * as database from '../../../../src/backend/services/database';

describe('Content Merge Lambda Handler (integration)', () => {
  let pool: Pool;
  let ownerId: string;

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
      username: 'merge-owner',
      isAdmin: false,
      isAwsEmployee: false,
    });
    ownerId = owner.id;
  });

  const createMergeEvent = (
    userId: string,
    body: Record<string, any>
  ): APIGatewayProxyEvent => ({
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/content/merge',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'merge-request',
      stage: 'test',
      resourceId: 'merge',
      resourcePath: '/content/merge',
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
      path: '/content/merge',
      accountId: 'test-account',
      apiId: 'test-api',
      protocol: 'HTTP/1.1',
      authorizer: {
        userId,
        isAdmin: false,
      },
    },
    resource: '/content/merge',
  } as any);

  const createUnmergeEvent = (userId: string, mergeId: string): APIGatewayProxyEvent => ({
    body: null,
    headers: {
      'Content-Type': 'application/json',
    },
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: `/content/${mergeId}/unmerge`,
    pathParameters: { id: mergeId },
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'unmerge-request',
      stage: 'test',
      resourceId: 'unmerge',
      resourcePath: '/content/{id}/unmerge',
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
      path: '/content/{id}/unmerge',
      accountId: 'test-account',
      apiId: 'test-api',
      protocol: 'HTTP/1.1',
      authorizer: {
        userId,
        isAdmin: false,
      },
    },
    resource: '/content/{id}/unmerge',
  } as any);

  const createContext = (): Context => ({
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'mergeContent',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:mergeContent',
    memoryLimitInMB: '256',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/mergeContent',
    logStreamName: 'test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  });

  const insertUrl = async (contentId: string, url: string) => {
    await pool.query('INSERT INTO content_urls (content_id, url) VALUES ($1, $2)', [contentId, url]);
  };

  it('merges content items and supports undo within 30 days', async () => {
    const primary = await createTestContent(pool, ownerId, {
      title: 'Short Title',
      description: 'Primary description',
      tags: ['aws', 'lambda'],
      publishDate: new Date('2024-04-01T00:00:00Z'),
      isClaimed: true,
    });
    await insertUrl(primary.id, 'https://example.com/primary');

    const secondary = await createTestContent(pool, ownerId, {
      title: 'Comprehensive Guide to AWS Lambda Functions',
      description: 'Secondary description with more details',
      tags: ['serverless', 'lambda'],
      publishDate: new Date('2023-12-15T00:00:00Z'),
      isClaimed: true,
    });
    await insertUrl(secondary.id, 'https://example.com/secondary');
    await insertUrl(secondary.id, 'https://medium.com/secondary');

    const mergeEvent = createMergeEvent(ownerId, {
      contentIds: [primary.id, secondary.id],
      primaryId: primary.id,
      reason: 'Duplicate entries',
    });

    const mergeResponse = await mergeHandler(mergeEvent, createContext());
    expect(mergeResponse.statusCode).toBe(200);

    const mergeBody = JSON.parse(mergeResponse.body);
    expect(mergeBody.content.id).toBe(primary.id);
    expect(mergeBody.content.urls).toHaveLength(3);
    expect(mergeBody.content.tags).toEqual(expect.arrayContaining(['aws', 'lambda', 'serverless']));
    expect(mergeBody.content.title).toBe('Comprehensive Guide to AWS Lambda Functions');
    expect(new Date(mergeBody.content.publishDate).toISOString()).toBe('2023-12-15T00:00:00.000Z');

    const secondaryRow = await pool.query('SELECT deleted_at FROM content WHERE id = $1', [
      secondary.id,
    ]);
    expect(secondaryRow.rows[0].deleted_at).not.toBeNull();

    expect(mergeBody.mergeHistory).toBeDefined();
    const mergeHistoryId = mergeBody.mergeHistory.id;

    const unmergeResponse = await unmergeHandler(
      createUnmergeEvent(ownerId, mergeHistoryId),
      createContext()
    );
    expect(unmergeResponse.statusCode).toBe(200);

    const restoredSecondary = await pool.query(
      'SELECT deleted_at FROM content WHERE id = $1',
      [secondary.id]
    );
    expect(restoredSecondary.rows[0].deleted_at).toBeNull();

    const historyEntry = await pool.query(
      'SELECT can_undo FROM content_merge_history WHERE id = $1',
      [mergeHistoryId]
    );
    expect(historyEntry.rows[0].can_undo).toBe(false);
  });
});
