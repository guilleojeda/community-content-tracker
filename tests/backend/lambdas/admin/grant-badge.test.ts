import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/admin/grant-badge';
import { getDatabasePool } from '../../../../src/backend/services/database';
import { BadgeType } from '@aws-community-hub/shared';

// Mock database
jest.mock('../../../../src/backend/services/database');

describe('Grant Badge Lambda', () => {
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
    path: '/admin/badges/grant',
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
      path: '/admin/badges/grant',
      stage: 'test',
      requestId: 'request-id',
      requestTimeEpoch: 0,
      resourceId: 'resource-id',
      resourcePath: '/admin/badges/grant',
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
        userId: 'admin-user-123',
        claims: {
          sub: 'admin-user-123',
          'cognito:groups': isAdmin ? 'Admin' : 'User',
        },
      },
    },
    resource: '/admin/badges/grant',
  } as any);

  const findAuditCall = (actionType: string) =>
    mockClient.query.mock.calls.find(
      ([, params]) => Array.isArray(params) && params[1] === actionType
    );

  describe('Authentication and Authorization', () => {
    it('should return 403 when user is not admin', async () => {
      const event = createMockEvent(false, {
        userId: 'user-123',
        badgeType: BadgeType.COMMUNITY_BUILDER,
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
      expect(body.error.message).toContain('Request body is required');
    });

    it('should return 400 when body is invalid JSON', async () => {
      const event = createMockEvent(true, null);
      event.body = 'invalid-json{';

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Invalid JSON');
    });

    it('should return 400 when userId is missing', async () => {
      const event = createMockEvent(true, {
        badgeType: BadgeType.COMMUNITY_BUILDER,
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('userId is required');
    });

    it('should return 400 when badgeType is missing', async () => {
      const event = createMockEvent(true, {
        userId: 'user-123',
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('badgeType is required');
    });

    it('should return 400 when badgeType is invalid', async () => {
      const event = createMockEvent(true, {
        userId: 'user-123',
        badgeType: 'invalid_badge',
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Invalid badge type');
    });
  });

  describe('Successful Badge Grant', () => {
    it('should grant badge successfully to new user', async () => {
      const event = createMockEvent(true, {
        userId: 'user-123',
        badgeType: BadgeType.COMMUNITY_BUILDER,
        reason: 'Outstanding contributions',
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock user check - user exists
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'user-123' }],
      });

      // Mock badge check - no existing badge
      mockClient.query.mockResolvedValueOnce({
        rows: [],
      });

      // Mock badge insert
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'badge-123' }],
      });

      // Mock audit log insert
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock COMMIT
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.badgeId).toBe('badge-123');
      expect(body.data.userId).toBe('user-123');
      expect(body.data.badgeType).toBe(BadgeType.COMMUNITY_BUILDER);
      expect(body.data.operation).toBe('granted');

      const auditCall = findAuditCall('grant_badge');
      expect(auditCall).toBeDefined();
      const auditParams = auditCall![1] as any[];
      expect(auditParams[0]).toBe('admin-user-123');
      expect(auditParams[2]).toBe('user-123');
      const details = JSON.parse(auditParams[3]);
      expect(details).toMatchObject({
        badgeType: BadgeType.COMMUNITY_BUILDER,
        badgeId: 'badge-123',
        reason: 'Outstanding contributions',
        operation: 'granted',
      });

      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should reactivate inactive badge successfully', async () => {
      const event = createMockEvent(true, {
        userId: 'user-123',
        badgeType: BadgeType.HERO,
        reason: 'Re-earned after improvements',
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock user check
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'user-123' }],
      });

      // Mock badge check - inactive badge exists
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'badge-456', is_active: false }],
      });

      // Mock badge reactivate
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'badge-456' }],
      });

      // Mock audit log insert
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock COMMIT
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.badgeId).toBe('badge-456');
      expect(body.data.operation).toBe('reactivated');

      const auditCall = findAuditCall('grant_badge');
      expect(auditCall).toBeDefined();
      const auditParams = auditCall![1] as any[];
      const details = JSON.parse(auditParams[3]);
      expect(details).toMatchObject({
        badgeType: BadgeType.HERO,
        badgeId: 'badge-456',
        operation: 'reactivated',
      });

      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('Error Cases', () => {
    it('should return 404 when user does not exist', async () => {
      const event = createMockEvent(true, {
        userId: 'non-existent-user',
        badgeType: BadgeType.AMBASSADOR,
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock user check - user does not exist
      mockClient.query.mockResolvedValueOnce({
        rows: [],
      });

      // Mock ROLLBACK
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('User not found');

      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should return 409 when user already has active badge', async () => {
      const event = createMockEvent(true, {
        userId: 'user-123',
        badgeType: BadgeType.COMMUNITY_BUILDER,
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock user check
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'user-123' }],
      });

      // Mock badge check - active badge exists
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'badge-789', is_active: true }],
      });

      // Mock ROLLBACK
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('DUPLICATE_RESOURCE');
      expect(body.error.message).toContain('already has an active badge');

      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('Transaction Rollback', () => {
    it('should rollback transaction on database error', async () => {
      const event = createMockEvent(true, {
        userId: 'user-123',
        badgeType: BadgeType.COMMUNITY_BUILDER,
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock user check
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'user-123' }],
      });

      // Mock badge check
      mockClient.query.mockResolvedValueOnce({
        rows: [],
      });

      // Mock badge insert - database error
      mockClient.query.mockRejectedValueOnce(new Error('Database connection failed'));

      // Mock ROLLBACK
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');

      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle rollback error gracefully', async () => {
      const event = createMockEvent(true, {
        userId: 'user-123',
        badgeType: BadgeType.HERO,
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock error during transaction
      mockClient.query.mockRejectedValueOnce(new Error('Transaction error'));

      // Mock ROLLBACK also fails
      mockClient.query.mockRejectedValueOnce(new Error('Rollback failed'));

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('Audit Logging', () => {
    it('should insert audit log with correct details', async () => {
      const event = createMockEvent(true, {
        userId: 'user-123',
        badgeType: BadgeType.USER_GROUP_LEADER,
        reason: 'Active user group leadership',
      });

      // Mock successful badge grant
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'user-123' }] }); // user check
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // badge check
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'badge-999' }] }); // insert
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // audit log
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // COMMIT

      await handler(event, {} as any);

      const auditCall = findAuditCall('grant_badge');
      expect(auditCall).toBeDefined();
      const auditParams = auditCall![1] as any[];
      expect(auditParams[0]).toBe('admin-user-123');
      expect(auditParams[2]).toBe('user-123');
      const detailsJson = JSON.parse(auditParams[3]);
      expect(detailsJson).toMatchObject({
        badgeType: BadgeType.USER_GROUP_LEADER,
        badgeId: 'badge-999',
        reason: 'Active user group leadership',
        operation: 'granted',
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing reason field', async () => {
      const event = createMockEvent(true, {
        userId: 'user-123',
        badgeType: BadgeType.AMBASSADOR,
        // reason omitted
      });

      mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'user-123' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'badge-100' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // audit
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // COMMIT

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should handle cognito:groups as array', async () => {
      const event = createMockEvent(true, {
        userId: 'user-123',
        badgeType: BadgeType.HERO,
      });

      event.requestContext.authorizer!.claims = {
        sub: 'admin-user-123',
        'cognito:groups': ['Admin', 'PowerUser'],
      };

      mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'user-123' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'badge-101' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // audit
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // COMMIT

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(201);
    });
  });
});
