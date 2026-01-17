import { Pool } from 'pg';
import { handler } from '../../../../src/backend/lambdas/auth/login';
import { setupTestDatabase, teardownTestDatabase, resetTestData, createTestUser } from '../../repositories/test-setup';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

// Mock AWS Cognito
jest.mock('@aws-sdk/client-cognito-identity-provider');

// Mock JWT verification
jest.mock('../../../../src/backend/lambdas/auth/tokenVerifier', () => ({
  verifyJwtToken: jest.fn(),
}));

jest.mock('../../../../src/backend/services/rateLimitPolicy', () => ({
  applyRateLimit: jest.fn(),
  attachRateLimitHeaders: jest.fn(),
}));

describe('Login Lambda Handler', () => {
  let pool: Pool;
  let mockCognitoClient: any;
  let mockApplyRateLimit: jest.Mock;
  let mockAttachRateLimitHeaders: jest.Mock;

  // Helper to map database user to application user (snake_case to camelCase)
  const mapDbUserToUser = (dbUser: any) => ({
    id: dbUser.id,
    cognitoSub: dbUser.cognito_sub,
    email: dbUser.email,
    username: dbUser.username,
    profileSlug: dbUser.profile_slug,
    defaultVisibility: dbUser.default_visibility,
    isAdmin: dbUser.is_admin,
    isAwsEmployee: dbUser.is_aws_employee,
  });

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;

    // Set required environment variables
    process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
    process.env.COGNITO_REGION = 'us-east-1';
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();
    jest.clearAllMocks();

    // Set up Cognito client mock
    mockCognitoClient = {
      send: jest.fn()
    };

    const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
    (CognitoIdentityProviderClient as jest.Mock).mockImplementation(() => mockCognitoClient);

    const rateLimitPolicy = require('../../../../src/backend/services/rateLimitPolicy');
    mockApplyRateLimit = rateLimitPolicy.applyRateLimit as jest.Mock;
    mockAttachRateLimitHeaders = rateLimitPolicy.attachRateLimitHeaders as jest.Mock;
    mockApplyRateLimit.mockResolvedValue(null);
    mockAttachRateLimitHeaders.mockImplementation((response: APIGatewayProxyResult) => response);
  });

  const createEvent = (body: any): APIGatewayProxyEvent => ({
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/auth/login',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'test-request',
      stage: 'test',
      resourceId: 'test',
      resourcePath: '/auth/login',
      httpMethod: 'POST',
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
        apiKey: null,
        apiKeyId: null,
        clientCert: null,
      },
      path: '/auth/login',
      accountId: 'test-account',
      apiId: 'test-api',
      protocol: 'HTTP/1.1',
      authorizer: null,
    },
    resource: '/auth/login',
  } as APIGatewayProxyEvent);

  const createContext = (): Context => ({
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'login',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:login',
    memoryLimitInMB: '256',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/login',
    logStreamName: 'test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  });

  describe('successful login', () => {
    it('should login user successfully with valid credentials', async () => {
      // Create test user in database
      const testUser = await createTestUser(pool, {
        cognitoSub: 'cognito-sub-123',
        email: 'test@example.com',
        username: 'testuser',
        profileSlug: 'testuser-slug',
        isAdmin: false,
        isAwsEmployee: false
      });

      const requestBody = {
        email: 'test@example.com',
        password: 'SecurePassword123!'
      };

      mockCognitoClient.send.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'mock-access-token',
          IdToken: 'mock-id-token',
          RefreshToken: 'mock-refresh-token',
          ExpiresIn: 3600
        }
      });

      const { verifyJwtToken } = require('../../../../src/backend/lambdas/auth/tokenVerifier');
      verifyJwtToken.mockResolvedValue({
        isValid: true,
        user: mapDbUserToUser(testUser),
        claims: {
          sub: 'cognito-sub-123',
          email: 'test@example.com'
        }
      });

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('accessToken', 'mock-access-token');
      expect(body).toHaveProperty('idToken', 'mock-id-token');
      expect(body).toHaveProperty('refreshToken', 'mock-refresh-token');
      expect(body).toHaveProperty('expiresIn', 3600);
      expect(body.user).toMatchObject({
        id: testUser.id,
        email: 'test@example.com',
        username: 'testuser',
        profileSlug: 'testuser-slug',
        isAdmin: false,
        isAwsEmployee: false
      });
    });

    it('uses configured allowed audiences when verifying tokens', async () => {
      const previousAllowedAudiences = process.env.ALLOWED_AUDIENCES;
      process.env.ALLOWED_AUDIENCES = 'aud-one,aud-two';

      try {
        const testUser = await createTestUser(pool, {
          cognitoSub: 'cognito-sub-allowed',
          email: 'allowed@example.com',
          username: 'alloweduser',
          profileSlug: 'allowed-slug',
          isAdmin: false,
          isAwsEmployee: false
        });

        const requestBody = {
          email: 'allowed@example.com',
          password: 'SecurePassword123!'
        };

        mockCognitoClient.send.mockResolvedValue({
          AuthenticationResult: {
            AccessToken: 'mock-access-token',
            IdToken: 'mock-id-token',
            RefreshToken: 'mock-refresh-token',
            ExpiresIn: 3600
          }
        });

        const { verifyJwtToken } = require('../../../../src/backend/lambdas/auth/tokenVerifier');
        verifyJwtToken.mockResolvedValue({
          isValid: true,
          user: mapDbUserToUser(testUser),
          claims: {
            sub: 'cognito-sub-allowed',
            email: 'allowed@example.com'
          }
        });

        const event = createEvent(requestBody);
        const context = createContext();

        await handler(event, context);

        expect(verifyJwtToken).toHaveBeenCalledWith(
          'mock-access-token',
          expect.objectContaining({
            allowedAudiences: ['aud-one', 'aud-two']
          }),
          expect.any(Object)
        );
      } finally {
        if (previousAllowedAudiences === undefined) {
          delete process.env.ALLOWED_AUDIENCES;
        } else {
          process.env.ALLOWED_AUDIENCES = previousAllowedAudiences;
        }
      }
    });

    it('falls back to client ID when allowed audiences are not configured', async () => {
      const previousAllowedAudiences = process.env.ALLOWED_AUDIENCES;
      delete process.env.ALLOWED_AUDIENCES;

      try {
        const testUser = await createTestUser(pool, {
          cognitoSub: 'cognito-sub-default',
          email: 'default@example.com',
          username: 'defaultuser',
          profileSlug: 'default-slug',
          isAdmin: false,
          isAwsEmployee: false
        });

        const requestBody = {
          email: 'default@example.com',
          password: 'SecurePassword123!'
        };

        mockCognitoClient.send.mockResolvedValue({
          AuthenticationResult: {
            AccessToken: 'mock-access-token',
            IdToken: 'mock-id-token',
            RefreshToken: 'mock-refresh-token',
            ExpiresIn: 3600
          }
        });

        const { verifyJwtToken } = require('../../../../src/backend/lambdas/auth/tokenVerifier');
        verifyJwtToken.mockResolvedValue({
          isValid: true,
          user: mapDbUserToUser(testUser),
          claims: {
            sub: 'cognito-sub-default',
            email: 'default@example.com'
          }
        });

        const event = createEvent(requestBody);
        const context = createContext();

        await handler(event, context);

        expect(verifyJwtToken).toHaveBeenCalledWith(
          'mock-access-token',
          expect.objectContaining({
            allowedAudiences: ['test-client-id']
          }),
          expect.any(Object)
        );
      } finally {
        if (previousAllowedAudiences === undefined) {
          delete process.env.ALLOWED_AUDIENCES;
        } else {
          process.env.ALLOWED_AUDIENCES = previousAllowedAudiences;
        }
      }
    });

    it('should login admin user with admin privileges', async () => {
      // Create admin user in database
      const adminUser = await createTestUser(pool, {
        cognitoSub: 'admin-cognito-sub',
        email: 'admin@example.com',
        username: 'adminuser',
        profileSlug: 'admin-slug',
        isAdmin: true,
        isAwsEmployee: false
      });

      const requestBody = {
        email: 'admin@example.com',
        password: 'AdminPassword123!'
      };

      mockCognitoClient.send.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'admin-access-token',
          IdToken: 'admin-id-token',
          RefreshToken: 'admin-refresh-token',
          ExpiresIn: 3600
        }
      });

      const { verifyJwtToken } = require('../../../../src/backend/lambdas/auth/tokenVerifier');
      verifyJwtToken.mockResolvedValue({
        isValid: true,
        user: mapDbUserToUser(adminUser),
        claims: {
          sub: 'admin-cognito-sub',
          email: 'admin@example.com'
        }
      });

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.user.isAdmin).toBe(true);
    });

    it('should default expiresIn when Cognito does not return a value', async () => {
      const testUser = await createTestUser(pool, {
        cognitoSub: 'cognito-sub-124',
        email: 'expires@example.com',
        username: 'expiresuser',
        profileSlug: 'expiresuser-slug',
        isAdmin: false,
        isAwsEmployee: false
      });

      const requestBody = {
        email: 'expires@example.com',
        password: 'SecurePassword123!'
      };

      mockCognitoClient.send.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'mock-access-token',
          IdToken: 'mock-id-token',
          RefreshToken: 'mock-refresh-token'
        }
      });

      const { verifyJwtToken } = require('../../../../src/backend/lambdas/auth/tokenVerifier');
      verifyJwtToken.mockResolvedValue({
        isValid: true,
        user: mapDbUserToUser(testUser),
        claims: {
          sub: 'cognito-sub-124',
          email: 'expires@example.com'
        }
      });

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.expiresIn).toBe(3600);
    });

    it('should login AWS employee with employee status', async () => {
      // Create AWS employee user in database
      const awsUser = await createTestUser(pool, {
        cognitoSub: 'aws-cognito-sub',
        email: 'aws@amazon.com',
        username: 'awsuser',
        profileSlug: 'aws-slug',
        isAdmin: false,
        isAwsEmployee: true
      });

      const requestBody = {
        email: 'aws@amazon.com',
        password: 'AwsPassword123!'
      };

      mockCognitoClient.send.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'aws-access-token',
          IdToken: 'aws-id-token',
          RefreshToken: 'aws-refresh-token',
          ExpiresIn: 3600
        }
      });

      const { verifyJwtToken } = require('../../../../src/backend/lambdas/auth/tokenVerifier');
      verifyJwtToken.mockResolvedValue({
        isValid: true,
        user: mapDbUserToUser(awsUser),
        claims: {
          sub: 'aws-cognito-sub',
          email: 'aws@amazon.com'
        }
      });

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.user.isAwsEmployee).toBe(true);
    });
  });

  describe('authentication failures', () => {
    it('should return 401 for invalid credentials', async () => {
      const requestBody = {
        email: 'test@example.com',
        password: 'WrongPassword123!'
      };

      const authError = new Error('Incorrect username or password');
      (authError as any).name = 'NotAuthorizedException';
      mockCognitoClient.send.mockRejectedValue(authError);

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(401);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_INVALID');
      expect(body.error.message).toContain('Invalid credentials');
    });

    it('should return 401 for user not found', async () => {
      const requestBody = {
        email: 'nonexistent@example.com',
        password: 'Password123!'
      };

      const authError = new Error('User does not exist');
      (authError as any).name = 'UserNotFoundException';
      mockCognitoClient.send.mockRejectedValue(authError);

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(404);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 401 for unconfirmed user', async () => {
      const requestBody = {
        email: 'unconfirmed@example.com',
        password: 'Password123!'
      };

      const authError = new Error('User is not confirmed');
      (authError as any).name = 'UserNotConfirmedException';
      mockCognitoClient.send.mockRejectedValue(authError);

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(401);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_INVALID');
      expect(body.error.message).toContain('Please verify your email');
    });

    it('should return 401 for temporarily locked user', async () => {
      const requestBody = {
        email: 'locked@example.com',
        password: 'Password123!'
      };

      const authError = new Error('User account is temporarily locked');
      (authError as any).name = 'UserTemporarilyLockedException';
      mockCognitoClient.send.mockRejectedValue(authError);

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(401);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_INVALID');
      expect(body.error.message).toContain('temporarily locked');
    });
  });

  describe('validation errors', () => {
    it('should return 400 for missing email', async () => {
      const requestBody = {
        password: 'Password123!'
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.email).toBe('Email is required');
    });

    it('should return 400 for missing password', async () => {
      const requestBody = {
        email: 'test@example.com'
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.password).toBe('Password is required');
    });

    it('should return 400 for invalid email format', async () => {
      const requestBody = {
        email: 'invalid-email',
        password: 'Password123!'
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.email).toBe('Invalid email format');
    });
  });

  describe('database integration', () => {
    it('should handle case where user exists in Cognito but not in database', async () => {
      const requestBody = {
        email: 'cognito-only@example.com',
        password: 'Password123!'
      };

      mockCognitoClient.send.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'cognito-access-token',
          IdToken: 'cognito-id-token',
          RefreshToken: 'cognito-refresh-token',
          ExpiresIn: 3600
        }
      });

      const { verifyJwtToken } = require('../../../../src/backend/lambdas/auth/tokenVerifier');
      verifyJwtToken.mockResolvedValue({
        isValid: false,
        error: {
          code: 'AUTH_INVALID',
          message: 'User not found in database'
        }
      });

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(401);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_INVALID');
    });

    it('should handle database connection errors gracefully', async () => {
      const requestBody = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      mockCognitoClient.send.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'mock-access-token',
          IdToken: 'mock-id-token',
          RefreshToken: 'mock-refresh-token',
          ExpiresIn: 3600
        }
      });

      const { verifyJwtToken } = require('../../../../src/backend/lambdas/auth/tokenVerifier');
      verifyJwtToken.mockResolvedValue({
        isValid: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve user data'
        }
      });

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(500);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('malformed request handling', () => {
    it('should return 400 for invalid JSON', async () => {
      const event = createEvent({});
      event.body = 'invalid json';

      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing body', async () => {
      const event = createEvent({});
      event.body = null;

      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('edge cases', () => {
    it('should return 500 when Cognito does not return authentication result', async () => {
      const requestBody = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      mockCognitoClient.send.mockResolvedValue({});

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(500);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('rate limiting', () => {
    it('should handle rate limiting errors', async () => {
      const requestBody = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const rateLimitError = new Error('Too many requests');
      (rateLimitError as any).name = 'TooManyRequestsException';
      mockCognitoClient.send.mockRejectedValue(rateLimitError);

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(429);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('RATE_LIMITED');
    });

    it('should reject requests when rate limit is exceeded before authentication', async () => {
      const requestBody = {
        email: 'rate-limited@example.com',
        password: 'Password123!'
      };

      mockApplyRateLimit.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        reset: Date.now(),
        limit: 1,
        key: 'auth:login:ip:127.0.0.1',
      });

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(429);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(mockCognitoClient.send).not.toHaveBeenCalled();
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in response', async () => {
      const requestBody = {
        email: 'test@example.com',
        password: 'Password123!'
      };

      const authError = new Error('Invalid credentials');
      (authError as any).name = 'NotAuthorizedException';
      mockCognitoClient.send.mockRejectedValue(authError);

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Headers');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Methods');
    });
  });
});
