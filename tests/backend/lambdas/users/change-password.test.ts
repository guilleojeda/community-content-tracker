import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/users/change-password';
import { ChangePasswordCommand } from '@aws-sdk/client-cognito-identity-provider';

jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
  const actual = jest.requireActual('@aws-sdk/client-cognito-identity-provider');
  const sendMock = jest.fn();
  return {
    ...actual,
    CognitoIdentityProviderClient: jest.fn(() => ({ send: sendMock })),
    __cognitoSendMock: sendMock,
  };
});

const cognitoSendMock = (jest.requireMock('@aws-sdk/client-cognito-identity-provider') as {
  __cognitoSendMock: jest.Mock;
}).__cognitoSendMock;
const { CognitoIdentityProviderClient } = jest.requireMock('@aws-sdk/client-cognito-identity-provider') as {
  CognitoIdentityProviderClient: jest.Mock;
};

describe('Change Password Lambda', () => {
  const validUserId = 'user-123';
  const validAccessToken = 'valid-access-token';

  beforeEach(() => {
    CognitoIdentityProviderClient.mockImplementation(() => ({ send: cognitoSendMock }));
    cognitoSendMock.mockReset();
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
        { currentPassword: 'OldPass123!', newPassword: 'NewPass123!' },
        undefined,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('User ID is required');
    });

    it('should return 401 if authorization token is missing', async () => {
      const event = createEvent(
        { currentPassword: 'OldPass123!', newPassword: 'NewPass123!' },
        validUserId
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_REQUIRED');
    });

    it('should return 400 if current password is missing', async () => {
      const event = createEvent(
        { newPassword: 'NewPass123!' },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.currentPassword).toBeDefined();
    });

    it('should return 400 if new password is missing', async () => {
      const event = createEvent(
        { currentPassword: 'OldPass123!' },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.newPassword).toBeDefined();
    });

    it('should return 400 if new password is too short', async () => {
      const event = createEvent(
        { currentPassword: 'OldPass123!', newPassword: 'Short1!' },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.newPassword).toContain('at least 12 characters');
    });

    it('should return 400 if new password lacks complexity', async () => {
      const event = createEvent(
        { currentPassword: 'OldPass123!', newPassword: 'simplepwdonly' },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.newPassword).toContain('uppercase, lowercase, number, and special character');
    });

    it('should return 400 if new password is same as current password', async () => {
      const event = createEvent(
        { currentPassword: 'SamePass123!', newPassword: 'SamePass123!' },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.newPassword).toContain('different from current password');
    });
  });

  describe('Success Cases', () => {
    it('should successfully change password with valid inputs', async () => {
      cognitoSendMock.mockResolvedValueOnce({});

      const event = createEvent(
        { currentPassword: 'OldPass123!', newPassword: 'NewPassword456!' },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Password changed successfully');

      // Verify Cognito was called correctly
      const cognitoCommands = cognitoSendMock.mock.calls
        .map(call => call[0])
        .filter(command => command instanceof ChangePasswordCommand);
      expect(cognitoCommands.length).toBe(1);
      expect(cognitoCommands[0].input).toEqual({
        PreviousPassword: 'OldPass123!',
        ProposedPassword: 'NewPassword456!',
        AccessToken: validAccessToken,
      });
    });
  });

  describe('Error Handling', () => {
    it('should return 401 for NotAuthorizedException', async () => {
      cognitoSendMock.mockRejectedValueOnce({
        name: 'NotAuthorizedException',
        message: 'Invalid credentials',
      });

      const event = createEvent(
        { currentPassword: 'WrongPass123!', newPassword: 'NewPassword456!' },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_INVALID');
    });

    it('should return 400 for InvalidPasswordException', async () => {
      cognitoSendMock.mockRejectedValueOnce({
        name: 'InvalidPasswordException',
        message: 'Password does not meet requirements',
      });

      const event = createEvent(
        { currentPassword: 'OldPass123!', newPassword: 'WeakPassword1!' },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 500 for unexpected errors', async () => {
      cognitoSendMock.mockRejectedValueOnce(new Error('Unexpected error'));

      const event = createEvent(
        { currentPassword: 'OldPass123!', newPassword: 'NewPassword456!' },
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
