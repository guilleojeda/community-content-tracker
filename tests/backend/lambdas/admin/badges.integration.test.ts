import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { Pool } from 'pg';
import { handler as badgesHandler, __setBadgeDependenciesForTest } from '../../../../src/backend/lambdas/admin/badges';
import { BadgeRepository } from '../../../../src/backend/repositories/BadgeRepository';
import { BadgeType } from '../../../../src/shared/types';
import {
  setupTestDatabase,
  teardownTestDatabase,
  resetTestData,
  createTestUser,
} from '../../repositories/test-setup';
import * as database from '../../../../src/backend/services/database';

describe('Admin Badges Lambda (integration)', () => {
  let pool: Pool;
  let adminId: string;
  let userId: string;
  let badgeRepository: BadgeRepository;

  const createContext = (): Context =>
    ({
      callbackWaitsForEmptyEventLoop: false,
      functionName: 'admin-badges',
      functionVersion: '1',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:admin-badges',
      memoryLimitInMB: '256',
      awsRequestId: 'admin-badges-test',
      logGroupName: '/aws/lambda/admin-badges',
      logStreamName: 'test',
      getRemainingTimeInMillis: () => 30000,
      done: () => {},
      fail: () => {},
      succeed: () => {},
    } as Context);

  const createEvent = (
    method: string,
    path: string,
    adminUserId: string,
    body?: Record<string, unknown>,
    pathParameters?: Record<string, string>
  ): APIGatewayProxyEvent =>
    ({
      httpMethod: method,
      path,
      pathParameters: pathParameters ?? null,
      body: body ? JSON.stringify(body) : null,
      headers: { 'Content-Type': 'application/json' },
      multiValueHeaders: {},
      isBase64Encoded: false,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {
        requestId: 'admin-badges-request',
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
      resource: path,
    } as APIGatewayProxyEvent);

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;

    process.env.DATABASE_URL = setup.connectionString;
    database.resetDatabaseCache();
    database.setTestDatabasePool(pool);

    badgeRepository = new BadgeRepository(pool);
    __setBadgeDependenciesForTest(null);
  });

  afterAll(async () => {
    __setBadgeDependenciesForTest(null);
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();
    const admin = await createTestUser(pool, {
      username: 'admin-user',
      isAdmin: true,
    });
    const user = await createTestUser(pool, {
      username: 'badge-user',
      isAdmin: false,
    });
    adminId = admin.id;
    userId = user.id;
    __setBadgeDependenciesForTest(null);
  });

  it('grants a badge and records audit log', async () => {
    const response = await badgesHandler(
      createEvent('POST', '/admin/badges', adminId, {
        userId,
        badgeType: BadgeType.HERO,
        reason: 'Outstanding contribution',
      }),
      createContext()
    );

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.badgeType).toBe(BadgeType.HERO);

    const badgeRows = await pool.query(
      'SELECT badge_type, is_active FROM user_badges WHERE user_id = $1',
      [userId]
    );
    expect(badgeRows.rows).toHaveLength(1);
    expect(badgeRows.rows[0].badge_type).toBe(BadgeType.HERO);
    expect(badgeRows.rows[0].is_active).toBe(true);

    const auditRows = await pool.query(
      'SELECT action, resource_id FROM audit_log WHERE action = $1 ORDER BY created_at DESC LIMIT 1',
      ['badge.grant']
    );
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0].resource_id).toBe(userId);
  });

  it('revokes a badge and records audit log', async () => {
    await badgeRepository.awardBadge({
      userId,
      badgeType: BadgeType.COMMUNITY_BUILDER,
      awardedBy: adminId,
      awardedReason: 'Initial grant',
    });

    const response = await badgesHandler(
      createEvent('DELETE', '/admin/badges', adminId, {
        userId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        reason: 'Badge revoked',
      }),
      createContext()
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);

    const badgeRows = await pool.query(
      'SELECT badge_type, is_active, revoked_by FROM user_badges WHERE user_id = $1',
      [userId]
    );
    expect(badgeRows.rows[0].is_active).toBe(false);

    const auditRows = await pool.query(
      'SELECT action, resource_id FROM audit_log WHERE action = $1 ORDER BY created_at DESC LIMIT 1',
      ['badge.revoke']
    );
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0].resource_id).toBe(userId);
  });
});
