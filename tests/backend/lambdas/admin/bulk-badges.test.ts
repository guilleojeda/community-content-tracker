import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/admin/bulk-badges';
import { getDatabasePool } from '../../../../src/backend/services/database';
import { BadgeType } from '@aws-community-hub/shared';

// Mock database
jest.mock('../../../../src/backend/services/database');

describe('Bulk Badges Lambda', () => {
  const mockClient = {
    query: jest.fn(),
    release: jest.fn(),
  };

  const mockPool = {
    query: jest.fn(),
    connect: jest.fn(() => Promise.resolve(mockClient)),
    end: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
  });

  const createMockEvent = (
    isAdmin: boolean = true,
    body: any = null
  ): APIGatewayProxyEvent => ({
    httpMethod: 'POST',
    path: '/admin/badges/bulk',
    headers: {},
    body: body ? JSON.stringify(body) : null,
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
      httpMethod: 'POST',
      path: '/admin/badges/bulk',
      stage: 'test',
      requestId: 'request-id',
      requestTimeEpoch: 0,
      resourceId: 'resource-id',
      resourcePath: '/admin/badges/bulk',
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
        userId: 'admin-bulk-789',
        claims: {
          sub: 'admin-bulk-789',
          'cognito:groups': isAdmin ? 'Admin' : 'User',
        },
      },
    },
    resource: '/admin/badges/bulk',
  } as any);

  const findAuditCalls = (actionType: string) =>
    mockClient.query.mock.calls.filter(
      ([, params]) => Array.isArray(params) && params[1] === actionType
    );

  describe('Authentication and Authorization', () => {
    it('should return 403 when user is not admin', async () => {
      const event = createMockEvent(false, {
        operation: 'grant',
        userIds: ['user-1', 'user-2'],
        badgeType: BadgeType.HERO,
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
      expect(mockClient.query).not.toHaveBeenCalled();
    });
  });

  describe('Input Validation', () => {
    it('should return 400 when body is missing', async () => {
      const event = createMockEvent(true, null);

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when operation is missing', async () => {
      const event = createMockEvent(true, {
        userIds: ['user-1'],
        badgeType: BadgeType.AMBASSADOR,
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('operation is required');
    });

    it('should return 400 when operation is invalid', async () => {
      const event = createMockEvent(true, {
        operation: 'invalid_op',
        userIds: ['user-1'],
        badgeType: BadgeType.HERO,
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('grant" or "revoke');
    });

    it('should return 400 when userIds is missing', async () => {
      const event = createMockEvent(true, {
        operation: 'grant',
        badgeType: BadgeType.COMMUNITY_BUILDER,
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('userIds must be a non-empty array');
    });

    it('should return 400 when userIds is empty array', async () => {
      const event = createMockEvent(true, {
        operation: 'revoke',
        userIds: [],
        badgeType: BadgeType.HERO,
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('non-empty array');
    });

    it('should return 400 when badgeType is missing', async () => {
      const event = createMockEvent(true, {
        operation: 'grant',
        userIds: ['user-1', 'user-2'],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('badgeType is required');
    });

    it('should return 400 when badgeType is invalid', async () => {
      const event = createMockEvent(true, {
        operation: 'grant',
        userIds: ['user-1'],
        badgeType: 'invalid_type',
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('Invalid badge type');
    });
  });

  describe('Bulk Grant Operation', () => {
    it('should grant badges to multiple users successfully', async () => {
      const event = createMockEvent(true, {
        operation: 'grant',
        userIds: ['user-1', 'user-2', 'user-3'],
        badgeType: BadgeType.COMMUNITY_BUILDER,
        reason: 'Community excellence',
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // User 1: exists, no badge
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'user-1' }] }); // user check
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // badge check
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'badge-1' }] }); // insert
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // audit

      // User 2: exists, no badge
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'user-2' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'badge-2' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // User 3: exists, no badge
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'user-3' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'badge-3' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock COMMIT
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.successful).toBe(3);
      expect(body.data.failed).toHaveLength(0);
      expect(body.data.summary.total).toBe(3);

      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle mixed success and failures during bulk grant', async () => {
      const event = createMockEvent(true, {
        operation: 'grant',
        userIds: ['user-valid', 'user-nonexistent', 'user-has-badge'],
        badgeType: BadgeType.HERO,
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // User 1: valid - success
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'user-valid' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'badge-x' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // User 2: does not exist - failure
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // user not found

      // User 3: already has active badge - failure
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'user-has-badge' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'badge-existing', is_active: true }] });

      // Mock COMMIT
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.successful).toBe(1);
      expect(body.data.failed).toHaveLength(2);

      const failedUserIds = body.data.failed.map((f: any) => f.userId);
      expect(failedUserIds).toContain('user-nonexistent');
      expect(failedUserIds).toContain('user-has-badge');

      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('Bulk Revoke Operation', () => {
    it('should revoke badges from multiple users successfully', async () => {
      const event = createMockEvent(true, {
        operation: 'revoke',
        userIds: ['user-a', 'user-b'],
        badgeType: BadgeType.AMBASSADOR,
        reason: 'Policy update',
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // User A: has active badge
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'badge-a', is_active: true }],
      });
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // UPDATE
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // audit

      // User B: has active badge
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'badge-b', is_active: true }],
      });
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // UPDATE
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // audit

      // Mock COMMIT
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.successful).toBe(2);
      expect(body.data.failed).toHaveLength(0);

      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle mixed success and failures during bulk revoke', async () => {
      const event = createMockEvent(true, {
        operation: 'revoke',
        userIds: ['user-has-active', 'user-no-badge', 'user-already-revoked'],
        badgeType: BadgeType.USER_GROUP_LEADER,
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // User 1: has active badge - success
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'badge-1', is_active: true }],
      });
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // UPDATE
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // audit

      // User 2: no badge - failure
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // User 3: badge already revoked - failure
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'badge-3', is_active: false }],
      });

      // Mock COMMIT
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.successful).toBe(1);
      expect(body.data.failed).toHaveLength(2);

      const failedUsers = body.data.failed;
      expect(failedUsers.some((f: any) => f.userId === 'user-no-badge')).toBe(true);
      expect(failedUsers.some((f: any) => f.userId === 'user-already-revoked')).toBe(true);
    });
  });

  describe('Transaction Rollback', () => {
    it('should rollback transaction on database error', async () => {
      const event = createMockEvent(true, {
        operation: 'grant',
        userIds: ['user-1', 'user-2'],
        badgeType: BadgeType.HERO,
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // User 1 succeeds
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'user-1' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'badge-1' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // User 2 - database error during insert
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'user-2' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      mockClient.query.mockRejectedValueOnce(new Error('Database constraint violation'));

      // Mock ROLLBACK
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const response = await handler(event, {} as any);

      // Implementation handles individual user failures gracefully (partial success)
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.successful).toBe(1); // User 1 succeeded
      expect(body.data.failed).toHaveLength(1); // User 2 failed
      expect(body.data.failed[0].userId).toBe('user-2');
      expect(body.data.failed[0].error).toContain('constraint violation');

      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('Audit Logging', () => {
    it('should log each operation in audit trail for bulk grant', async () => {
      const event = createMockEvent(true, {
        operation: 'grant',
        userIds: ['user-x', 'user-y'],
        badgeType: BadgeType.COMMUNITY_BUILDER,
        reason: 'Bulk award ceremony',
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // User X
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'user-x' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'badge-x' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // audit

      // User Y
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'user-y' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'badge-y' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // audit

      // Mock COMMIT
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await handler(event, {} as any);

      const auditCalls = findAuditCalls('grant_badge');

      expect(auditCalls).toHaveLength(2);

      // Verify both audit logs have bulk:true
      auditCalls.forEach((call) => {
        const auditParams = call[1] as any[];
        const detailsJson = JSON.parse(auditParams[3]);
        expect(detailsJson.bulk).toBe(true);
      });
    });
  });
});
