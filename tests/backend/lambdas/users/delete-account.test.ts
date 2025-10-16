import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/users/delete-account';
import { CognitoIdentityProviderClient, DeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';
import { Visibility } from '@aws-community-hub/shared';

// Mock dependencies
jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn(),
}));
jest.mock('../../../../src/backend/lambdas/auth/tokenVerifier');

const cognitoMock = mockClient(CognitoIdentityProviderClient);

const mockPool = {
  query: jest.fn(),
};

const { verifyJwtToken } = require('../../../../src/backend/lambdas/auth/tokenVerifier');
const { getDatabasePool } = require('../../../../src/backend/services/database');

describe('Delete Account Lambda', () => {
  const validUserId = '550e8400-e29b-41d4-a716-446655440000';
  const otherUserId = '660e8400-e29b-41d4-a716-446655440001';
  const validAccessToken = 'valid-access-token';

  const mockUser = {
    id: validUserId,
    cognitoSub: 'cognito-123',
    email: 'test@example.com',
    username: 'testuser',
    profileSlug: 'testuser',
    isAdmin: false,
    isAwsEmployee: false,
    defaultVisibility: Visibility.PUBLIC,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    cognitoMock.reset();
    mockPool.query.mockReset();
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
    verifyJwtToken.mockResolvedValue({
      isValid: true,
      user: mockUser,
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

    it('should return 403 if user tries to delete another user account', async () => {
      const event = createEvent(otherUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
      expect(body.error.message).toContain('only delete your own account');
    });

    it('should allow admin to delete any user account', async () => {
      verifyJwtToken.mockResolvedValueOnce({
        isValid: true,
        user: { ...mockUser, isAdmin: true },
      });

      // Mock finding user
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: otherUserId, cognito_sub: 'cognito-other', email: 'other@example.com', username: 'otheruser', profile_slug: 'otheruser', default_visibility: mockUser.defaultVisibility, is_admin: false, is_aws_employee: false, created_at: new Date(), updated_at: new Date() }],
      });

      cognitoMock.on(DeleteUserCommand).resolves({});

      // Mock delete_user_data function
      mockPool.query.mockResolvedValueOnce({ rows: [{ deleted: true }] });

      const event = createEvent(otherUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
    });

    it('should return 404 if user does not exist', async () => {
      // Mock user not found
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const event = createEvent(validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Success Cases', () => {
    it('should successfully delete account from both Cognito and database', async () => {
      // Mock finding user
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: validUserId,
            cognito_sub: mockUser.cognitoSub || 'cognito-123',
            email: mockUser.email,
            username: mockUser.username,
            profile_slug: mockUser.profileSlug,
            default_visibility: mockUser.defaultVisibility,
            is_admin: mockUser.isAdmin,
            is_aws_employee: mockUser.isAwsEmployee,
            created_at: mockUser.createdAt,
            updated_at: mockUser.updatedAt,
          },
        ],
      });

      // Mock Cognito deletion
      cognitoMock.on(DeleteUserCommand).resolves({});

      // Mock database deletion (delete_user_data function)
      mockPool.query.mockResolvedValueOnce({ rows: [{ deleted: true }] });

      const event = createEvent(validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Account deleted successfully');

      // Verify Cognito was called
      const cognitoCalls = cognitoMock.commandCalls(DeleteUserCommand);
      expect(cognitoCalls.length).toBe(1);
      expect(cognitoCalls[0].args[0].input.AccessToken).toBe(validAccessToken);

      // Verify database deletion was called
      const deleteCalls = mockPool.query.mock.calls.filter((call) =>
        call[0].includes('delete_user_data')
      );
      expect(deleteCalls.length).toBe(1);
      expect(deleteCalls[0][1]).toContain(validUserId);
    });

    it('should continue with database deletion even if Cognito deletion fails', async () => {
      // Mock finding user
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: validUserId,
            cognito_sub: mockUser.cognitoSub || 'cognito-123',
            email: mockUser.email,
            username: mockUser.username,
            profile_slug: mockUser.profileSlug,
            default_visibility: mockUser.defaultVisibility,
            is_admin: mockUser.isAdmin,
            is_aws_employee: mockUser.isAwsEmployee,
            created_at: mockUser.createdAt,
            updated_at: mockUser.updatedAt,
          },
        ],
      });

      // Mock Cognito deletion failure
      cognitoMock.on(DeleteUserCommand).rejects(new Error('Cognito error'));

      // Mock database deletion still succeeds
      mockPool.query.mockResolvedValueOnce({ rows: [{ deleted: true }] });

      const event = createEvent(validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Account deleted successfully');

      // Verify database deletion was still called
      const deleteCalls = mockPool.query.mock.calls.filter((call) =>
        call[0].includes('delete_user_data')
      );
      expect(deleteCalls.length).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should return 500 if database deletion fails', async () => {
      // Mock finding user
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: validUserId,
            cognito_sub: mockUser.cognitoSub || 'cognito-123',
            email: mockUser.email,
            username: mockUser.username,
            profile_slug: mockUser.profileSlug,
            default_visibility: mockUser.defaultVisibility,
            is_admin: mockUser.isAdmin,
            is_aws_employee: mockUser.isAwsEmployee,
            created_at: mockUser.createdAt,
            updated_at: mockUser.updatedAt,
          },
        ],
      });

      // Mock Cognito deletion succeeds
      cognitoMock.on(DeleteUserCommand).resolves({});

      // Mock database deletion fails
      mockPool.query.mockResolvedValueOnce({ rows: [{ deleted: false }] });

      const event = createEvent(validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toContain('Failed to delete user data');
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

    it('should return 500 for unexpected errors', async () => {
      // Mock finding user
      mockPool.query.mockRejectedValueOnce(new Error('Unexpected database error'));

      const event = createEvent(validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('Audit Logging', () => {
    it('should log deletion details for audit trail', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      // Mock finding user
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: validUserId,
            cognito_sub: mockUser.cognitoSub || 'cognito-123',
            email: mockUser.email,
            username: mockUser.username,
            profile_slug: mockUser.profileSlug,
            default_visibility: mockUser.defaultVisibility,
            is_admin: mockUser.isAdmin,
            is_aws_employee: mockUser.isAwsEmployee,
            created_at: mockUser.createdAt,
            updated_at: mockUser.updatedAt,
          },
        ],
      });

      cognitoMock.on(DeleteUserCommand).resolves({});
      mockPool.query.mockResolvedValueOnce({ rows: [{ deleted: true }] });

      const event = createEvent(validUserId, `Bearer ${validAccessToken}`);

      await handler(event as APIGatewayProxyEvent);

      // Verify audit log was written
      expect(consoleSpy).toHaveBeenCalledWith(
        'Deleting account for user:',
        expect.objectContaining({
          userId: validUserId,
          email: mockUser.email,
          username: mockUser.username,
          deletedBy: validUserId,
        })
      );

      consoleSpy.mockRestore();
    });
  });
});
