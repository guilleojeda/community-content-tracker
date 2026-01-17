import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { Pool } from 'pg';
import { handler as setAwsEmployeeHandler } from '../../../../src/backend/lambdas/admin/set-aws-employee';
import {
  setupTestDatabase,
  teardownTestDatabase,
  resetTestData,
  createTestUser,
} from '../../repositories/test-setup';
import * as database from '../../../../src/backend/services/database';

describe('Set AWS Employee Lambda (integration)', () => {
  let pool: Pool;
  let adminId: string;
  let targetUserId: string;

  const createContext = (): Context =>
    ({
      callbackWaitsForEmptyEventLoop: false,
      functionName: 'admin-set-aws-employee',
      functionVersion: '1',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:admin-set-aws-employee',
      memoryLimitInMB: '256',
      awsRequestId: 'admin-set-aws-employee-test',
      logGroupName: '/aws/lambda/admin-set-aws-employee',
      logStreamName: 'test',
      getRemainingTimeInMillis: () => 30000,
      done: () => {},
      fail: () => {},
      succeed: () => {},
    } as Context);

  const createEvent = (
    adminUserId: string,
    userId: string,
    body: Record<string, unknown>
  ): APIGatewayProxyEvent =>
    ({
      httpMethod: 'PUT',
      path: `/admin/users/${userId}/aws-employee`,
      pathParameters: { id: userId },
      headers: { 'Content-Type': 'application/json' },
      multiValueHeaders: {},
      isBase64Encoded: false,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      body: JSON.stringify(body),
      requestContext: {
        requestId: 'admin-set-aws-employee-request',
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
      resource: '/admin/users/{id}/aws-employee',
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
      username: 'admin-user',
      isAdmin: true,
      isAwsEmployee: false,
    });
    const user = await createTestUser(pool, {
      username: 'employee-user',
      isAdmin: false,
      isAwsEmployee: false,
    });
    adminId = admin.id;
    targetUserId = user.id;
  });

  it('updates AWS employee flag and records admin action', async () => {
    const response = await setAwsEmployeeHandler(
      createEvent(adminId, targetUserId, {
        isAwsEmployee: true,
        reason: 'Verified via documentation',
      }),
      createContext()
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.isAwsEmployee).toBe(true);

    const userRow = await pool.query(
      'SELECT is_aws_employee FROM users WHERE id = $1',
      [targetUserId]
    );
    expect(userRow.rows[0].is_aws_employee).toBe(true);

    const auditRows = await pool.query(
      'SELECT action_type, target_user_id FROM admin_actions WHERE target_user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [targetUserId]
    );
    expect(auditRows.rows[0].action_type).toBe('set_aws_employee');
    expect(auditRows.rows[0].target_user_id).toBe(targetUserId);
  });
});
