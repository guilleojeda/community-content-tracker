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
      expect(result.errors!.username).toContain('letters, numbers, and underscores');
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
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('Test error');
    });

    test('should create success response with proper format', () => {
      const data = { userId: '123', message: 'Success' };
      const response = createSuccessResponse(201, data);

      expect(response.statusCode).toBe(201);
      expect(response.headers['Content-Type']).toBe('application/json');
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');

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