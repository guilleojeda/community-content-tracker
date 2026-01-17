import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Pool } from 'pg';
import {
  handler as authorizerHandler,
  AuthorizerEvent,
  AuthorizerResult,
  AuthorizerContext,
  AuthorizerConfig,
  UserContextEnriched
} from '../../../../src/backend/lambdas/auth/authorizer';
import {
  PolicyDocument,
  RateLimitInfo
} from '../../../../src/backend/lambdas/auth/utils';
import { UserRepository } from '../../../../src/backend/repositories/UserRepository';
import { BadgeType, User, Visibility } from '../../../../src/shared/types';
import * as tokenVerifier from '../../../../src/backend/lambdas/auth/tokenVerifier';
import * as authUtils from '../../../../src/backend/lambdas/auth/utils';
import * as database from '../../../../src/backend/services/database';

// Mock dependencies
jest.mock('../../../../src/backend/repositories/UserRepository');
jest.mock('../../../../src/backend/lambdas/auth/tokenVerifier');
jest.mock('../../../../src/backend/lambdas/auth/utils');
jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn(),
  setTestDatabasePool: jest.fn(),
  closeDatabasePool: jest.fn(),
  resetDatabaseCache: jest.fn(),
}));
jest.mock('pg');

const mockTokenVerifier = tokenVerifier as jest.Mocked<typeof tokenVerifier>;
const mockAuthUtils = authUtils as jest.Mocked<typeof authUtils>;
const MockUserRepository = UserRepository as jest.MockedClass<typeof UserRepository>;
const mockDatabase = database as jest.Mocked<typeof database>;

describe('API Gateway Authorizer Lambda', () => {
  let mockUserRepository: jest.Mocked<UserRepository>;
  let mockPool: jest.Mocked<Pool>;
  const actualAuthUtils = jest.requireActual('../../../../src/backend/lambdas/auth/utils');

  const validUser: User = {
    id: 'user-123',
    cognitoSub: 'sub-123',
    email: 'test@example.com',
    username: 'testuser',
    profileSlug: 'testuser',
    defaultVisibility: Visibility.PRIVATE,
    isAdmin: false,
    isAwsEmployee: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const adminUser: User = {
    ...validUser,
    id: 'admin-456',
    cognitoSub: 'sub-admin',
    email: 'admin@example.com',
    username: 'admin',
    profileSlug: 'admin',
    isAdmin: true,
  };

  const mockUserBadges = [
    { badgeType: BadgeType.COMMUNITY_BUILDER, earnedAt: new Date() },
    { badgeType: BadgeType.AMBASSADOR, earnedAt: new Date() },
  ];

  const validAuthorizerEvent: AuthorizerEvent = {
    type: 'REQUEST',
    methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/test/GET/resource',
    resource: '/resource',
    path: '/resource',
    httpMethod: 'GET',
    headers: {
      Authorization: 'Bearer valid-jwt-token',
    },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      resourceId: 'test',
      resourcePath: '/resource',
      httpMethod: 'GET',
      extendedRequestId: 'test-request-id',
      requestTime: '1234567890',
      path: '/test/resource',
      accountId: '123456789012',
      protocol: 'HTTP/1.1',
      stage: 'test',
      domainPrefix: 'abcdef123',
      requestTimeEpoch: 1234567890,
      requestId: 'test-request-id',
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
        userArn: null,
        userAgent: 'test-user-agent',
        user: null,
      },
      domainName: 'abcdef123.execute-api.us-east-1.amazonaws.com',
      apiId: 'abcdef123',
    },
    body: null,
    isBase64Encoded: false,
  };

  const adminOnlyEvent: AuthorizerEvent = {
    ...validAuthorizerEvent,
    resource: '/admin/users',
    path: '/admin/users',
    requestContext: {
      ...validAuthorizerEvent.requestContext,
      resourcePath: '/admin/users',
      path: '/test/admin/users',
    },
  };

  beforeEach(() => {
    mockPool = {
      connect: jest.fn(),
      query: jest.fn(),
      end: jest.fn(),
    } as any;

    mockUserRepository = new MockUserRepository(mockPool) as jest.Mocked<UserRepository>;
    MockUserRepository.mockImplementation(() => mockUserRepository);

    // Mock database pool
    mockDatabase.getDatabasePool.mockResolvedValue(mockPool);

    // Reset all mocks
    jest.clearAllMocks();

    // Setup default mock implementations
    mockAuthUtils.extractTokenFromHeader.mockImplementation((authHeader: string | undefined) => {
      if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
      }
      return null;
    });

    mockAuthUtils.isAdminOnlyEndpoint.mockImplementation((resource: string) => {
      return resource.startsWith('/admin/');
    });

    mockAuthUtils.checkRateLimit.mockResolvedValue({
      allowed: true,
      remainingRequests: 100,
      resetTime: Date.now() + 3600000,
    });

    mockAuthUtils.getUserBadges.mockResolvedValue(mockUserBadges);
    mockAuthUtils.validateMethodArn.mockImplementation(actualAuthUtils.validateMethodArn);
    mockAuthUtils.generatePolicyDocument.mockImplementation(actualAuthUtils.generatePolicyDocument);
    mockAuthUtils.logSecurityEvent.mockImplementation(actualAuthUtils.logSecurityEvent);
    mockAuthUtils.detectSuspiciousActivity.mockImplementation(actualAuthUtils.detectSuspiciousActivity);

    // Default environment variables
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_test';
    process.env.COGNITO_REGION = 'us-east-1';
    process.env.ALLOWED_AUDIENCES = 'test-audience';
    process.env.RATE_LIMIT_PER_HOUR = '1000';
  });

  afterEach(() => {
    jest.resetAllMocks();
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_REGION;
    delete process.env.ALLOWED_AUDIENCES;
    delete process.env.RATE_LIMIT_PER_HOUR;
  });

  describe('Token Extraction and Validation', () => {
    test('should successfully authorize valid JWT token', async () => {
      // Arrange
      mockTokenVerifier.verifyJwtToken.mockResolvedValue({
        isValid: true,
        user: validUser,
        claims: {
          sub: 'sub-123',
          'cognito:username': 'testuser',
          email: 'test@example.com',
          email_verified: true,
          aud: 'test-audience',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',
          token_use: 'access',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          'custom:is_admin': 'false',
          'custom:username': 'testuser',
        },
      });

      // Act
      const result = await authorizerHandler(validAuthorizerEvent);

      // Assert
      expect(result.principalId).toBe('user-123');
      expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
      expect(result.context.userId).toBe('user-123');
      expect(result.context.username).toBe('testuser');
      expect(result.context.isAdmin).toBe('false');
      expect(result.context.badges).toBe(JSON.stringify(mockUserBadges));
    });

    test('should deny access for invalid token', async () => {
      // Arrange
      mockTokenVerifier.verifyJwtToken.mockResolvedValue({
        isValid: false,
        error: {
          code: 'AUTH_INVALID',
          message: 'Token is invalid',
          details: 'Invalid signature',
        },
      });

      // Act
      const result = await authorizerHandler(validAuthorizerEvent);

      // Assert
      expect(result.principalId).toBe('unauthorized');
      expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
      expect(result.context.error).toBe('AUTH_INVALID');
    });

    test('should handle missing Authorization header', async () => {
      // Arrange
      const eventWithoutAuth = {
        ...validAuthorizerEvent,
        headers: {},
      };
      mockAuthUtils.extractTokenFromHeader.mockReturnValue(null);

      // Act
      const result = await authorizerHandler(eventWithoutAuth);

      // Assert
      expect(result.principalId).toBe('unauthorized');
      expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
      expect(result.context.error).toBe('AUTH_REQUIRED');
    });

    test('should handle malformed Authorization header', async () => {
      // Arrange
      const eventWithMalformedAuth = {
        ...validAuthorizerEvent,
        headers: {
          Authorization: 'Basic invalid-token',
        },
      };
      mockAuthUtils.extractTokenFromHeader.mockReturnValue(null);

      // Act
      const result = await authorizerHandler(eventWithMalformedAuth);

      // Assert
      expect(result.principalId).toBe('unauthorized');
      expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
      expect(result.context.error).toBe('AUTH_REQUIRED');
    });
  });

  describe('Admin Status and Context Enrichment', () => {
    test('should include admin status in context for admin user', async () => {
      // Arrange
      const adminEvent = {
        ...validAuthorizerEvent,
        headers: {
          Authorization: 'Bearer admin-jwt-token',
        },
      };

      mockTokenVerifier.verifyJwtToken.mockResolvedValue({
        isValid: true,
        user: adminUser,
        claims: {
          sub: 'sub-admin',
          'cognito:username': 'admin',
          email: 'admin@example.com',
          email_verified: true,
          aud: 'test-audience',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',
          token_use: 'access',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          'custom:is_admin': 'true',
          'custom:username': 'admin',
        },
      });

      // Act
      const result = await authorizerHandler(adminEvent);

      // Assert
      expect(result.principalId).toBe('admin-456');
      expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
      expect(result.context.userId).toBe('admin-456');
      expect(result.context.username).toBe('admin');
      expect(result.context.isAdmin).toBe('true');
      expect(result.context.isAwsEmployee).toBe('false');
    });

    test('should enrich context with user badges', async () => {
      // Arrange
      mockTokenVerifier.verifyJwtToken.mockResolvedValue({
        isValid: true,
        user: validUser,
        claims: {
          sub: 'sub-123',
          'cognito:username': 'testuser',
          email: 'test@example.com',
          email_verified: true,
          aud: 'test-audience',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',
          token_use: 'access',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          'custom:is_admin': 'false',
          'custom:username': 'testuser',
        },
      });

      // Act
      const result = await authorizerHandler(validAuthorizerEvent);

      // Assert
      expect(result.context.badges).toBe(JSON.stringify(mockUserBadges));
      expect(mockAuthUtils.getUserBadges).toHaveBeenCalledWith('user-123', mockUserRepository);
    });

    test('should handle badge retrieval failure gracefully', async () => {
      // Arrange
      mockTokenVerifier.verifyJwtToken.mockResolvedValue({
        isValid: true,
        user: validUser,
        claims: {
          sub: 'sub-123',
          'cognito:username': 'testuser',
          email: 'test@example.com',
          email_verified: true,
          aud: 'test-audience',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',
          token_use: 'access',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          'custom:is_admin': 'false',
          'custom:username': 'testuser',
        },
      });

      mockAuthUtils.getUserBadges.mockRejectedValue(new Error('Badge service unavailable'));

      // Act
      const result = await authorizerHandler(validAuthorizerEvent);

      // Assert
      expect(result.principalId).toBe('user-123');
      expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
      expect(result.context.badges).toBe('[]'); // Empty array as fallback
    });
  });

  describe('Admin-Only Endpoint Protection', () => {
    test('should allow admin access to admin-only endpoints', async () => {
      // Arrange
      mockTokenVerifier.verifyJwtToken.mockResolvedValue({
        isValid: true,
        user: adminUser,
        claims: {
          sub: 'sub-admin',
          'cognito:username': 'admin',
          email: 'admin@example.com',
          email_verified: true,
          aud: 'test-audience',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',
          token_use: 'access',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          'custom:is_admin': 'true',
          'custom:username': 'admin',
        },
      });

      // Act
      const result = await authorizerHandler(adminOnlyEvent);

      // Assert
      expect(result.principalId).toBe('admin-456');
      expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
      expect(mockAuthUtils.isAdminOnlyEndpoint).toHaveBeenCalledWith('/admin/users');
    });

    test('should deny non-admin access to admin-only endpoints', async () => {
      // Arrange
      mockTokenVerifier.verifyJwtToken.mockResolvedValue({
        isValid: true,
        user: validUser,
        claims: {
          sub: 'sub-123',
          'cognito:username': 'testuser',
          email: 'test@example.com',
          email_verified: true,
          aud: 'test-audience',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',
          token_use: 'access',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          'custom:is_admin': 'false',
          'custom:username': 'testuser',
        },
      });

      // Act
      const result = await authorizerHandler(adminOnlyEvent);

      // Assert
      expect(result.principalId).toBe('unauthorized');
      expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
      expect(result.context.error).toBe('PERMISSION_DENIED');
    });
  });

  describe('Rate Limiting', () => {
    test('should allow requests within rate limit', async () => {
      // Arrange
      mockTokenVerifier.verifyJwtToken.mockResolvedValue({
        isValid: true,
        user: validUser,
        claims: {
          sub: 'sub-123',
          'cognito:username': 'testuser',
          email: 'test@example.com',
          email_verified: true,
          aud: 'test-audience',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',
          token_use: 'access',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          'custom:is_admin': 'false',
          'custom:username': 'testuser',
        },
      });

      mockAuthUtils.checkRateLimit.mockResolvedValue({
        allowed: true,
        remainingRequests: 95,
        resetTime: Date.now() + 3600000,
      });

      // Act
      const result = await authorizerHandler(validAuthorizerEvent);

      // Assert
      expect(result.principalId).toBe('user-123');
      expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
      expect(result.context.rateLimitRemaining).toBe('95');
      expect(mockAuthUtils.checkRateLimit).toHaveBeenCalledWith('user-123', 1000, 60_000);
    });

    test('should deny requests exceeding rate limit', async () => {
      // Arrange
      mockTokenVerifier.verifyJwtToken.mockResolvedValue({
        isValid: true,
        user: validUser,
        claims: {
          sub: 'sub-123',
          'cognito:username': 'testuser',
          email: 'test@example.com',
          email_verified: true,
          aud: 'test-audience',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',
          token_use: 'access',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          'custom:is_admin': 'false',
          'custom:username': 'testuser',
        },
      });

      mockAuthUtils.checkRateLimit.mockResolvedValue({
        allowed: false,
        remainingRequests: 0,
        resetTime: Date.now() + 3600000,
      });

      // Act
      const result = await authorizerHandler(validAuthorizerEvent);

      // Assert
      expect(result.principalId).toBe('unauthorized');
      expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
      expect(result.context.error).toBe('RATE_LIMITED');
      expect(result.context.rateLimitRemaining).toBe('0');
    });

    test('should handle rate limit service failure gracefully', async () => {
      // Arrange
      mockTokenVerifier.verifyJwtToken.mockResolvedValue({
        isValid: true,
        user: validUser,
        claims: {
          sub: 'sub-123',
          'cognito:username': 'testuser',
          email: 'test@example.com',
          email_verified: true,
          aud: 'test-audience',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',
          token_use: 'access',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          'custom:is_admin': 'false',
          'custom:username': 'testuser',
        },
      });

      mockAuthUtils.checkRateLimit.mockRejectedValue(new Error('Rate limit service unavailable'));

      // Act
      const result = await authorizerHandler(validAuthorizerEvent);

      // Assert
      expect(result.principalId).toBe('user-123');
      expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
      expect(result.context.rateLimitRemaining).toBeUndefined();
    });
  });

  describe('Policy Document Generation', () => {
    test('should generate allow policy for authorized user', async () => {
      // Arrange
      mockTokenVerifier.verifyJwtToken.mockResolvedValue({
        isValid: true,
        user: validUser,
        claims: {
          sub: 'sub-123',
          'cognito:username': 'testuser',
          email: 'test@example.com',
          email_verified: true,
          aud: 'test-audience',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',
          token_use: 'access',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          'custom:is_admin': 'false',
          'custom:username': 'testuser',
        },
      });

      // Act
      const result = await authorizerHandler(validAuthorizerEvent);

      // Assert
      expect(result.policyDocument).toEqual({
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/*/*',
          },
        ],
      });
    });

    test('should generate deny policy for unauthorized user', async () => {
      // Arrange
      mockTokenVerifier.verifyJwtToken.mockResolvedValue({
        isValid: false,
        error: {
          code: 'AUTH_INVALID',
          message: 'Token has expired',
          details: 'jwt expired',
        },
      });

      // Act
      const result = await authorizerHandler(validAuthorizerEvent);

      // Assert
      expect(result.policyDocument).toEqual({
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Deny',
            Resource: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/*/*',
          },
        ],
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle token verification service failure', async () => {
      // Arrange
      mockTokenVerifier.verifyJwtToken.mockRejectedValue(new Error('Token verification service unavailable'));

      // Act
      const result = await authorizerHandler(validAuthorizerEvent);

      // Assert
      expect(result.principalId).toBe('unauthorized');
      expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
      expect(result.context.error).toBe('INTERNAL_ERROR');
    });

    test('should handle database connection failure', async () => {
      // Arrange
      mockTokenVerifier.verifyJwtToken.mockResolvedValue({
        isValid: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve user data',
          details: 'Connection timeout',
        },
      });

      // Act
      const result = await authorizerHandler(validAuthorizerEvent);

      // Assert
      expect(result.principalId).toBe('unauthorized');
      expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
      expect(result.context.error).toBe('INTERNAL_ERROR');
    });

    test('should handle missing environment variables', async () => {
      // Arrange
      delete process.env.COGNITO_USER_POOL_ID;

      // Act
      const result = await authorizerHandler(validAuthorizerEvent);

      // Assert
      expect(result.principalId).toBe('unauthorized');
      expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
      expect(result.context.error).toBe('INTERNAL_ERROR');
    });

    test('should handle malformed method ARN', async () => {
      // Arrange
      const eventWithMalformedArn = {
        ...validAuthorizerEvent,
        methodArn: 'invalid-arn-format',
      };

      // Act
      const result = await authorizerHandler(eventWithMalformedArn);

      // Assert
      expect(result.principalId).toBe('unauthorized');
      expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
      expect(result.context.error).toBe('INTERNAL_ERROR');
    });
  });

  describe('Context Serialization', () => {
    test('should properly serialize context values', async () => {
      // Arrange
      const userWithAwsEmployee: User = {
        ...validUser,
        isAwsEmployee: true,
      };

      mockTokenVerifier.verifyJwtToken.mockResolvedValue({
        isValid: true,
        user: userWithAwsEmployee,
        claims: {
          sub: 'sub-123',
          'cognito:username': 'testuser',
          email: 'test@example.com',
          email_verified: true,
          aud: 'test-audience',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',
          token_use: 'access',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          'custom:is_admin': 'false',
          'custom:username': 'testuser',
        },
      });

      // Act
      const result = await authorizerHandler(validAuthorizerEvent);

      // Assert
      expect(typeof result.context.isAdmin).toBe('string');
      expect(typeof result.context.isAwsEmployee).toBe('string');
      expect(typeof result.context.badges).toBe('string');
      expect(result.context.isAdmin).toBe('false');
      expect(result.context.isAwsEmployee).toBe('true');
    });
  });

  describe('Performance and Concurrent Requests', () => {
    test('should handle multiple concurrent authorization requests', async () => {
      // Arrange
      mockTokenVerifier.verifyJwtToken.mockResolvedValue({
        isValid: true,
        user: validUser,
        claims: {
          sub: 'sub-123',
          'cognito:username': 'testuser',
          email: 'test@example.com',
          email_verified: true,
          aud: 'test-audience',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',
          token_use: 'access',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          'custom:is_admin': 'false',
          'custom:username': 'testuser',
        },
      });

      // Act
      const promises = Array(10).fill(null).map(() =>
        authorizerHandler(validAuthorizerEvent)
      );
      const results = await Promise.all(promises);

      // Assert
      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.principalId).toBe('user-123');
        expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
      });
    });

    test('should handle authorization timeout gracefully', async () => {
      // Arrange
      mockTokenVerifier.verifyJwtToken.mockImplementation(() =>
        new Promise(resolve => {
          setTimeout(() => {
            resolve({
              isValid: false,
              error: {
                code: 'INTERNAL_ERROR',
                message: 'Authorization timeout',
                details: 'Request took too long',
              },
            });
          }, 5000); // 5 second timeout
        })
      );

      // Act
      const startTime = Date.now();
      const result = await authorizerHandler(validAuthorizerEvent);
      const duration = Date.now() - startTime;

      // Assert
      expect(duration).toBeLessThan(5000); // Should timeout before 5 seconds
      expect(result.principalId).toBe('unauthorized');
      expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
    });
  });
});
