import { Pool } from 'pg';
import { handler } from '../../../../src/backend/lambdas/auth/verify-email';
import { setupTestDatabase, teardownTestDatabase, resetTestData, createTestUser } from '../../repositories/test-setup';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

// Mock AWS Cognito
jest.mock('@aws-sdk/client-cognito-identity-provider');

describe('Verify Email Lambda Handler', () => {
  let pool: Pool;
  let mockCognitoClient: any;

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
  });

  const createEvent = (queryParams: any = {}): APIGatewayProxyEvent => ({
    body: null,
    headers: {
      'Content-Type': 'application/json',
    },
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/auth/verify-email',
    pathParameters: null,
    queryStringParameters: queryParams,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'test-request',
      stage: 'test',
      resourceId: 'test',
      resourcePath: '/auth/verify-email',
      httpMethod: 'GET',
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
      path: '/auth/verify-email',
      accountId: 'test-account',
      apiId: 'test-api',
      protocol: 'HTTP/1.1',
      authorizer: null,
    },
    resource: '/auth/verify-email',
  } as APIGatewayProxyEvent);

  const createContext = (): Context => ({
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'verify-email',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:verify-email',
    memoryLimitInMB: '256',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/verify-email',
    logStreamName: 'test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  });

  describe('successful email verification', () => {
    it('should verify email successfully with valid code', async () => {
      const queryParams = {
        email: 'test@example.com',
        code: '123456'
      };

      mockCognitoClient.send.mockResolvedValue({
        // Cognito returns empty object on success
      });

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('verified', true);
      expect(body.message).toBe('Email verified successfully. You can now log in.');

      // Verify Cognito was called with correct parameters
      expect(mockCognitoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          ClientId: 'test-client-id',
          Username: 'test@example.com',
          ConfirmationCode: '123456'
        })
      );
    });

    it('should handle verification with different email formats', async () => {
      const queryParams = {
        email: 'User.Test+123@Example.COM',
        code: '654321'
      };

      mockCognitoClient.send.mockResolvedValue({});

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.verified).toBe(true);

      // Verify Cognito was called with the original email format
      expect(mockCognitoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          Username: 'User.Test+123@Example.COM'
        })
      );
    });
  });

  describe('validation errors', () => {
    it('should return 400 for missing email parameter', async () => {
      const queryParams = {
        code: '123456'
      };

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.email).toBe('Email is required');
    });

    it('should return 400 for missing code parameter', async () => {
      const queryParams = {
        email: 'test@example.com'
      };

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.code).toBe('Confirmation code is required');
    });

    it('should return 400 for invalid email format', async () => {
      const queryParams = {
        email: 'invalid-email',
        code: '123456'
      };

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.email).toBe('Invalid email format');
    });

    it('should return 400 for invalid code format', async () => {
      const queryParams = {
        email: 'test@example.com',
        code: 'abc'  // Too short
      };

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.code).toBe('Confirmation code must be 6 digits');
    });

    it('should return 400 for non-numeric code', async () => {
      const queryParams = {
        email: 'test@example.com',
        code: 'abcdef'
      };

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.code).toBe('Confirmation code must contain only numbers');
    });
  });

  describe('Cognito verification errors', () => {
    it('should return 400 for invalid/expired confirmation code', async () => {
      const queryParams = {
        email: 'test@example.com',
        code: '999999'
      };

      const cognitoError = new Error('Invalid verification code provided');
      (cognitoError as any).name = 'CodeMismatchException';
      mockCognitoClient.send.mockRejectedValue(cognitoError);

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Invalid or expired confirmation code');
    });

    it('should return 400 for expired confirmation code', async () => {
      const queryParams = {
        email: 'test@example.com',
        code: '123456'
      };

      const cognitoError = new Error('Confirmation code has expired');
      (cognitoError as any).name = 'ExpiredCodeException';
      mockCognitoClient.send.mockRejectedValue(cognitoError);

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('expired');
    });

    it('should return 404 for user not found', async () => {
      const queryParams = {
        email: 'nonexistent@example.com',
        code: '123456'
      };

      const cognitoError = new Error('User does not exist');
      (cognitoError as any).name = 'UserNotFoundException';
      mockCognitoClient.send.mockRejectedValue(cognitoError);

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(404);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('User not found');
    });

    it('should return 400 for already confirmed user', async () => {
      const queryParams = {
        email: 'already-confirmed@example.com',
        code: '123456'
      };

      const cognitoError = new Error('User cannot be confirmed. Current status is CONFIRMED');
      (cognitoError as any).name = 'NotAuthorizedException';
      mockCognitoClient.send.mockRejectedValue(cognitoError);

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('already confirmed');
    });

    it('should return 429 for too many attempts', async () => {
      const queryParams = {
        email: 'test@example.com',
        code: '123456'
      };

      const cognitoError = new Error('Attempt limit exceeded');
      (cognitoError as any).name = 'TooManyRequestsException';
      mockCognitoClient.send.mockRejectedValue(cognitoError);

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(429);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(body.error.message).toContain('Too many attempts');
    });
  });

  describe('service availability errors', () => {
    it('should handle Cognito service unavailable', async () => {
      const queryParams = {
        email: 'test@example.com',
        code: '123456'
      };

      const serviceError = new Error('Service temporarily unavailable');
      (serviceError as any).name = 'InternalErrorException';
      mockCognitoClient.send.mockRejectedValue(serviceError);

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(500);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should handle network timeout', async () => {
      const queryParams = {
        email: 'test@example.com',
        code: '123456'
      };

      const timeoutError = new Error('Request timeout');
      (timeoutError as any).code = 'ETIMEDOUT';
      mockCognitoClient.send.mockRejectedValue(timeoutError);

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(500);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('query parameter edge cases', () => {
    it('should handle missing query parameters object', async () => {
      const event = createEvent();
      event.queryStringParameters = null;

      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle empty query parameters', async () => {
      const event = createEvent({});

      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should trim whitespace from parameters', async () => {
      const queryParams = {
        email: '  test@example.com  ',
        code: '  123456  '
      };

      mockCognitoClient.send.mockResolvedValue({});

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);

      // Verify Cognito was called with trimmed values
      expect(mockCognitoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          Username: 'test@example.com',
          ConfirmationCode: '123456'
        })
      );
    });
  });

  describe('security considerations', () => {
    it('should not expose sensitive information in error messages', async () => {
      const queryParams = {
        email: 'test@example.com',
        code: '123456'
      };

      const cognitoError = new Error('Internal processing error with sensitive details');
      (cognitoError as any).name = 'InternalErrorException';
      mockCognitoClient.send.mockRejectedValue(cognitoError);

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(500);

      const body = JSON.parse(result.body);
      expect(body.error.message).not.toContain('sensitive details');
      expect(body.error.message).toBe('An unexpected error occurred');
    });

    it('should handle URL-decoded parameters', async () => {
      const queryParams = {
        email: 'test%40example.com',  // URL encoded @
        code: '123456'
      };

      mockCognitoClient.send.mockResolvedValue({});

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);

      // Verify the email was properly decoded
      expect(mockCognitoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          Username: 'test@example.com'
        })
      );
    });
  });

  describe('response format', () => {
    it('should return consistent response structure for success', async () => {
      const queryParams = {
        email: 'test@example.com',
        code: '123456'
      };

      mockCognitoClient.send.mockResolvedValue({});

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      expect(result.headers).toHaveProperty('Content-Type', 'application/json');

      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('verified');
      expect(body).toHaveProperty('message');
      expect(typeof body.verified).toBe('boolean');
      expect(typeof body.message).toBe('string');
    });

    it('should return consistent error structure', async () => {
      const queryParams = {
        email: 'invalid-email',
        code: '123456'
      };

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);
      expect(result.headers).toHaveProperty('Content-Type', 'application/json');

      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
      expect(body.error).toHaveProperty('details');
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in successful response', async () => {
      const queryParams = {
        email: 'test@example.com',
        code: '123456'
      };

      mockCognitoClient.send.mockResolvedValue({});

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Headers');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Methods');
    });

    it('should include CORS headers in error response', async () => {
      const queryParams = {
        email: 'invalid-email',
        code: '123456'
      };

      const event = createEvent(queryParams);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Headers');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Methods');
    });
  });
});