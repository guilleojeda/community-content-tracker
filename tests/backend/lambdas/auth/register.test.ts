import { Pool } from 'pg';
import { handler } from '../../../../src/backend/lambdas/auth/register';
import { setupTestDatabase, teardownTestDatabase, resetTestData, createTestUser } from '../../repositories/test-setup';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

// Mock AWS Cognito
jest.mock('@aws-sdk/client-cognito-identity-provider');

// Mock only specific utils, let others pass through
jest.mock('../../../../src/backend/lambdas/auth/utils', () => {
  const actual = jest.requireActual('../../../../src/backend/lambdas/auth/utils');
  return {
    ...actual,
    generateProfileSlug: jest.fn((username: string) => `${username}-slug`),
    validateRegistrationInput: jest.fn(),
  };
});

describe('Register Lambda Handler', () => {
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

    // Default mock implementations
    const { validateRegistrationInput, generateProfileSlug } = require('../../../../src/backend/lambdas/auth/utils');
    validateRegistrationInput.mockReturnValue({ isValid: true });
    generateProfileSlug.mockImplementation((username: string) => `${username}-slug`);
  });

  const createEvent = (body: any): APIGatewayProxyEvent => ({
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/auth/register',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'test-request',
      stage: 'test',
      resourceId: 'test',
      resourcePath: '/auth/register',
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
      path: '/auth/register',
      accountId: 'test-account',
      apiId: 'test-api',
      protocol: 'HTTP/1.1',
      authorizer: null,
    },
    resource: '/auth/register',
  } as APIGatewayProxyEvent);

  const createContext = (): Context => ({
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'register',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:register',
    memoryLimitInMB: '256',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/register',
    logStreamName: 'test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  });

  describe('successful registration', () => {
    it('should register a new user successfully', async () => {
      const requestBody = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
        username: 'testuser'
      };

      mockCognitoClient.send.mockResolvedValue({
        UserSub: 'cognito-user-id-123',
        CodeDeliveryDetails: {
          Destination: 'test@example.com',
          DeliveryMedium: 'EMAIL'
        }
      });

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('userId');
      expect(body.message).toBe('Please check your email to verify your account');

      // Verify user was created in database
      const userResult = await pool.query('SELECT * FROM users WHERE email = $1', ['test@example.com']);
      expect(userResult.rows).toHaveLength(1);

      const user = userResult.rows[0];
      expect(user.cognito_sub).toBe('cognito-user-id-123');
      expect(user.email).toBe('test@example.com');
      expect(user.username).toBe('testuser');
      expect(user.profile_slug).toBe('testuser-slug');
      expect(user.is_admin).toBe(false);
      expect(user.is_aws_employee).toBe(false);
    });

    it('should handle AWS employee email registration', async () => {
      const requestBody = {
        email: 'test@amazon.com',
        password: 'SecurePassword123!',
        username: 'awsuser'
      };

      mockCognitoClient.send.mockResolvedValue({
        UserSub: 'cognito-user-id-456',
      });

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      // Verify AWS employee flag is set
      const userResult = await pool.query('SELECT * FROM users WHERE email = $1', ['test@amazon.com']);
      const user = userResult.rows[0];
      expect(user.is_aws_employee).toBe(true);
    });
  });

  describe('validation errors', () => {
    it('should return 400 for missing email', async () => {
      const { validateRegistrationInput } = require('../../../../src/backend/lambdas/auth/utils');
      validateRegistrationInput.mockReturnValue({
        isValid: false,
        errors: { email: 'Email is required' }
      });

      const requestBody = {
        password: 'SecurePassword123!',
        username: 'testuser'
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.email).toBe('Email is required');
    });

    it('should return 400 for invalid email format', async () => {
      const { validateRegistrationInput } = require('../../../../src/backend/lambdas/auth/utils');
      validateRegistrationInput.mockReturnValue({
        isValid: false,
        errors: { email: 'Invalid email format' }
      });

      const requestBody = {
        email: 'invalid-email',
        password: 'SecurePassword123!',
        username: 'testuser'
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.email).toBe('Invalid email format');
    });

    it('should return 400 for weak password', async () => {
      const { validateRegistrationInput } = require('../../../../src/backend/lambdas/auth/utils');
      validateRegistrationInput.mockReturnValue({
        isValid: false,
        errors: { password: 'Password must be at least 12 characters' }
      });

      const requestBody = {
        email: 'test@example.com',
        password: 'weak',
        username: 'testuser'
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.password).toBe('Password must be at least 12 characters');
    });

    it('should return 400 for invalid username', async () => {
      const { validateRegistrationInput } = require('../../../../src/backend/lambdas/auth/utils');
      validateRegistrationInput.mockReturnValue({
        isValid: false,
        errors: { username: 'Username can only contain letters, numbers, and underscores' }
      });

      const requestBody = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
        username: 'test-user-!'
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields.username).toBe('Username can only contain letters, numbers, and underscores');
    });
  });

  describe('duplicate user handling', () => {
    it('should return 409 for duplicate email', async () => {
      // Create existing user
      await createTestUser(pool, {
        email: 'existing@example.com',
        username: 'existinguser',
        profileSlug: 'existing-slug'
      });

      const requestBody = {
        email: 'existing@example.com',
        password: 'SecurePassword123!',
        username: 'newuser'
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(409);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('DUPLICATE_RESOURCE');
      expect(body.error.message).toContain('email');
    });

    it('should return 409 for duplicate username', async () => {
      // Create existing user
      await createTestUser(pool, {
        email: 'existing@example.com',
        username: 'existinguser',
        profileSlug: 'existing-slug'
      });

      const requestBody = {
        email: 'new@example.com',
        password: 'SecurePassword123!',
        username: 'existinguser'
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(409);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('DUPLICATE_RESOURCE');
      expect(body.error.message).toContain('username');
    });
  });

  describe('Cognito integration errors', () => {
    it('should handle Cognito signup failure', async () => {
      mockCognitoClient.send.mockRejectedValue(new Error('Cognito service unavailable'));

      const requestBody = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
        username: 'testuser'
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(500);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should handle username already exists in Cognito', async () => {
      const cognitoError = new Error('Username already exists');
      (cognitoError as any).name = 'UsernameExistsException';
      mockCognitoClient.send.mockRejectedValue(cognitoError);

      const requestBody = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
        username: 'existinguser'
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(409);

      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('DUPLICATE_RESOURCE');
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

  describe('profile slug generation', () => {
    it('should generate unique profile slug when username conflicts', async () => {
      // Create user with existing profile slug
      await createTestUser(pool, {
        username: 'otheruser',
        profileSlug: 'testuser-slug'
      });

      const { generateProfileSlug } = require('../../../../src/backend/lambdas/auth/utils');
      generateProfileSlug.mockReturnValue('testuser-slug-2');

      mockCognitoClient.send.mockResolvedValue({
        UserSub: 'cognito-user-id-789',
      });

      const requestBody = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
        username: 'testuser'
      };

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(201);

      const userResult = await pool.query('SELECT * FROM users WHERE email = $1', ['test@example.com']);
      const user = userResult.rows[0];
      expect(user.profile_slug).toBe('testuser-slug-2');
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in response', async () => {
      const requestBody = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
        username: 'testuser'
      };

      mockCognitoClient.send.mockResolvedValue({
        UserSub: 'cognito-user-id-123',
      });

      const event = createEvent(requestBody);
      const context = createContext();

      const result = await handler(event, context) as APIGatewayProxyResult;

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Headers');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Methods');
    });
  });
});