import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { Pool } from 'pg';
import { handler as auditLogHandler } from '../../../../src/backend/lambdas/admin/audit-log';
import {
  setupTestDatabase,
  teardownTestDatabase,
  resetTestData,
  createTestUser,
} from '../../repositories/test-setup';
import * as database from '../../../../src/backend/services/database';

describe('Admin Audit Log Lambda (integration)', () => {
  let pool: Pool;
  let adminId: string;
  let targetUserId: string;

  const createContext = (): Context =>
    ({
      callbackWaitsForEmptyEventLoop: false,
      functionName: 'admin-audit-log',
      functionVersion: '1',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:admin-audit-log',
      memoryLimitInMB: '256',
      awsRequestId: 'admin-audit-log-test',
      logGroupName: '/aws/lambda/admin-audit-log',
      logStreamName: 'test',
      getRemainingTimeInMillis: () => 30000,
      done: () => {},
      fail: () => {},
      succeed: () => {},
    } as Context);

  const createEvent = (adminUserId: string, query: Record<string, string> = {}): APIGatewayProxyEvent =>
    ({
      httpMethod: 'GET',
      path: '/admin/audit-log',
      headers: {},
      multiValueHeaders: {},
      body: null,
      isBase64Encoded: false,
      queryStringParameters: query,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      requestContext: {
        requestId: 'admin-audit-log-request',
        authorizer: {
          isAdmin: true,
          userId: adminUserId,
          claims: {
            sub: adminUserId,
            'cognito:groups': ['Admin'],
          },
        },
        identity: {
          sourceIp: '127.0.0.1',
          userAgent: 'integration-test',
        },
      },
      resource: '/admin/audit-log',
    } as APIGatewayProxyEvent);

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
    const admin = await createTestUser(pool, {
      username: 'admin-audit',
      isAdmin: true,
    });
    const target = await createTestUser(pool, {
      username: 'audit-target',
      isAdmin: false,
    });
    adminId = admin.id;
    targetUserId = target.id;

    await pool.query(
      `INSERT INTO admin_actions (admin_user_id, action_type, target_user_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        adminId,
        'set_aws_employee',
        targetUserId,
        JSON.stringify({ isAwsEmployee: true }),
        '127.0.0.1',
      ]
    );
  });

  it('returns audit log entries with user metadata', async () => {
    const response = await auditLogHandler(
      createEvent(adminId, { limit: '10', offset: '0' }),
      createContext()
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.entries).toHaveLength(1);
    expect(body.data.entries[0].adminUser.id).toBe(adminId);
    expect(body.data.entries[0].targetUser?.id).toBe(targetUserId);
    expect(body.data.entries[0].actionType).toBe('set_aws_employee');
  });
});
