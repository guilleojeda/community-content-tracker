import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/users/update-preferences';

// Mock dependencies
jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn(),
}));

const mockPool = {
  query: jest.fn(),
};

const { getDatabasePool } = require('../../../../src/backend/services/database');

describe('Update Preferences Lambda', () => {
  const validUserId = 'user-123';
  const validAccessToken = 'valid-access-token';
  const mockUser = {
    email: 'testuser@example.com',
    username: 'testuser',
    profileSlug: 'testuser',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool.query.mockReset();
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
  });

  const createEvent = (
    body: any,
    userId?: string,
    authHeader?: string,
    authorizerUserId: string | null = validUserId
  ): Partial<APIGatewayProxyEvent> => ({
    pathParameters: userId ? { id: userId } : undefined,
    headers: authHeader ? { Authorization: authHeader } : {},
    body: JSON.stringify(body),
    requestContext: {
      authorizer: authorizerUserId ? { userId: authorizerUserId } : undefined,
    } as any,
  });

  describe('Validation', () => {
    it('should return 400 if user ID is missing', async () => {
      const event = createEvent(
        { receiveNewsletter: true },
        undefined,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 401 if authorization context is missing', async () => {
      const event = createEvent({ receiveNewsletter: true }, validUserId, undefined, null);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_REQUIRED');
    });

    it('should return 400 if no preferences are provided', async () => {
      const event = createEvent({}, validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.preferences).toContain('At least one preference');
    });

    it('should return 400 if preference values are not booleans', async () => {
      const event = createEvent(
        { receiveNewsletter: 'yes' },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.receiveNewsletter).toContain('boolean');
    });

    it('should return 403 if user tries to update another user preferences', async () => {
      const event = createEvent(
        { receiveNewsletter: true },
        'other-user-id',
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('Success Cases', () => {
    it('should successfully update newsletter preference', async () => {
      // Mock the repository update query (UPDATE ... RETURNING *)
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: validUserId,
          cognito_sub: 'cognito-sub',
          email: mockUser.email,
          username: mockUser.username,
          profile_slug: mockUser.profileSlug,
          default_visibility: 'private',
          is_admin: false,
          is_aws_employee: false,
          bio: null,
          receive_newsletter: false,
          receive_content_notifications: null,
          receive_community_updates: null,
          mfa_enabled: null,
          created_at: new Date(),
          updated_at: new Date()
        }]
      });

      const event = createEvent(
        { receiveNewsletter: false },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Preferences updated successfully');

      // Verify database query was called
      expect(mockPool.query).toHaveBeenCalled();
      const updateCall = mockPool.query.mock.calls.find(call =>
        Array.isArray(call[1]) && call[1].includes(validUserId)
      );
      expect(updateCall).toBeDefined();
    });

    it('should successfully update content notifications preference', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: validUserId,
          cognito_sub: 'cognito-sub',
          email: mockUser.email,
          username: mockUser.username,
          profile_slug: mockUser.profileSlug,
          default_visibility: 'private',
          is_admin: false,
          is_aws_employee: false,
          bio: null,
          receive_newsletter: null,
          receive_content_notifications: true,
          receive_community_updates: null,
          mfa_enabled: null,
          created_at: new Date(),
          updated_at: new Date()
        }]
      });

      const event = createEvent(
        { receiveContentNotifications: true },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Preferences updated successfully');
    });

    it('should successfully update community updates preference', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: validUserId,
          cognito_sub: 'cognito-sub',
          email: mockUser.email,
          username: mockUser.username,
          profile_slug: mockUser.profileSlug,
          default_visibility: 'private',
          is_admin: false,
          is_aws_employee: false,
          bio: null,
          receive_newsletter: null,
          receive_content_notifications: null,
          receive_community_updates: false,
          mfa_enabled: null,
          created_at: new Date(),
          updated_at: new Date()
        }]
      });

      const event = createEvent(
        { receiveCommunityUpdates: false },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Preferences updated successfully');
    });

    it('should successfully update multiple preferences at once', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: validUserId,
          cognito_sub: 'cognito-sub',
          email: mockUser.email,
          username: mockUser.username,
          profile_slug: mockUser.profileSlug,
          default_visibility: 'private',
          is_admin: false,
          is_aws_employee: false,
          bio: null,
          receive_newsletter: true,
          receive_content_notifications: false,
          receive_community_updates: true,
          mfa_enabled: null,
          created_at: new Date(),
          updated_at: new Date()
        }]
      });

      const event = createEvent(
        {
          receiveNewsletter: true,
          receiveContentNotifications: false,
          receiveCommunityUpdates: true,
        },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Preferences updated successfully');

      // Verify database query was called
      expect(mockPool.query).toHaveBeenCalled();
      const updateCall = mockPool.query.mock.calls.find(call =>
        Array.isArray(call[1]) && call[1].includes(validUserId)
      );
      expect(updateCall).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should return 500 for database errors', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      const event = createEvent(
        { receiveNewsletter: true },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
