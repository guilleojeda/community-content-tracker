import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/users/export-data';
import { Visibility } from '@aws-community-hub/shared';

// Mock dependencies
jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn(),
}));
jest.mock('../../../../src/backend/lambdas/auth/tokenVerifier');

const mockPool = {
  query: jest.fn(),
};

const { verifyJwtToken } = require('../../../../src/backend/lambdas/auth/tokenVerifier');
const { getDatabasePool } = require('../../../../src/backend/services/database');

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
    },
    content: [
      {
        id: 'content-1',
        title: 'Test Content',
        userId: validUserId,
        contentType: 'blog',
        visibility: 'public',
      },
    ],
    badges: [
      {
        id: 'badge-1',
        userId: validUserId,
        badgeType: 'community_builder',
        awardedAt: new Date('2024-01-15'),
      },
    ],
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

      mockPool.query.mockResolvedValueOnce({
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
      mockPool.query.mockResolvedValueOnce({
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
      expect(body.user).toEqual(mockUser);
      expect(body.content).toEqual(mockExportData.content);
      expect(body.badges).toEqual([{
        id: 'badge-1',
        userId: validUserId,
        badgeType: 'community_builder',
        awardedAt: '2024-01-15T00:00:00.000Z',
      }]);

      // Verify database query was called
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('export_user_data'),
        [validUserId]
      );
    });

    it('should return empty arrays for user with no content or badges', async () => {
      mockPool.query.mockResolvedValueOnce({
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
    });

    it('should include proper filename in Content-Disposition header', async () => {
      mockPool.query.mockResolvedValueOnce({
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
