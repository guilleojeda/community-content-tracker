import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/admin/admin-dashboard';
import { getDatabasePool } from '../../../../src/backend/services/database';
import { BadgeType } from '@aws-community-hub/shared';

// Mock database
jest.mock('../../../../src/backend/services/database');

describe('Admin Dashboard Lambda', () => {
  const mockPool = {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
  });

  const createMockEvent = (isAdmin: boolean = true, path: string = '/admin/dashboard/stats'): APIGatewayProxyEvent => ({
    httpMethod: 'GET',
    path,
    headers: {},
    body: null,
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123',
      apiId: 'api-id',
      protocol: 'HTTP/1.1',
      httpMethod: 'GET',
      path,
      stage: 'test',
      requestId: 'request-id',
      requestTimeEpoch: 0,
      resourceId: 'resource-id',
      resourcePath: path,
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
      authorizer: {
        isAdmin: isAdmin,
        userId: 'admin-123',
        claims: {
          sub: 'admin-123',
          'cognito:groups': isAdmin ? 'Admin' : 'User',
        },
      },
    },
    resource: path,
  } as any);

  describe('GET /admin/dashboard/stats', () => {
    it('should return admin dashboard statistics when user is admin', async () => {
      const event = createMockEvent(true, '/admin/dashboard/stats');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ total_users: 150, aws_employees: 25 }],
        })
        .mockResolvedValueOnce({
          rows: [
            { badge_type: BadgeType.COMMUNITY_BUILDER, count: 50 },
            { badge_type: BadgeType.HERO, count: 20 },
            { badge_type: BadgeType.AMBASSADOR, count: 10 },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ total_content: 5000 }],
        })
        .mockResolvedValueOnce({
          rows: [
            { id: 'user-1', username: 'newuser1', email: 'new1@test.com', created_at: new Date() },
            { id: 'user-2', username: 'newuser2', email: 'new2@test.com', created_at: new Date() },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { id: 'user-3', username: 'candidate1', email: 'candidate1@test.com', content_count: 5, created_at: new Date() },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ flagged_count: 3 }],
        })
        .mockResolvedValueOnce({
          rows: [{ recent_actions: 12 }],
        })
        .mockResolvedValueOnce({
          rows: [{ users_without_badges: 25 }],
        })
        .mockResolvedValueOnce({
          rows: [{ content_needing_review: 8 }],
        });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('totalUsers', 150);
      expect(body.data).toHaveProperty('awsEmployees', 25);
      expect(body.data).toHaveProperty('usersByBadgeType');
      expect(body.data.usersByBadgeType).toEqual({
        [BadgeType.COMMUNITY_BUILDER]: 50,
        [BadgeType.HERO]: 20,
        [BadgeType.AMBASSADOR]: 10,
      });
      expect(body.data).toHaveProperty('totalContent', 5000);
      expect(body.data).toHaveProperty('recentRegistrations');
      expect(body.data.recentRegistrations).toHaveLength(2);
      expect(body.data).toHaveProperty('pendingBadgeCandidates');
      expect(body.data.pendingBadgeCandidates).toHaveLength(1);
      expect(body.data).toHaveProperty('quickActions');
      expect(body.data.quickActions).toHaveProperty('flaggedContentCount', 3);
      expect(body.data.quickActions).toHaveProperty('recentAdminActions', 12);
      expect(body.data.quickActions).toHaveProperty('usersWithoutBadges', 25);
      expect(body.data.quickActions).toHaveProperty('contentNeedingReview', 8);
    });

    it('should return 403 when user is not admin', async () => {
      const event = createMockEvent(false, '/admin/dashboard/stats');

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
    });

    it('should handle database errors gracefully', async () => {
      const event = createMockEvent(true, '/admin/dashboard/stats');
      mockPool.query.mockRejectedValue(new Error('Database connection failed'));

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should count only flagged content for the review quick action', async () => {
      const event = createMockEvent(true, '/admin/dashboard/stats');

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total_users: 5, aws_employees: 2 }] }) // user stats
        .mockResolvedValueOnce({ rows: [] }) // badge stats
        .mockResolvedValueOnce({ rows: [{ total_content: 10 }] }) // content stats
        .mockResolvedValueOnce({ rows: [] }) // recent registrations
        .mockResolvedValueOnce({ rows: [] }) // pending candidates
        .mockResolvedValueOnce({ rows: [{ flagged_count: 0 }] }) // flagged content
        .mockResolvedValueOnce({ rows: [{ recent_actions: 0 }] }) // recent admin actions
        .mockResolvedValueOnce({ rows: [{ users_without_badges: 0 }] }) // users without badges
        .mockResolvedValueOnce({ rows: [{ content_needing_review: 0 }] }); // needing review

      await handler(event, {} as any);

      const contentReviewQuery = mockPool.query.mock.calls[8]?.[0] as string | undefined;
      expect(contentReviewQuery).toBeDefined();
      expect(contentReviewQuery).toContain("moderation_status = 'flagged'");
    });
  });

  describe('GET /admin/dashboard/system-health', () => {
    const mockContext = {
      functionName: 'test-function',
      functionVersion: '1',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123:function:test',
      memoryLimitInMB: '512',
      awsRequestId: 'test-request-id',
      logGroupName: '/aws/lambda/test',
      logStreamName: '2024/01/01/test',
      getRemainingTimeInMillis: () => 30000,
      done: () => {},
      fail: () => {},
      succeed: () => {},
      callbackWaitsForEmptyEventLoop: true,
    };

    it('should return comprehensive system health indicators when user is admin', async () => {
      const event = createMockEvent(true, '/admin/dashboard/system-health');

      // First query: SELECT 1 (health check)
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: 1 }],
      });

      // Second query: connection pool stats
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          total_connections: 10,
          active_connections: 3,
          idle_connections: 7,
          waiting_connections: 0,
        }],
      });

      const response = await handler(event, mockContext as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('database', 'healthy');
      expect(body.data).toHaveProperty('timestamp');
      expect(body.data).toHaveProperty('queryPerformance');
      expect(body.data.queryPerformance).toHaveProperty('lastQueryMs');
      expect(typeof body.data.queryPerformance.lastQueryMs).toBe('number');
      expect(body.data).toHaveProperty('connectionPool');
      expect(body.data.connectionPool).toHaveProperty('totalConnections', 10);
      expect(body.data.connectionPool).toHaveProperty('activeConnections', 3);
      expect(body.data.connectionPool).toHaveProperty('idleConnections', 7);
      expect(body.data.connectionPool).toHaveProperty('waitingConnections', 0);
      expect(body.data).toHaveProperty('lambda');
      expect(body.data.lambda).toHaveProperty('memoryUsedMB');
      expect(body.data.lambda).toHaveProperty('memoryLimitMB', 512);
    });

    it('should return healthy status without pool metrics if pool query fails', async () => {
      const event = createMockEvent(true, '/admin/dashboard/system-health');

      // First query succeeds
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: 1 }],
      });

      // Second query (pool stats) fails
      mockPool.query.mockRejectedValueOnce(new Error('pg_stat_activity not available'));

      const response = await handler(event, mockContext as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.database).toBe('healthy');
      expect(body.data).toHaveProperty('queryPerformance');
      expect(body.data).not.toHaveProperty('connectionPool');
    });

    it('should return unhealthy status when database is down', async () => {
      const event = createMockEvent(true, '/admin/dashboard/system-health');
      mockPool.query.mockRejectedValue(new Error('Connection failed'));

      const response = await handler(event, mockContext as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.database).toBe('unhealthy');
      expect(body.data).toHaveProperty('error', 'Connection failed');
    });

    it('should include Lambda memory metrics when context is available', async () => {
      const event = createMockEvent(true, '/admin/dashboard/system-health');

      mockPool.query.mockResolvedValueOnce({ rows: [{ count: 1 }] });
      mockPool.query.mockResolvedValueOnce({
        rows: [{ total_connections: 5, active_connections: 2, idle_connections: 3, waiting_connections: 0 }],
      });

      const response = await handler(event, mockContext as any);

      const body = JSON.parse(response.body);
      expect(body.data).toHaveProperty('lambda');
      expect(body.data.lambda.memoryUsedMB).toBeGreaterThan(0);
      expect(body.data.lambda.memoryLimitMB).toBe(512);
    });

    it('should return 403 when user is not admin', async () => {
      const event = createMockEvent(false, '/admin/dashboard/system-health');

      const response = await handler(event, mockContext as any);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
    });
  });
});
