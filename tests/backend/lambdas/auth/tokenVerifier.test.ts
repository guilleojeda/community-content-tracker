import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import {
  TokenVerificationResult,
  TokenVerificationError,
  CognitoTokenClaims,
  verifyJwtToken,
  verifyJwtTokenWithCache,
  clearTokenCache,
  handleTokenRefresh,
  TokenVerifierConfig
} from '../../../../src/backend/lambdas/auth/tokenVerifier';
import { UserRepository } from '../../../../src/backend/repositories/UserRepository';
import { BadgeType, User, Visibility } from '../../../../src/shared/types';

// Mock dependencies
jest.mock('jsonwebtoken');
jest.mock('../../../../src/backend/repositories/UserRepository');
jest.mock('@aws-sdk/client-cognito-identity-provider');

const mockJwt = jwt as jest.Mocked<typeof jwt>;
const MockUserRepository = UserRepository as jest.MockedClass<typeof UserRepository>;

describe('TokenVerifier Lambda', () => {
  let mockUserRepository: jest.Mocked<UserRepository>;
  let mockPool: jest.Mocked<Pool>;
  let mockCognitoClient: { send: jest.Mock };
  let config: TokenVerifierConfig;

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

  const validClaims: CognitoTokenClaims = {
    sub: 'sub-123',
    'cognito:username': 'testuser',
    email: 'test@example.com',
    email_verified: true,
    aud: 'test-audience',
    iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',
    token_use: 'access',
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    iat: Math.floor(Date.now() / 1000),
    'custom:is_admin': 'false',
    'custom:username': 'testuser',
  };

  beforeEach(() => {
    mockPool = {
      connect: jest.fn(),
      query: jest.fn(),
      end: jest.fn(),
    } as any;

    mockUserRepository = new MockUserRepository(mockPool, 'users') as jest.Mocked<UserRepository>;
    MockUserRepository.mockImplementation(() => mockUserRepository);

    mockCognitoClient = { send: jest.fn() };
    const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
    (CognitoIdentityProviderClient as jest.Mock).mockImplementation(() => mockCognitoClient);

    config = {
      cognitoUserPoolId: 'us-east-1_test',
      cognitoRegion: 'us-east-1',
      allowedAudiences: ['test-audience'],
      issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',
    };

    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('JWT Token Validation', () => {
    test('should successfully verify valid JWT token', async () => {
      // Arrange
      const token = 'valid-jwt-token';
      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        if (typeof callback === 'function') {
          callback(null, validClaims);
        }
        return validClaims;
      });
      mockUserRepository.findByCognitoSub.mockResolvedValue(validUser);

      // Act
      const result = await verifyJwtToken(token, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(true);
      expect(result.user).toEqual(validUser);
      expect(result.claims).toEqual(validClaims);
      expect(result.error).toBeUndefined();
      expect(mockJwt.verify).toHaveBeenCalledWith(
        token,
        expect.any(Function),
        expect.objectContaining({
          audience: config.allowedAudiences,
          issuer: config.issuer,
        }),
        expect.any(Function)
      );
    });

    test('should reject expired JWT token', async () => {
      // Arrange
      const token = 'expired-jwt-token';
      const expiredClaims = {
        ...validClaims,
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      };

      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        if (typeof callback === 'function') {
          const error = new Error('jwt expired') as any;
          error.name = 'TokenExpiredError';
          callback(error, null);
        }
      });

      // Act
      const result = await verifyJwtToken(token, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.user).toBeUndefined();
      expect(result.claims).toBeUndefined();
      expect(result.error).toEqual({
        code: 'AUTH_INVALID',
        message: 'Token has expired',
        details: 'jwt expired',
      });
    });

    test('should reject malformed JWT token', async () => {
      // Arrange
      const token = 'malformed-jwt-token';

      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        if (typeof callback === 'function') {
          const error = new Error('invalid token') as any;
          error.name = 'JsonWebTokenError';
          callback(error, null);
        }
      });

      // Act
      const result = await verifyJwtToken(token, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error).toEqual({
        code: 'AUTH_INVALID',
        message: 'Token is invalid or malformed',
        details: 'invalid token',
      });
    });

    test('should reject token with invalid signature', async () => {
      // Arrange
      const token = 'invalid-signature-token';

      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        if (typeof callback === 'function') {
          const error = new Error('invalid signature') as any;
          error.name = 'JsonWebTokenError';
          callback(error, null);
        }
      });

      // Act
      const result = await verifyJwtToken(token, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error).toEqual({
        code: 'AUTH_INVALID',
        message: 'Token is invalid or malformed',
        details: 'invalid signature',
      });
    });

    test('should reject token with invalid audience', async () => {
      // Arrange
      const token = 'invalid-audience-token';
      const invalidAudienceClaims = {
        ...validClaims,
        aud: 'wrong-audience',
      };

      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        if (typeof callback === 'function') {
          const error = new Error('audience invalid') as any;
          error.name = 'JsonWebTokenError';
          callback(error, null);
        }
      });

      // Act
      const result = await verifyJwtToken(token, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error?.code).toBe('AUTH_INVALID');
    });

    test('should reject token with invalid issuer', async () => {
      // Arrange
      const token = 'invalid-issuer-token';

      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        if (typeof callback === 'function') {
          const error = new Error('issuer invalid') as any;
          error.name = 'JsonWebTokenError';
          callback(error, null);
        }
      });

      // Act
      const result = await verifyJwtToken(token, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error?.code).toBe('AUTH_INVALID');
    });


    test('should handle missing token', async () => {
      // Act
      const result = await verifyJwtToken('', config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error).toEqual({
        code: 'AUTH_REQUIRED',
        message: 'Authentication token is required',
        details: 'No token provided',
      });
    });

    test('should handle null token', async () => {
      // Act
      const result = await verifyJwtToken(null as any, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error?.code).toBe('AUTH_REQUIRED');
    });
  });

  describe('User Context Enrichment', () => {
    test('should enrich context with user data for valid token', async () => {
      // Arrange
      const token = 'valid-jwt-token';
      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        if (typeof callback === 'function') {
          callback(null, validClaims);
        }
      });
      mockUserRepository.findByCognitoSub.mockResolvedValue(validUser);

      // Act
      const result = await verifyJwtToken(token, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(true);
      expect(result.user).toEqual(validUser);
      expect(result.user?.isAdmin).toBe(false);
      expect(result.user?.isAwsEmployee).toBe(false);
    });

    test('should include admin status in context for admin user', async () => {
      // Arrange
      const token = 'admin-jwt-token';
      const adminClaims = {
        ...validClaims,
        sub: 'sub-admin',
        'cognito:username': 'admin',
        email: 'admin@example.com',
        'custom:is_admin': 'true',
        'custom:username': 'admin',
      };

      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        if (typeof callback === 'function') {
          callback(null, adminClaims);
        }
      });
      mockUserRepository.findByCognitoSub.mockResolvedValue(adminUser);

      // Act
      const result = await verifyJwtToken(token, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(true);
      expect(result.user?.isAdmin).toBe(true);
      expect(result.claims).toEqual(adminClaims);
    });

    test('should handle user not found in database', async () => {
      // Arrange
      const token = 'valid-jwt-token';
      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        if (typeof callback === 'function') {
          callback(null, validClaims);
        }
      });
      mockUserRepository.findByCognitoSub.mockResolvedValue(null);

      // Act
      const result = await verifyJwtToken(token, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error).toEqual({
        code: 'AUTH_INVALID',
        message: 'User not found in database',
        details: 'Cognito user exists but not found in application database',
      });
    });

    test('should handle database connection error', async () => {
      // Arrange
      const token = 'valid-jwt-token';
      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        if (typeof callback === 'function') {
          callback(null, validClaims);
        }
      });
      mockUserRepository.findByCognitoSub.mockRejectedValue(new Error('Database connection failed'));

      // Act
      const result = await verifyJwtToken(token, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve user data',
        details: 'Database connection failed',
      });
    });
  });

  describe('Token Claims Validation', () => {
    test('should validate token_use claim', async () => {
      // Arrange
      const token = 'invalid-token-use';
      const invalidClaims = {
        ...validClaims,
        token_use: 'id', // Should be 'access'
      };

      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        if (typeof callback === 'function') {
          callback(null, invalidClaims);
        }
      });

      // Act
      const result = await verifyJwtToken(token, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error?.code).toBe('AUTH_INVALID');
    });

    test('should validate email_verified claim', async () => {
      // Arrange
      const token = 'unverified-email-token';
      const unverifiedClaims = {
        ...validClaims,
        email_verified: false,
      };

      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        if (typeof callback === 'function') {
          callback(null, unverifiedClaims);
        }
      });

      // Act
      const result = await verifyJwtToken(token, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error?.code).toBe('AUTH_INVALID');
    });

    test('should handle missing required claims', async () => {
      // Arrange
      const token = 'missing-claims-token';
      const incompleteClaims = {
        sub: 'sub-123',
        // Missing required claims
      } as any;

      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        if (typeof callback === 'function') {
          callback(null, incompleteClaims);
        }
      });

      // Act
      const result = await verifyJwtToken(token, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error?.code).toBe('AUTH_INVALID');
    });
  });

  describe('Error Handling', () => {
    test('should handle unexpected JWT library errors', async () => {
      // Arrange
      const token = 'error-token';
      mockJwt.verify.mockImplementation(() => {
        throw new Error('Unexpected JWT error');
      });

      // Act
      const result = await verifyJwtToken(token, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error?.code).toBe('INTERNAL_ERROR');
    });

    test('should handle network timeout errors', async () => {
      // Arrange
      const token = 'timeout-token';
      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        // Simulate timeout
        setTimeout(() => {
          if (typeof callback === 'function') {
            const error = new Error('Network timeout') as any;
            error.code = 'ETIMEDOUT';
            callback(error, null);
          }
        }, 100);
      });

      // Act
      const result = await verifyJwtToken(token, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error?.code).toBe('INTERNAL_ERROR');
    });

    test('should handle malformed configuration', async () => {
      // Arrange
      const token = 'valid-token';
      const invalidConfig = {
        ...config,
        issuer: '', // Invalid issuer
      };

      // Act
      const result = await verifyJwtToken(token, invalidConfig, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error?.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('Performance and Edge Cases', () => {
    test('should handle very long tokens', async () => {
      // Arrange
      const veryLongToken = 'a'.repeat(10000);

      // Act
      const result = await verifyJwtToken(veryLongToken, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error?.code).toBe('AUTH_INVALID');
    });

    test('should handle concurrent verification requests', async () => {
      // Arrange
      const token = 'concurrent-token';
      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        setTimeout(() => {
          if (typeof callback === 'function') {
            callback(null, validClaims);
          }
        }, 10);
      });
      mockUserRepository.findByCognitoSub.mockResolvedValue(validUser);

      // Act
      const promises = Array(10).fill(null).map(() =>
        verifyJwtToken(token, config, mockUserRepository)
      );
      const results = await Promise.all(promises);

      // Assert
      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.isValid).toBe(true);
      });
    });

    test('should handle special characters in token', async () => {
      // Arrange
      const tokenWithSpecialChars = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMiLCJuYW1lIjoiVGVzdCDwn5OKIFN1YmplY3QiLCJpYXQiOjE2MzQ2NTU2MDR9.special';

      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        if (typeof callback === 'function') {
          const error = new Error('invalid token format') as any;
          error.name = 'JsonWebTokenError';
          callback(error, null);
        }
      });

      // Act
      const result = await verifyJwtToken(tokenWithSpecialChars, config, mockUserRepository);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error?.code).toBe('AUTH_INVALID');
    });
  });

  describe('Token cache utilities', () => {
    afterEach(() => {
      clearTokenCache();
      mockJwt.verify.mockReset();
      mockUserRepository.findByCognitoSub.mockReset();
    });

    test('should cache successful verification results', async () => {
      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        if (typeof callback === 'function') {
          callback(null, validClaims);
        }
      });
      mockUserRepository.findByCognitoSub.mockResolvedValue(validUser);

      await verifyJwtTokenWithCache('cache-token', config, mockUserRepository);
      await verifyJwtTokenWithCache('cache-token', config, mockUserRepository);

      expect(mockJwt.verify).toHaveBeenCalledTimes(1);
      expect(mockUserRepository.findByCognitoSub).toHaveBeenCalledTimes(1);
    });

    test('should not cache invalid verification responses', async () => {
      mockJwt.verify.mockImplementation((token, secretOrPublicKey, options, callback) => {
        if (typeof callback === 'function') {
          const error = new Error('invalid token') as any;
          error.name = 'JsonWebTokenError';
          callback(error, null);
        }
      });

      await verifyJwtTokenWithCache('bad-token', config, mockUserRepository);
      await verifyJwtTokenWithCache('bad-token', config, mockUserRepository);

      expect(mockJwt.verify).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleTokenRefresh', () => {
    test('should return refreshed tokens from Cognito', async () => {
      mockCognitoClient.send.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'access-token',
          IdToken: 'id-token',
          ExpiresIn: 3600,
        },
      });

      const result = await handleTokenRefresh({
        clientId: 'client-id',
        refreshToken: 'refresh-token',
      });

      expect(result.success).toBe(true);
      expect(result.accessToken).toBe('access-token');
      expect(mockCognitoClient.send).toHaveBeenCalled();
    });

    test('should handle missing authentication result', async () => {
      mockCognitoClient.send.mockResolvedValue({});

      const result = await handleTokenRefresh({
        clientId: 'client-id',
        refreshToken: 'refresh-token',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INTERNAL_ERROR');
    });

    test('should map Cognito errors to INTERNAL_ERROR', async () => {
      mockCognitoClient.send.mockRejectedValue(new Error('Cognito unavailable'));

      const result = await handleTokenRefresh({
        clientId: 'client-id',
        refreshToken: 'refresh-token',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INTERNAL_ERROR');
      expect(result.error?.details).toBe('Cognito unavailable');
    });
  });
});
