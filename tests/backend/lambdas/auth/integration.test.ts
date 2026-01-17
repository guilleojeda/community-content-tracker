/**
 * Integration test for authentication endpoints
 * This test verifies that our authentication APIs follow the correct patterns
 * and would work with the proper infrastructure
 */

import {
  validateRegistrationInput,
  validateLoginInput,
  validateRefreshTokenInput,
  validateVerifyEmailInput,
  isAwsEmployee,
  generateProfileSlug,
  createErrorResponse,
  createSuccessResponse,
  mapCognitoError
} from '../../../../src/backend/lambdas/auth/utils';
import { ConfirmSignUpCommand, InitiateAuthCommand, SignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import {
  setupTestDatabase,
  teardownTestDatabase,
  resetTestData
} from '../../repositories/test-setup';
import { handler as registerHandler } from '../../../../src/backend/lambdas/auth/register';
import { handler as loginHandler } from '../../../../src/backend/lambdas/auth/login';
import { handler as refreshHandler } from '../../../../src/backend/lambdas/auth/refresh';
import { handler as verifyEmailHandler } from '../../../../src/backend/lambdas/auth/verify-email';
import { verifyJwtToken } from '../../../../src/backend/lambdas/auth/tokenVerifier';
import { resetAuthEnvironmentCache } from '../../../../src/backend/lambdas/auth/config';
import { Context, APIGatewayProxyEvent } from 'aws-lambda';
import { Pool } from 'pg';
import { User } from '../../../../src/shared/types';

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

jest.mock('../../../../src/backend/lambdas/auth/tokenVerifier', () => ({
  verifyJwtToken: jest.fn(),
}));

const mockedVerifyJwtToken = verifyJwtToken as jest.MockedFunction<typeof verifyJwtToken>;

const baseRequestContext = (path: string, method: string) => ({
  requestId: 'test-request',
  stage: 'test',
  resourceId: 'test',
  resourcePath: path,
  httpMethod: method,
  requestTime: new Date().toISOString(),
  requestTimeEpoch: Date.now(),
  identity: {
    cognitoIdentityPoolId: null,
    accountId: null,
    cognitoIdentityId: null,
    caller: null,
    sourceIp: '127.0.0.1',
    principalOrgId: null,
    accessKey: null,
    cognitoAuthenticationType: null,
    cognitoAuthenticationProvider: null,
    userAgent: 'test-agent',
    userArn: null,
    user: null,
  },
  path,
  accountId: 'test-account',
  apiId: 'test-api',
  protocol: 'HTTP/1.1',
  authorizer: null,
});

const createContext = (functionName: string): Context => ({
  callbackWaitsForEmptyEventLoop: false,
  functionName,
  functionVersion: '1',
  invokedFunctionArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}`,
  memoryLimitInMB: '256',
  awsRequestId: `${functionName}-request-id`,
  logGroupName: `/aws/lambda/${functionName}`,
  logStreamName: 'test-stream',
  getRemainingTimeInMillis: () => 30000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
});

const createJsonEvent = (path: string, method: string, payload: any): APIGatewayProxyEvent =>
  ({
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
    },
    multiValueHeaders: {},
    httpMethod: method,
    isBase64Encoded: false,
    path,
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: path,
    requestContext: baseRequestContext(path, method),
  } as unknown as APIGatewayProxyEvent);

const createVerifyEvent = (email: string, code: string): APIGatewayProxyEvent =>
  ({
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/auth/verify-email',
    pathParameters: null,
    queryStringParameters: {
      email: encodeURIComponent(email),
      code: encodeURIComponent(code),
    },
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '/auth/verify-email',
    requestContext: baseRequestContext('/auth/verify-email', 'GET'),
  } as unknown as APIGatewayProxyEvent);

describe('Auth Integration Tests', () => {
  describe('Input Validation', () => {
    test('should validate registration input correctly', () => {
      const validInput = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
        username: 'testuser'
      };

      const result = validateRegistrationInput(validInput);
      expect(result.isValid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    test('should reject invalid registration input', () => {
      const invalidInput = {
        email: 'invalid-email',
        password: 'weak',
        username: 'test-user-!'
      };

      const result = validateRegistrationInput(invalidInput);
      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.email).toContain('Invalid email format');
      expect(result.errors!.password).toContain('at least 12 characters');
      expect(result.errors!.username).toContain('letters, numbers, hyphens, and underscores');
    });

    test('should validate login input correctly', () => {
      const validInput = {
        email: 'test@example.com',
        password: 'password123'
      };

      const result = validateLoginInput(validInput);
      expect(result.isValid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    test('should validate refresh token input correctly', () => {
      const validInput = {
        refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
      };

      const result = validateRefreshTokenInput(validInput);
      expect(result.isValid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    test('should validate verify email input correctly', () => {
      const validInput = {
        email: 'test@example.com',
        confirmationCode: '123456'
      };

      const result = validateVerifyEmailInput(validInput);
      expect(result.isValid).toBe(true);
      expect(result.errors).toBeUndefined();
    });
  });

  describe('AWS Employee Detection', () => {
    test('should detect AWS employee emails', () => {
      expect(isAwsEmployee('user@amazon.com')).toBe(true);
      expect(isAwsEmployee('user@aws.amazon.com')).toBe(true);
      expect(isAwsEmployee('user@twitch.tv')).toBe(true);
      expect(isAwsEmployee('user@wholefoodsmarket.com')).toBe(true);
    });

    test('should not detect non-AWS emails as employees', () => {
      expect(isAwsEmployee('user@example.com')).toBe(false);
      expect(isAwsEmployee('user@google.com')).toBe(false);
      expect(isAwsEmployee('user@microsoft.com')).toBe(false);
    });
  });

  describe('Profile Slug Generation', () => {
    test('should generate profile slug from username', () => {
      const slug = generateProfileSlug('testuser');
      expect(slug).toBe('testuser');
    });

    test('should handle special characters in username', () => {
      const slug = generateProfileSlug('test-user_123');
      expect(slug).toBe('test-user-123');
    });

    test('should generate unique slug when conflicts exist', () => {
      const existingSlugs = ['testuser', 'testuser-2'];
      const slug = generateProfileSlug('testuser', existingSlugs);
      expect(slug).toBe('testuser-3');
    });
  });

  describe('Response Utilities', () => {
    test('should create error response with proper format', () => {
      const response = createErrorResponse(400, 'VALIDATION_ERROR', 'Test error');

      expect(response.statusCode).toBe(400);
      expect(response.headers['Content-Type']).toBe('application/json');
      expect(response.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
      expect(response.headers.Vary).toBe('Origin');

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('Test error');
    });

    test('should create success response with proper format', () => {
      const data = { userId: '123', message: 'Success' };
      const response = createSuccessResponse(201, data);

      expect(response.statusCode).toBe(201);
      expect(response.headers['Content-Type']).toBe('application/json');
      expect(response.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
      expect(response.headers.Vary).toBe('Origin');

      const body = JSON.parse(response.body);
      expect(body.userId).toBe('123');
      expect(body.message).toBe('Success');
    });
  });

  describe('Cognito Error Mapping', () => {
    test('should map UsernameExistsException correctly', () => {
      const cognitoError = new Error('Username already exists');
      (cognitoError as any).name = 'UsernameExistsException';

      const response = mapCognitoError(cognitoError);
      expect(response.statusCode).toBe(409);

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('DUPLICATE_RESOURCE');
    });

    test('should map NotAuthorizedException correctly', () => {
      const cognitoError = new Error('Invalid credentials');
      (cognitoError as any).name = 'NotAuthorizedException';

      const response = mapCognitoError(cognitoError);
      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('AUTH_INVALID');
    });

    test('should map UserNotFoundException correctly', () => {
      const cognitoError = new Error('User not found');
      (cognitoError as any).name = 'UserNotFoundException';

      const response = mapCognitoError(cognitoError);
      // For security reasons, UserNotFoundException returns 401 instead of 404
      // to prevent user enumeration attacks
      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('AUTH_INVALID');
      expect(body.error.message).toBe('Invalid credentials');
    });

    test('should map TooManyRequestsException correctly', () => {
      const cognitoError = new Error('Too many requests');
      (cognitoError as any).name = 'TooManyRequestsException';

      const response = mapCognitoError(cognitoError);
      expect(response.statusCode).toBe(429);

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('RATE_LIMITED');
    });

    test('should handle unknown errors gracefully', () => {
      const unknownError = new Error('Unknown error');
      (unknownError as any).name = 'UnknownException';

      const response = mapCognitoError(unknownError);
      expect(response.statusCode).toBe(500);

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('API Contract Verification', () => {
    test('register response should match API contract', () => {
      const response = createSuccessResponse(201, {
        userId: 'uuid-123',
        message: 'Please check your email to verify your account'
      });

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('userId');
      expect(body).toHaveProperty('message');
      expect(typeof body.userId).toBe('string');
      expect(typeof body.message).toBe('string');
    });

    test('login response should match API contract', () => {
      const loginData = {
        accessToken: 'mock-access-token',
        idToken: 'mock-id-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 3600,
        user: {
          id: 'uuid-123',
          email: 'test@example.com',
          username: 'testuser',
          profileSlug: 'testuser-slug',
          isAdmin: false,
          isAwsEmployee: false
        }
      };

      const response = createSuccessResponse(200, loginData);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('accessToken');
      expect(body).toHaveProperty('idToken');
      expect(body).toHaveProperty('refreshToken');
      expect(body).toHaveProperty('expiresIn');
      expect(body).toHaveProperty('user');
      expect(body.user).toHaveProperty('id');
      expect(body.user).toHaveProperty('email');
      expect(body.user).toHaveProperty('username');
      expect(body.user).toHaveProperty('profileSlug');
      expect(body.user).toHaveProperty('isAdmin');
      expect(body.user).toHaveProperty('isAwsEmployee');
    });

    test('refresh response should match API contract', () => {
      const refreshData = {
        accessToken: 'new-access-token',
        idToken: 'new-id-token',
        expiresIn: 3600
      };

      const response = createSuccessResponse(200, refreshData);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('accessToken');
      expect(body).toHaveProperty('expiresIn');
      expect(typeof body.accessToken).toBe('string');
      expect(typeof body.expiresIn).toBe('number');
    });

    test('verify email response should match API contract', () => {
      const verifyData = {
        verified: true,
        message: 'Email verified successfully. You can now log in.'
      };

      const response = createSuccessResponse(200, verifyData);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('verified');
      expect(body).toHaveProperty('message');
      expect(typeof body.verified).toBe('boolean');
      expect(typeof body.message).toBe('string');
    });
  });
});

describe('Authentication End-to-End Flow', () => {
  let pool: Pool;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    CognitoIdentityProviderClient.mockImplementation(() => ({ send: cognitoSendMock }));
    cognitoSendMock.mockReset();
    cognitoSendMock.mockResolvedValue({});
    mockedVerifyJwtToken.mockReset();
    await resetTestData();
    resetAuthEnvironmentCache();
  });

  it('registers, logs in, refreshes tokens, and verifies email', async () => {
    cognitoSendMock.mockImplementation((command: any) => {
      const candidateInput =
        command && typeof command === 'object' && 'input' in command ? command.input : command;

      if (command instanceof SignUpCommand) {
        return Promise.resolve({
          UserSub: 'cognito-user-sub-001',
          CodeDeliveryDetails: {
            Destination: 'flow@example.com',
            DeliveryMedium: 'EMAIL',
          },
        });
      }
      if (command instanceof InitiateAuthCommand || candidateInput?.AuthFlow) {
        if (candidateInput?.AuthFlow === 'USER_PASSWORD_AUTH') {
          return Promise.resolve({
            AuthenticationResult: {
              AccessToken: 'access-token-1',
              IdToken: 'id-token-1',
              RefreshToken: 'refresh-token-1',
              ExpiresIn: 3600,
            },
          });
        }
        if (candidateInput?.AuthFlow === 'REFRESH_TOKEN_AUTH') {
          return Promise.resolve({
            AuthenticationResult: {
              AccessToken: 'access-token-2',
              IdToken: 'id-token-2',
              ExpiresIn: 3600,
            },
          });
        }
      }
      if (command instanceof ConfirmSignUpCommand || candidateInput?.ConfirmationCode) {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const registerEvent = createJsonEvent('/auth/register', 'POST', {
      email: 'flow@example.com',
      password: 'StrongPassword123!',
      username: 'flowuser',
    });
    const registerContext = createContext('register');

    const registerResult = await registerHandler(registerEvent, registerContext);
    expect(registerResult.statusCode).toBe(201);

    const { rows: userRows } = await pool.query('SELECT * FROM users WHERE email = $1', [
      'flow@example.com',
    ]);
    expect(userRows).toHaveLength(1);
    const dbUser = userRows[0];

    mockedVerifyJwtToken.mockResolvedValueOnce({
      isValid: true,
      user: {
        id: dbUser.id,
        cognitoSub: dbUser.cognito_sub,
        email: dbUser.email,
        username: dbUser.username,
        profileSlug: dbUser.profile_slug,
        defaultVisibility: dbUser.default_visibility,
        isAdmin: dbUser.is_admin,
        isAwsEmployee: dbUser.is_aws_employee,
        createdAt: dbUser.created_at,
        updatedAt: dbUser.updated_at,
      } as User,
    });

    const loginEvent = createJsonEvent('/auth/login', 'POST', {
      email: 'flow@example.com',
      password: 'StrongPassword123!',
    });
    const loginContext = createContext('login');
    const loginResult = await loginHandler(loginEvent, loginContext);
    expect(loginResult.statusCode).toBe(200);
    const loginBody = JSON.parse(loginResult.body);
    expect(loginBody.accessToken).toBe('access-token-1');
    expect(loginBody.user.username).toBe('flowuser');

    const refreshEvent = createJsonEvent('/auth/refresh', 'POST', {
      refreshToken: 'refresh-token-1',
    });
    const refreshContext = createContext('refresh');
    const refreshResult = await refreshHandler(refreshEvent, refreshContext);
    expect(refreshResult.statusCode).toBe(200);
    const refreshBody = JSON.parse(refreshResult.body);
    expect(refreshBody.accessToken).toBe('access-token-2');

    const verifyEvent = createVerifyEvent('flow@example.com', '123456');
    const verifyContext = createContext('verify-email');
    const verifyResult = await verifyEmailHandler(verifyEvent, verifyContext);
    expect(verifyResult.statusCode).toBe(200);
    const verifyBody = JSON.parse(verifyResult.body);
    expect(verifyBody.verified).toBe(true);
  });
});
