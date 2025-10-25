import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/users/update-profile';
import { Visibility } from '@aws-community-hub/shared';
import { CognitoIdentityProviderClient, UpdateUserAttributesCommand } from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';

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
const cognitoMock = mockClient(CognitoIdentityProviderClient);
const originalCognitoRegion = process.env.COGNITO_REGION;

describe('Update Profile Lambda', () => {
  const validUserId = '550e8400-e29b-41d4-a716-446655440000';
  const otherUserId = '660e8400-e29b-41d4-a716-446655440001';
  const validAccessToken = 'valid-access-token';

  const mockUser = {
    id: validUserId,
    email: 'test@example.com',
    username: 'testuser',
    profileSlug: 'testuser',
    defaultVisibility: Visibility.PUBLIC,
    isAdmin: false,
    isAwsEmployee: false,
    bio: 'Current bio',
    socialLinks: {
      twitter: 'https://twitter.com/testuser',
      github: 'https://github.com/testuser',
    },
    receiveNewsletter: true,
    receiveContentNotifications: true,
    receiveCommunityUpdates: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const buildUserRow = (overrides: Record<string, any> = {}) => ({
    id: mockUser.id,
    cognito_sub: 'cognito-123',
    email: mockUser.email,
    username: mockUser.username,
    profile_slug: mockUser.profileSlug,
    bio: mockUser.bio,
    default_visibility: mockUser.defaultVisibility,
    is_admin: mockUser.isAdmin,
    is_aws_employee: mockUser.isAwsEmployee,
    receive_newsletter: mockUser.receiveNewsletter,
    receive_content_notifications: mockUser.receiveContentNotifications,
    receive_community_updates: mockUser.receiveCommunityUpdates,
    social_links: mockUser.socialLinks,
    created_at: mockUser.createdAt,
    updated_at: mockUser.updatedAt,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool.query.mockReset();
    cognitoMock.reset();
    // Configure default mock to return proper PostgreSQL structure
    mockPool.query.mockImplementation(() =>
      Promise.resolve({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: []
      })
    );
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
    verifyJwtToken.mockResolvedValue({
      isValid: true,
      user: mockUser,
    });
    cognitoMock.on(UpdateUserAttributesCommand).resolves({});
    process.env.COGNITO_REGION = 'us-east-1';
  });

  const createEvent = (body: any, userId?: string, authHeader?: string): Partial<APIGatewayProxyEvent> => ({
    pathParameters: userId ? { id: userId } : undefined,
    headers: authHeader ? { Authorization: authHeader } : {},
    body: JSON.stringify(body),
  });

  describe('Validation', () => {
    it('should return 400 if user ID is missing', async () => {
      const event = createEvent({ username: 'newuser' }, undefined, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 401 if authorization token is missing', async () => {
      const event = createEvent({ username: 'newuser' }, validUserId);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_REQUIRED');
    });

    it('should return 400 if no fields are provided', async () => {
      const event = createEvent({}, validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.profile).toContain('At least one field');
    });

    it('should return 400 if username is too short', async () => {
      const event = createEvent({ username: 'ab' }, validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.username).toContain('between 3 and 30 characters');
    });

    it('should return 400 if username is too long', async () => {
      const event = createEvent(
        { username: 'a'.repeat(31) },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.username).toContain('between 3 and 30 characters');
    });

    it('should reject script tags in profile fields', async () => {
      const event = createEvent(
        { bio: '<script>alert("xss")</script>' },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.details.fields.bio).toContain('script');
    });

    it('should return 400 if username contains invalid characters', async () => {
      const event = createEvent(
        { username: 'user@name' },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.username).toContain('letters, numbers, and underscores');
    });

    it('should return 400 if bio is too long', async () => {
      const event = createEvent(
        { bio: 'a'.repeat(501) },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.bio).toContain('cannot exceed 500 characters');
    });

    it('should return 400 if email is invalid', async () => {
      const event = createEvent(
        { email: 'invalid-email' },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.email).toContain('valid email');
      expect(cognitoMock).not.toHaveReceivedCommand(UpdateUserAttributesCommand);
    });

    it('should return 400 if visibility is invalid', async () => {
      const event = createEvent(
        { defaultVisibility: 'invalid_visibility' as any },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.defaultVisibility).toContain('must be one of');
    });

    it('should return 403 if user tries to update another user profile', async () => {
      const event = createEvent(
        { username: 'newuser' },
        otherUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('Success Cases', () => {
    it('should successfully update username', async () => {
      const updatedUser = { ...mockUser, username: 'newusername', profileSlug: 'newusername' };

      // Mock validation queries (no duplicates) - username and profileSlug
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }); // username check
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }); // profileSlug check
      // Mock update query
      mockPool.query.mockResolvedValueOnce({
        rows: [
          buildUserRow({
            username: updatedUser.username,
            profile_slug: updatedUser.profileSlug,
            bio: updatedUser.bio,
            default_visibility: updatedUser.defaultVisibility,
            updated_at: updatedUser.updatedAt,
          }),
        ],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: []
      });

      const event = createEvent({ username: 'newusername' }, validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Profile updated successfully');
      expect(body.user.email).toBe(mockUser.email);
      expect(body.user.username).toBe('newusername');
      expect(body.user.profileSlug).toBe('newusername');
      expect(cognitoMock).not.toHaveReceivedCommand(UpdateUserAttributesCommand);
    });

    it('should successfully update bio', async () => {
      const updatedUser = { ...mockUser, bio: 'New bio description' };

      mockPool.query.mockResolvedValueOnce({
        rows: [
          buildUserRow({
            bio: updatedUser.bio,
            updated_at: updatedUser.updatedAt,
          }),
        ],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: []
      });

      const event = createEvent({ bio: 'New bio description' }, validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Profile updated successfully');
      expect(body.user.email).toBe(mockUser.email);
      expect(body.user.bio).toBe('New bio description');
      expect(cognitoMock).not.toHaveReceivedCommand(UpdateUserAttributesCommand);
    });

    it('should successfully update default visibility', async () => {
      const updatedUser = { ...mockUser, defaultVisibility: Visibility.PRIVATE };

      mockPool.query.mockResolvedValueOnce({
        rows: [
          buildUserRow({
            default_visibility: updatedUser.defaultVisibility,
            updated_at: updatedUser.updatedAt,
          }),
        ],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: []
      });

      const event = createEvent(
        { defaultVisibility: Visibility.PRIVATE },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Profile updated successfully');
      expect(body.user.email).toBe(mockUser.email);
      expect(body.user.defaultVisibility).toBe(Visibility.PRIVATE);
      expect(cognitoMock).not.toHaveReceivedCommand(UpdateUserAttributesCommand);
    });

    it('should update email and trigger Cognito update', async () => {
      const newEmail = 'updated@example.com';
      const updatedUser = { ...mockUser, email: newEmail };

      mockPool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }) // email uniqueness
        .mockResolvedValueOnce({
          rows: [
            buildUserRow({
              email: updatedUser.email,
              updated_at: updatedUser.updatedAt,
            }),
          ],
          rowCount: 1,
          command: 'UPDATE',
          oid: 0,
          fields: [],
        });

      const event = createEvent({ email: newEmail }, validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.user.email).toBe(newEmail);
      expect(cognitoMock).toHaveReceivedCommandWith(UpdateUserAttributesCommand, {
        AccessToken: validAccessToken,
        UserAttributes: [
          { Name: 'email', Value: newEmail },
        ],
      });
    });

    it('should successfully update multiple fields at once', async () => {
      const updatedUser = {
        ...mockUser,
        username: 'newuser',
        profileSlug: 'newuser',
        bio: 'New bio',
        defaultVisibility: Visibility.AWS_ONLY,
      };

      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }); // username validation
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }); // profileSlug validation
      mockPool.query.mockResolvedValueOnce({
        rows: [
          buildUserRow({
            username: updatedUser.username,
            profile_slug: updatedUser.profileSlug,
            bio: updatedUser.bio,
            default_visibility: updatedUser.defaultVisibility,
            updated_at: updatedUser.updatedAt,
          }),
        ],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: []
      });

      const event = createEvent(
        {
          username: 'newuser',
          bio: 'New bio',
          defaultVisibility: Visibility.AWS_ONLY,
        },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.user.username).toBe('newuser');
      expect(body.user.bio).toBe('New bio');
      expect(body.user.defaultVisibility).toBe(Visibility.AWS_ONLY);
      expect(cognitoMock).not.toHaveReceivedCommand(UpdateUserAttributesCommand);
    });

    it('should allow clearing bio by setting it to empty string', async () => {
      const updatedUser = { ...mockUser, bio: '' };

      mockPool.query.mockResolvedValueOnce({
        rows: [
          buildUserRow({
            bio: '',
            updated_at: updatedUser.updatedAt,
          }),
        ],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: []
      });

      const event = createEvent({ bio: '' }, validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.user.bio).toBe('');
      expect(cognitoMock).not.toHaveReceivedCommand(UpdateUserAttributesCommand);
    });

    it('should update social links when provided', async () => {
      const updatedLinks = {
        twitter: 'https://twitter.com/newuser',
        linkedin: 'https://linkedin.com/in/newuser',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [
          buildUserRow({
            social_links: updatedLinks,
            updated_at: mockUser.updatedAt,
          }),
        ],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      const event = createEvent(
        { socialLinks: updatedLinks },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.user.socialLinks).toEqual(updatedLinks);
      expect(cognitoMock).not.toHaveReceivedCommand(UpdateUserAttributesCommand);
    });
  });

  describe('Error Handling', () => {
    it('should return 500 when Cognito email update fails', async () => {
      const newEmail = 'failure@example.com';
      cognitoMock.on(UpdateUserAttributesCommand).rejects(new Error('cognito failure'));

      mockPool.query.mockReset();

      const event = createEvent({ email: newEmail }, validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should return 409 if username already exists', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'other-user' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: []
      }); // validation fails

      const event = createEvent({ username: 'existinguser' }, validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(409);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('DUPLICATE_RESOURCE');
    });

    it('should return 404 if user not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }); // validation
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'UPDATE', oid: 0, fields: [] }); // update returns empty

      const event = createEvent({ username: 'newuser' }, validUserId, `Bearer ${validAccessToken}`);

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

      const event = createEvent({ username: 'newuser' }, validUserId, `Bearer invalid-token`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_INVALID');
    });

    it('should return 500 for database errors', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      const event = createEvent({ username: 'newuser' }, validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
  afterEach(() => {
    if (originalCognitoRegion === undefined) {
      delete process.env.COGNITO_REGION;
    } else {
      process.env.COGNITO_REGION = originalCognitoRegion;
    }
  });
