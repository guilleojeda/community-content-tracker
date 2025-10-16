// Mock QRCode before imports
jest.mock('qrcode', () => ({
  __esModule: true,
  default: {
    toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,mockQRCode'),
  },
}));

import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/users/setup-mfa';
import {
  CognitoIdentityProviderClient,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  SetUserMFAPreferenceCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';
import QRCode from 'qrcode';

const cognitoMock = mockClient(CognitoIdentityProviderClient);
const mockToDataURL = QRCode.toDataURL as jest.MockedFunction<typeof QRCode.toDataURL>;

describe('Setup MFA Lambda', () => {
  const validUserId = 'user-123';
  const validAccessToken = 'valid-access-token';
  const mockSecret = 'JBSWY3DPEHPK3PXP';

  beforeEach(() => {
    cognitoMock.reset();
    mockToDataURL.mockClear();
    mockToDataURL.mockResolvedValue('data:image/png;base64,mockQRCode');
  });

  const createEvent = (body: any, userId?: string, authHeader?: string): Partial<APIGatewayProxyEvent> => ({
    pathParameters: userId ? { id: userId } : undefined,
    headers: authHeader ? { Authorization: authHeader } : {},
    body: body ? JSON.stringify(body) : null,
  });

  describe('Validation', () => {
    it('should return 400 if user ID is missing', async () => {
      const event = createEvent({}, undefined, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('User ID is required');
    });

    it('should return 401 if authorization token is missing', async () => {
      const event = createEvent({}, validUserId);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_REQUIRED');
    });
  });

  describe('Step 1: QR Code Generation', () => {
    it('should successfully generate QR code and secret', async () => {
      cognitoMock.on(AssociateSoftwareTokenCommand).resolves({
        SecretCode: mockSecret,
      });

      const event = createEvent({}, validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      console.log('Test received body:', body);
      console.log('Test received body.qrCode:', body.qrCode);
      expect(body.qrCode).toBe('data:image/png;base64,mockQRCode');
      expect(body.secret).toBe(mockSecret);

      // Verify Cognito was called correctly
      const cognitoCalls = cognitoMock.commandCalls(AssociateSoftwareTokenCommand);
      expect(cognitoCalls.length).toBe(1);
      expect(cognitoCalls[0].args[0].input.AccessToken).toBe(validAccessToken);
    });

    it('should include username in QR code if provided', async () => {
      cognitoMock.on(AssociateSoftwareTokenCommand).resolves({
        SecretCode: mockSecret,
      });

      const event = createEvent(
        { username: 'testuser' },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.qrCode).toBeDefined();
      expect(body.secret).toBe(mockSecret);
    });

    it('should use fallback secret if no secret code is returned', async () => {
      // This test verifies that the fallback mechanism works in test mode
      // In test mode, MFA_TOTP_SEED has a default value even if not explicitly set
      cognitoMock.on(AssociateSoftwareTokenCommand).resolves({
        SecretCode: undefined,
      });

      const event = createEvent({}, validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      // Should succeed with fallback seed in test mode
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.qrCode).toBeDefined();
      expect(body.secret).toBe('TESTMFASEED123456'); // Test fallback seed
    });
  });

  describe('Step 2: Verification and Enablement', () => {
    it('should successfully verify code and enable MFA', async () => {
      cognitoMock.on(VerifySoftwareTokenCommand).resolves({
        Status: 'SUCCESS',
      });
      cognitoMock.on(SetUserMFAPreferenceCommand).resolves({});

      const event = createEvent(
        { verificationCode: '123456' },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('MFA enabled successfully');
      expect(body.enabled).toBe(true);

      // Verify Cognito was called correctly
      const verifyCalls = cognitoMock.commandCalls(VerifySoftwareTokenCommand);
      expect(verifyCalls.length).toBe(1);
      expect(verifyCalls[0].args[0].input).toEqual({
        AccessToken: validAccessToken,
        UserCode: '123456',
        FriendlyDeviceName: 'Authenticator App',
      });

      const preferenceCalls = cognitoMock.commandCalls(SetUserMFAPreferenceCommand);
      expect(preferenceCalls.length).toBe(1);
      expect(preferenceCalls[0].args[0].input).toEqual({
        AccessToken: validAccessToken,
        SoftwareTokenMfaSettings: {
          Enabled: true,
          PreferredMfa: true,
        },
      });
    });

    it('should return 400 for invalid verification code', async () => {
      cognitoMock.on(VerifySoftwareTokenCommand).resolves({
        Status: 'ERROR',
      });

      const event = createEvent(
        { verificationCode: '999999' },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Invalid verification code');
    });
  });

  describe('Error Handling', () => {
    it('should handle Cognito errors during association', async () => {
      cognitoMock.on(AssociateSoftwareTokenCommand).rejects({
        name: 'NotAuthorizedException',
        message: 'Invalid token',
      });

      const event = createEvent({}, validUserId, `Bearer invalid-token`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_INVALID');
    });

    it('should handle Cognito errors during verification', async () => {
      cognitoMock.on(VerifySoftwareTokenCommand).rejects({
        name: 'CodeMismatchException',
        message: 'Invalid code',
      });

      const event = createEvent(
        { verificationCode: '123456' },
        validUserId,
        `Bearer ${validAccessToken}`
      );

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 500 for unexpected errors', async () => {
      cognitoMock.on(AssociateSoftwareTokenCommand).rejects(new Error('Unexpected error'));

      const event = createEvent({}, validUserId, `Bearer ${validAccessToken}`);

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
