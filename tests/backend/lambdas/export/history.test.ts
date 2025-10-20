import { APIGatewayProxyEvent } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { handler, closePool } from '../../../../src/backend/lambdas/export/history';
import { setupTestDatabase, teardownTestDatabase, resetTestData, createTestUser } from '../../repositories/test-setup';
import { Pool } from 'pg';

describe('Export History Lambda', () => {
  let pool: Pool;
  let userId: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type TEXT NOT NULL,
        user_id UUID,
        session_id TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )
    `);
  });

  afterAll(async () => {
    await closePool();
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await resetTestData();
    const user = await createTestUser(pool, {
      email: 'history-user@example.com',
      username: 'historyuser',
    });
    userId = user.id;
  });

  const createEvent = (
    queryParams: Record<string, string> = {},
    includeAuth: boolean = true
  ): APIGatewayProxyEvent => ({
    httpMethod: 'GET',
    path: '/export/history',
    headers: {},
    body: null,
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters: Object.keys(queryParams).length ? queryParams : null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123',
      apiId: 'api-id',
      protocol: 'HTTP/1.1',
      httpMethod: 'GET',
      path: '/export/history',
      stage: 'test',
      requestId: 'request-id',
      requestTimeEpoch: Date.now(),
      resourceId: 'resource-id',
      resourcePath: '/export/history',
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: 'test-agent',
        userArn: null,
      },
      authorizer: includeAuth
        ? {
            userId,
            claims: { sub: userId },
          }
        : undefined,
    },
    resource: '/export/history',
  } as any);

  const insertHistory = async (
    entries: Array<{
      exportType: string;
      exportFormat: string;
      createdAt: Date;
      metadata?: Record<string, any>;
    }>
  ) => {
    for (const entry of entries) {
      await pool.query(
        `INSERT INTO analytics_events (id, event_type, user_id, session_id, metadata, created_at)
         VALUES ($1, 'export', $2, $3, $4::jsonb, $5)`,
        [
          randomUUID(),
          userId,
          randomUUID(),
          JSON.stringify({
            exportType: entry.exportType,
            exportFormat: entry.exportFormat,
            programType: entry.exportFormat,
            rowCount: 10,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
            ...(entry.metadata ?? {}),
          }),
          entry.createdAt,
        ]
      );
    }
  };

  it('should require authentication', async () => {
    const event = createEvent({}, false);

    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('should return export history ordered by most recent first', async () => {
    const now = Date.now();
    await insertHistory([
      {
        exportType: 'program',
        exportFormat: 'community_builder',
        createdAt: new Date(now - 24 * 60 * 60 * 1000),
      },
      {
        exportType: 'analytics',
        exportFormat: 'analytics_export',
        createdAt: new Date(now - 60 * 60 * 1000),
        metadata: { groupBy: 'week' },
      },
    ]);

    const event = createEvent();
    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.total).toBe(2);
    expect(body.data.history).toHaveLength(2);
    expect(body.data.history[0].exportType).toBe('analytics');
    expect(body.data.history[0].parameters.groupBy).toBe('week');
    expect(body.data.history[1].exportType).toBe('program');
    expect(body.data.history[1].parameters.programType).toBe('community_builder');
  });

  it('should filter export history by exportType', async () => {
    const now = Date.now();
    await insertHistory([
      {
        exportType: 'program',
        exportFormat: 'hero',
        createdAt: new Date(now - 2 * 60 * 60 * 1000),
      },
      {
        exportType: 'analytics',
        exportFormat: 'analytics_export',
        createdAt: new Date(now - 30 * 60 * 1000),
      },
    ]);

    const event = createEvent({ exportType: 'program' });
    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.total).toBe(1);
    expect(body.data.history).toHaveLength(1);
    expect(body.data.history[0].exportFormat).toBe('hero');
  });

  it('should support pagination', async () => {
    const now = Date.now();
    await insertHistory([
      {
        exportType: 'program',
        exportFormat: 'community_builder',
        createdAt: new Date(now - 3 * 60 * 60 * 1000),
      },
      {
        exportType: 'program',
        exportFormat: 'hero',
        createdAt: new Date(now - 2 * 60 * 60 * 1000),
      },
      {
        exportType: 'analytics',
        exportFormat: 'analytics_export',
        createdAt: new Date(now - 1 * 60 * 60 * 1000),
      },
    ]);

    const event = createEvent({ limit: '2', offset: '1' });
    const response = await handler(event, {} as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.total).toBe(3);
    expect(body.data.history).toHaveLength(2);
    expect(body.data.history[0].exportType).toBe('program');
  });
});
