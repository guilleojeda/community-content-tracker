import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/admin/revoke-badge';
import { getDatabasePool } from '../../../../src/backend/services/database';
import { BadgeType } from '@aws-community-hub/shared';

// Mock database
jest.mock('../../../../src/backend/services/database');

describe('Revoke Badge Lambda', () => {
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
    httpMethod: 'DELETE',
    path: '/admin/badges/revoke',
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
      httpMethod: 'DELETE',
      path: '/admin/badges/revoke',
      stage: 'test',
      requestId: 'request-id',
      requestTimeEpoch: 0,
      resourceId: 'resource-id',
      resourcePath: '/admin/badges/revoke',
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
        userId: 'admin-user-456',
        claims: {
          sub: 'admin-user-456',
          'cognito:groups': isAdmin ? 'Admin' : 'User',
        },
      },
    },
    resource: '/admin/badges/revoke',
  } as any);

  describe('Authentication and Authorization', () => {
    it('should return 403 when user is not admin', async () => {
      const event = createMockEvent(false, {
        userId: 'user-123',
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
      expect(body.error.message).toContain('Request body is required');
    });

    it('should return 400 when body is invalid JSON', async () => {
      const event = createMockEvent(true, null);
      event.body = 'not-valid-json}';

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when userId is missing', async () => {
      const event = createMockEvent(true, {
        badgeType: BadgeType.AMBASSADOR,
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
        badgeType: 'not_a_valid_badge',
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Invalid badge type');
    });
  });

  describe('Successful Badge Revoke', () => {
    it('should revoke badge successfully', async () => {
      const event = createMockEvent(true, {
        userId: 'user-789',
        badgeType: BadgeType.COMMUNITY_BUILDER,
        reason: 'Policy violation',
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock badge check - active badge exists
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'badge-555', is_active: true }],
      });

      // Mock badge revoke UPDATE
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock audit log insert
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock COMMIT
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.badgeId).toBe('badge-555');
      expect(body.data.userId).toBe('user-789');
      expect(body.data.badgeType).toBe(BadgeType.COMMUNITY_BUILDER);
      expect(body.data.reason).toBe('Policy violation');

      // Verify transaction
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

      // Verify UPDATE was called
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE user_badges'),
        expect.arrayContaining(['admin-user-456', 'Policy violation', 'badge-555'])
      );

      // Verify audit log
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admin_actions'),
        expect.arrayContaining([
          'admin-user-456',
          'revoke_badge',
          'user-789',
          expect.any(String),
        ])
      );

      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should revoke badge without reason', async () => {
      const event = createMockEvent(true, {
        userId: 'user-999',
        badgeType: BadgeType.HERO,
      });

      mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'badge-888', is_active: true }],
      });
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // UPDATE
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // audit
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // COMMIT

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.reason).toBeUndefined();
    });
  });

  describe('Error Cases', () => {
    it('should return 404 when badge not found for user', async () => {
      const event = createMockEvent(true, {
        userId: 'user-123',
        badgeType: BadgeType.AMBASSADOR,
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock badge check - no badge found
      mockClient.query.mockResolvedValueOnce({
        rows: [],
      });

      // Mock ROLLBACK
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('Badge not found');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should return 404 when badge is already revoked', async () => {
      const event = createMockEvent(true, {
        userId: 'user-456',
        badgeType: BadgeType.USER_GROUP_LEADER,
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock badge check - badge exists but is inactive
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'badge-222', is_active: false }],
      });

      // Mock ROLLBACK
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('already revoked');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('Transaction Rollback', () => {
    it('should rollback transaction on database error', async () => {
      const event = createMockEvent(true, {
        userId: 'user-333',
        badgeType: BadgeType.HERO,
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Mock badge check
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'badge-111', is_active: true }],
      });

      // Mock UPDATE - database error
      mockClient.query.mockRejectedValueOnce(new Error('Connection lost'));

      // Mock ROLLBACK
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle rollback failure gracefully', async () => {
      const event = createMockEvent(true, {
        userId: 'user-444',
        badgeType: BadgeType.AMBASSADOR,
      });

      // Mock BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      // Error during transaction
      mockClient.query.mockRejectedValueOnce(new Error('Query error'));

      // ROLLBACK also fails
      mockClient.query.mockRejectedValueOnce(new Error('Rollback error'));

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(500);
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('Audit Logging', () => {
    it('should insert audit log with correct details', async () => {
      const event = createMockEvent(true, {
        userId: 'user-555',
        badgeType: BadgeType.COMMUNITY_BUILDER,
        reason: 'Terms of service violation',
      });

      mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'badge-777', is_active: true }],
      });
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // UPDATE
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // audit
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // COMMIT

      await handler(event, {} as any);

      const auditLogCall = mockClient.query.mock.calls.find(
        (call) => call[0]?.includes('INSERT INTO admin_actions')
      );

      expect(auditLogCall).toBeDefined();
      expect(auditLogCall![1]).toEqual([
        'admin-user-456',
        'revoke_badge',
        'user-555',
        expect.stringContaining('community_builder'),
      ]);

      const detailsJson = JSON.parse(auditLogCall![1][3]);
      expect(detailsJson).toMatchObject({
        badgeType: BadgeType.COMMUNITY_BUILDER,
        badgeId: 'badge-777',
        reason: 'Terms of service violation',
      });
    });
  });
});
