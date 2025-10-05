import { handler } from '../../../../src/backend/lambdas/auth/refresh';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

// Mock AWS Cognito
jest.mock('@aws-sdk/client-cognito-identity-provider');

describe('Refresh Token Lambda Handler', () => {
  let mockCognitoClient: any;

  beforeAll(() => {
    // Set required environment variables
    process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
    process.env.COGNITO_REGION = 'us-east-1';
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up Cognito client mock
    mockCognitoClient = {
      send: jest.fn()
    };

    const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
    (CognitoIdentityProviderClient as jest.Mock).mockImplementation(() => mockCognitoClient);
  });

  const createEvent = (body: any): APIGatewayProxyEvent => ({
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/auth/refresh',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'test-request',
      stage: 'test',
      resourceId: 'test',
      resourcePath: '/auth/refresh',
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
      path: '/auth/refresh',
      accountId: 'test-account',
      apiId: 'test-api',
      protocol: 'HTTP/1.1',
      authorizer: null,
    },
    resource: '/auth/refresh',
  } as APIGatewayProxyEvent);

  const createContext = (): Context => ({
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'refresh',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:refresh',
    memoryLimitInMB: '256',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/refresh',
    logStreamName: 'test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  });

  describe('successful token refresh', () => {
    it('should refresh tokens successfully with valid refresh token', async () => {
      const requestBody = {
        refreshToken: 'valid-refresh-token'
      };

      mockCognitoClient.send.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'new-access-token',
          IdToken: 'new-id-token',
          ExpiresIn: 3600
        }
      });

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('accessToken', 'new-access-token');
      expect(body).toHaveProperty('idToken', 'new-id-token');
      expect(body).toHaveProperty('expiresIn', 3600);

      // Verify Cognito was called with correct parameters
      expect(mockCognitoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: 'test-client-id',
          AuthParameters: {
            REFRESH_TOKEN: 'valid-refresh-token'
          }
        })
      );
    });

    it('should handle refresh token response without IdToken', async () => {
      const requestBody = {
        refreshToken: 'valid-refresh-token'
      };

      mockCognitoClient.send.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'new-access-token',
          ExpiresIn: 3600
          // Note: IdToken may not be returned in refresh
        }
      });

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('accessToken', 'new-access-token');
      expect(body).toHaveProperty('expiresIn', 3600);
      expect(body.idToken).toBeUndefined();
    });
  });

  describe('refresh token validation errors', () => {
    it('should return 400 for missing refresh token', async () => {
      const requestBody = {};

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.refreshToken).toBe('Refresh token is required');
    });

    it('should return 400 for empty refresh token', async () => {
      const requestBody = {
        refreshToken: ''
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.refreshToken).toBe('Refresh token cannot be empty');
    });

    it('should return 400 for invalid refresh token format', async () => {
      const requestBody = {
        refreshToken: 'invalid-token-format'
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.refreshToken).toBe('Invalid refresh token format');
    });
  });

  describe('Cognito authentication errors', () => {
    it('should return 401 for expired refresh token', async () => {
      const requestBody = {
        refreshToken: 'expired-refresh-token'
      };

      const authError = new Error('Refresh token has expired');
      (authError as any).name = 'NotAuthorizedException';
      mockCognitoClient.send.mockRejectedValue(authError);

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(401);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_INVALID');
      expect(body.error.message).toContain('expired or invalid');
    });

    it('should return 401 for revoked refresh token', async () => {
      const requestBody = {
        refreshToken: 'revoked-refresh-token'
      };

      const authError = new Error('Refresh token has been revoked');
      (authError as any).name = 'NotAuthorizedException';
      mockCognitoClient.send.mockRejectedValue(authError);

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(401);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_INVALID');
    });

    it('should return 401 for user not found', async () => {
      const requestBody = {
        refreshToken: 'token-for-deleted-user'
      };

      const authError = new Error('User does not exist');
      (authError as any).name = 'UserNotFoundException';
      mockCognitoClient.send.mockRejectedValue(authError);

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(401);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_INVALID');
    });

    it('should return 401 for disabled user', async () => {
      const requestBody = {
        refreshToken: 'token-for-disabled-user'
      };

      const authError = new Error('User is disabled');
      (authError as any).name = 'UserNotConfirmedException';
      mockCognitoClient.send.mockRejectedValue(authError);

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(401);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('AUTH_INVALID');
    });
  });

  describe('service availability errors', () => {
    it('should handle Cognito service unavailable', async () => {
      const requestBody = {
        refreshToken: 'valid-refresh-token'
      };

      const serviceError = new Error('Service unavailable');
      (serviceError as any).name = 'InternalErrorException';
      mockCognitoClient.send.mockRejectedValue(serviceError);

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(500);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should handle network timeout', async () => {
      const requestBody = {
        refreshToken: 'valid-refresh-token'
      };

      const timeoutError = new Error('Request timeout');
      (timeoutError as any).code = 'ETIMEDOUT';
      mockCognitoClient.send.mockRejectedValue(timeoutError);

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
        refreshToken: 'valid-refresh-token'
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
      expect(body.error.message).toContain('Too many requests');
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

    it('should return 400 for empty body', async () => {
      const event = createEvent({});
      event.body = '{}';

      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('edge cases', () => {
    it('should handle missing authentication result', async () => {
      const requestBody = {
        refreshToken: 'valid-refresh-token'
      };

      mockCognitoClient.send.mockResolvedValue({
        // Missing AuthenticationResult
      });

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(500);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should handle missing access token in response', async () => {
      const requestBody = {
        refreshToken: 'valid-refresh-token'
      };

      mockCognitoClient.send.mockResolvedValue({
        AuthenticationResult: {
          // Missing AccessToken
          ExpiresIn: 3600
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

  describe('token format validation', () => {
    it('should validate JWT-like format for refresh token', async () => {
      const requestBody = {
        refreshToken: 'not.a.jwt'
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should accept valid JWT-like refresh token format', async () => {
      const requestBody = {
        refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
      };

      mockCognitoClient.send.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'new-access-token',
          IdToken: 'new-id-token',
          ExpiresIn: 3600
        }
      });

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in successful response', async () => {
      const requestBody = {
        refreshToken: 'valid-refresh-token'
      };

      mockCognitoClient.send.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'new-access-token',
          IdToken: 'new-id-token',
          ExpiresIn: 3600
        }
      });

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Headers');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Methods');
    });

    it('should include CORS headers in error response', async () => {
      const requestBody = {
        refreshToken: 'invalid-token'
      };

      const authError = new Error('Invalid token');
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