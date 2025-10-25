import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/users/export-data';
import { Visibility } from '@aws-community-hub/shared';

// Mock dependencies
jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn(),
}));
jest.mock('../../../../src/backend/lambdas/auth/tokenVerifier');
jest.mock('../../../../src/backend/services/AuditLogService', () => {
  const mockLog = jest.fn();
  return {
    AuditLogService: jest.fn(() => ({
      log: mockLog,
    })),
    __mockLog: mockLog,
  };
});

const mockPool = {
  query: jest.fn(),
};

const { verifyJwtToken } = require('../../../../src/backend/lambdas/auth/tokenVerifier');
const { getDatabasePool } = require('../../../../src/backend/services/database');
const { AuditLogService, __mockLog: mockAuditLog } = require('../../../../src/backend/services/AuditLogService');

describe('Export Data Lambda', () => {
  const validUserId = 'user-123';
  const validAccessToken = 'valid-access-token';

  const mockUser = {
    id: validUserId,
    cognitoSub: 'cognito-123',
    email: 'test@example.com',
    username: 'testuser',
    profileSlug: 'testuser',
    defaultVisibility: Visibility.PUBLIC,
    isAdmin: false,
    isAwsEmployee: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const mockExportData = {
    user: {
      ...mockUser,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      receiveNewsletter: true,
      receiveContentNotifications: true,
      receiveCommunityUpdates: false,
    },
    content: [
      {
        id: 'content-1',
        user_id: validUserId,
        title: 'Test Content',
        description: 'Sample export',
        content_type: 'blog',
        visibility: 'public',
        publish_date: '2024-01-10T00:00:00.000Z',
        capture_date: '2024-01-09T00:00:00.000Z',
        metrics: { views: 100 },
        tags: ['aws', 'gdpr'],
        embedding: null,
        is_claimed: true,
        original_author: null,
        urls: [
          { id: 'url-1', url: 'https://example.com/test' },
        ],
        created_at: '2024-01-09T00:00:00.000Z',
        updated_at: '2024-01-10T00:00:00.000Z',
        deleted_at: null,
      },
    ],
    badges: [
      {
        id: 'badge-1',
        user_id: validUserId,
        badge_type: 'community_builder',
        awarded_at: new Date('2024-01-15T00:00:00.000Z'),
        created_at: new Date('2024-01-15T00:00:00.000Z'),
        updated_at: new Date('2024-01-15T00:00:00.000Z'),
      },
    ],
    channels: [
      {
        id: 'channel-1',
        user_id: validUserId,
        channel_type: 'blog',
        url: 'https://channel.example.com',
        name: 'Example Channel',
        enabled: true,
        last_sync_at: '2024-01-08T00:00:00.000Z',
        last_sync_status: 'success',
        last_sync_error: null,
        sync_frequency: 'daily',
        metadata: { topic: 'aws' },
        created_at: '2024-01-05T00:00:00.000Z',
        updated_at: '2024-01-08T00:00:00.000Z',
      },
    ],
    bookmarks: [
      {
        id: 'bookmark-1',
        user_id: validUserId,
        content_id: 'content-1',
        created_at: '2024-01-11T00:00:00.000Z',
      },
    ],
    follows: {
      following: [
        {
          follower_id: validUserId,
          following_id: 'user-456',
          created_at: '2024-01-03T00:00:00.000Z',
        },
      ],
      followers: [
        {
          follower_id: 'user-789',
          following_id: validUserId,
          created_at: '2024-01-04T00:00:00.000Z',
        },
      ],
    },
    consents: [
      {
        id: 'consent-1',
        consent_type: 'analytics',
        consent_version: '1.0',
        granted: true,
        granted_at: '2024-01-01T00:00:00.000Z',
        revoked_at: null,
        ip_address: '127.0.0.1',
        user_agent: 'jest',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      },
    ],
    export_date: '2024-01-12T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool.query.mockReset();
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
    verifyJwtToken.mockResolvedValue({
      isValid: true,
      user: {
        ...mockUser,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      },
    });
    (AuditLogService as jest.Mock).mockClear();
    (AuditLogService as jest.Mock).mockImplementation(() => ({
      log: mockAuditLog,
    }));
    mockAuditLog.mockClear();
    mockAuditLog.mockResolvedValue('audit-log-entry');
  });

  const createEvent = (userId?: string, authHeader?: string): Partial<APIGatewayProxyEvent> => ({
    pathParameters: userId ? { id: userId } : undefined,
    headers: authHeader ? { Authorization: authHeader } : {},
  });

  describe('Validation', () => {
    it('should return 400 if user ID is missing', async () => {
      const event = createEvent(undefined, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('User ID is required');
    });

    it('should return 401 if authorization token is missing', async () => {
      const event = createEvent(validUserId);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_REQUIRED');
    });

    it('should return 403 if user tries to export another user data', async () => {
      const event = createEvent('other-user-id', `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
    });

    it('should allow admin to export any user data', async () => {
      verifyJwtToken.mockResolvedValueOnce({
        isValid: true,
        user: { ...mockUser, isAdmin: true },
      });

      mockPool.query.mockResolvedValue({
        rows: [{ data: mockExportData }],
      });

      const event = createEvent('other-user-id', `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.user).toBeDefined();
    });
  });

  describe('Success Cases', () => {
    it('should successfully export user data', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ data: mockExportData }],
      });

      const event = createEvent(validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);

      // Verify headers for file download
      expect(result.headers).toEqual(
        expect.objectContaining({
          'Content-Type': 'application/json',
          'Content-Disposition': expect.stringContaining('attachment'),
        })
      );

      const body = JSON.parse(result.body);
      expect(body.user).toEqual(expect.objectContaining({
        id: validUserId,
        email: 'test@example.com',
        receiveNewsletter: true,
      }));
      expect(body.content).toHaveLength(1);
      expect(body.content[0]).toEqual(expect.objectContaining({
        id: 'content-1',
        title: 'Test Content',
        urls: [
          { id: 'url-1', url: 'https://example.com/test' },
        ],
      }));
      expect(body.channels).toEqual([
        expect.objectContaining({
          id: 'channel-1',
          url: 'https://channel.example.com',
        }),
      ]);
      expect(body.badges[0]).toEqual(expect.objectContaining({
        id: 'badge-1',
        badgeType: 'community_builder',
        awardedAt: '2024-01-15T00:00:00.000Z',
      }));
      expect(body.bookmarks[0]).toEqual(expect.objectContaining({
        contentId: 'content-1',
      }));
      expect(body.consents[0]).toEqual(expect.objectContaining({
        consentType: 'analytics',
        granted: true,
      }));
      expect(body.follows.following[0]).toEqual(expect.objectContaining({
        followerId: validUserId,
        followingId: 'user-456',
      }));
      expect(body.exportDate).toMatch(/T/);
      expect(AuditLogService).toHaveBeenCalled();
      expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'user.data.export',
        resourceType: 'user',
        resourceId: validUserId,
        userId: validUserId,
      }));

      // Verify database query was called
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('export_user_data'),
        [validUserId]
      );
    });

    it('should export authenticated user data when path parameter is "me"', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ data: mockExportData }],
      });

      const event = createEvent('me', `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('export_user_data'),
        [validUserId]
      );
      expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'user.data.export',
        resourceId: validUserId,
        userId: validUserId,
      }));
    });

    it('should return empty arrays for user with no content or badges', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            data: {
              user: mockUser,
              content: [],
              badges: [],
            },
          },
        ],
      });

      const event = createEvent(validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.content).toEqual([]);
      expect(body.badges).toEqual([]);
      expect(body.channels).toEqual([]);
      expect(body.bookmarks).toEqual([]);
      expect(body.consents).toEqual([]);
      expect(body.follows).toEqual({ following: [], followers: [] });
    });

    it('should include proper filename in Content-Disposition header', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ data: mockExportData }],
      });

      const event = createEvent(validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      expect(result.headers!['Content-Disposition']).toMatch(/user-data-user-123-\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 if user not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const event = createEvent(validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 401 for invalid token', async () => {
      verifyJwtToken.mockResolvedValueOnce({
        isValid: false,
        error: { code: 'AUTH_INVALID' },
      });

      const event = createEvent(validUserId, `Bearer invalid-token`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_INVALID');
    });

    it('should return 500 for database errors', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      const event = createEvent(validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
