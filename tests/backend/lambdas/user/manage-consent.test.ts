import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/user/manage-consent';
import { getDatabasePool } from '../../../../src/backend/services/database';

// Mock database
jest.mock('../../../../src/backend/services/database');

describe('Consent Management Lambda', () => {
  const mockPool = {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
  });

  const createMockEvent = (
    method: string,
    path: string,
    authenticated: boolean = true,
    body: any = null
  ): APIGatewayProxyEvent => ({
    httpMethod: method,
    path,
    headers: {
      'User-Agent': 'test-agent/1.0',
    },
    body: body ? JSON.stringify(body) : null,
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123',
      apiId: 'api-id',
      protocol: 'HTTP/1.1',
      httpMethod: method,
      path,
      stage: 'test',
      requestId: 'request-id',
      requestTimeEpoch: 0,
      resourceId: 'resource-id',
      resourcePath: path,
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '192.168.1.100',
        user: null,
        userAgent: 'test-agent/1.0',
        userArn: null,
      },
      authorizer: authenticated
        ? {
            userId: 'user-123',
            claims: {
              sub: 'user-123',
              'cognito:username': 'testuser',
            },
          }
        : undefined,
    },
    resource: path,
  } as any);

  describe('POST /user/consent - Grant analytics consent', () => {
    it('should grant analytics consent for authenticated user', async () => {
      const event = createMockEvent('POST', '/user/consent', true, {
        consentType: 'analytics',
        granted: true,
        consentVersion: '1.0',
      });

      const mockConsentRecord = {
        user_id: 'user-123',
        consent_type: 'analytics',
        granted: true,
        granted_at: '2025-01-15T10:00:00.000Z',
        revoked_at: null,
        consent_version: '1.0',
        ip_address: '192.168.1.100',
        user_agent: 'test-agent/1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
      };

      mockPool.query.mockResolvedValue({
        rows: [mockConsentRecord],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.message).toBe('Consent granted');
      expect(body.data).toEqual({
        consentType: 'analytics',
        granted: true,
        grantedAt: '2025-01-15T10:00:00.000Z',
        revokedAt: null,
        consentVersion: '1.0',
      });

      // Verify database query was called with correct parameters
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_consent'),
        expect.arrayContaining([
          'user-123',
          'analytics',
          true,
          expect.any(String), // granted_at timestamp
          null, // revoked_at
          '1.0',
          '192.168.1.100',
          'test-agent/1.0',
          expect.any(String), // updated_at timestamp
        ])
      );
    });
  });

  describe('POST /user/consent - Grant functional consent', () => {
    it('should grant functional consent for authenticated user', async () => {
      const event = createMockEvent('POST', '/user/consent', true, {
        consentType: 'functional',
        granted: true,
      });

      const mockConsentRecord = {
        user_id: 'user-123',
        consent_type: 'functional',
        granted: true,
        granted_at: '2025-01-15T10:00:00.000Z',
        revoked_at: null,
        consent_version: '1.0',
        ip_address: '192.168.1.100',
        user_agent: 'test-agent/1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
      };

      mockPool.query.mockResolvedValue({
        rows: [mockConsentRecord],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.consentType).toBe('functional');
      expect(body.data.granted).toBe(true);
    });
  });

  describe('POST /user/consent - Grant marketing consent', () => {
    it('should grant marketing consent for authenticated user', async () => {
      const event = createMockEvent('POST', '/user/consent', true, {
        consentType: 'marketing',
        granted: true,
      });

      const mockConsentRecord = {
        user_id: 'user-123',
        consent_type: 'marketing',
        granted: true,
        granted_at: '2025-01-15T10:00:00.000Z',
        revoked_at: null,
        consent_version: '1.0',
        ip_address: '192.168.1.100',
        user_agent: 'test-agent/1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
      };

      mockPool.query.mockResolvedValue({
        rows: [mockConsentRecord],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.consentType).toBe('marketing');
      expect(body.data.granted).toBe(true);
    });
  });

  describe('POST /user/consent - Revoke consent', () => {
    it('should revoke consent for authenticated user', async () => {
      const event = createMockEvent('POST', '/user/consent', true, {
        consentType: 'analytics',
        granted: false,
      });

      const mockConsentRecord = {
        user_id: 'user-123',
        consent_type: 'analytics',
        granted: false,
        granted_at: '2025-01-15T09:00:00.000Z',
        revoked_at: '2025-01-15T10:00:00.000Z',
        consent_version: '1.0',
        ip_address: '192.168.1.100',
        user_agent: 'test-agent/1.0',
        updated_at: '2025-01-15T10:00:00.000Z',
      };

      mockPool.query.mockResolvedValue({
        rows: [mockConsentRecord],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.message).toBe('Consent revoked');
      expect(body.data).toEqual({
        consentType: 'analytics',
        granted: false,
        grantedAt: '2025-01-15T09:00:00.000Z',
        revokedAt: '2025-01-15T10:00:00.000Z',
        consentVersion: '1.0',
      });

      // Verify revoked_at is set and granted_at is null
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_consent'),
        expect.arrayContaining([
          'user-123',
          'analytics',
          false,
          null, // granted_at
          expect.any(String), // revoked_at timestamp
          '1.0',
          '192.168.1.100',
          'test-agent/1.0',
          expect.any(String), // updated_at timestamp
        ])
      );
    });
  });

  describe('POST /user/consent - Invalid consent type', () => {
    it('should return 400 for invalid consent type', async () => {
      const event = createMockEvent('POST', '/user/consent', true, {
        consentType: 'invalid_type',
        granted: true,
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Invalid consent type');
      expect(body.error.message).toContain('analytics, functional, marketing');

      // Verify database was not called
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should return 400 for missing consent type', async () => {
      const event = createMockEvent('POST', '/user/consent', true, {
        granted: true,
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('POST /user/consent - Missing granted field', () => {
    it('should return 400 when granted field is missing', async () => {
      const event = createMockEvent('POST', '/user/consent', true, {
        consentType: 'analytics',
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('granted must be a boolean');
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should return 400 when granted field is not a boolean', async () => {
      const event = createMockEvent('POST', '/user/consent', true, {
        consentType: 'analytics',
        granted: 'yes',
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('granted must be a boolean');
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('POST /user/consent - Unauthenticated user', () => {
    it('should return 401 when user is not authenticated', async () => {
      const event = createMockEvent('POST', '/user/consent', false, {
        consentType: 'analytics',
        granted: true,
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('AUTH_REQUIRED');
      expect(body.error.message).toBe('Authentication required');
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('GET /user/consent - Get all consent status', () => {
    it('should return all consent status for authenticated user', async () => {
      const event = createMockEvent('GET', '/user/consent', true);

      mockPool.query.mockResolvedValue({
        rows: [
          {
            consent_type: 'analytics',
            granted: true,
            granted_at: '2025-01-15T10:00:00.000Z',
            revoked_at: null,
            consent_version: '1.0',
            updated_at: '2025-01-15T10:00:00.000Z',
          },
          {
            consent_type: 'functional',
            granted: true,
            granted_at: '2025-01-15T09:00:00.000Z',
            revoked_at: null,
            consent_version: '1.0',
            updated_at: '2025-01-15T09:00:00.000Z',
          },
          {
            consent_type: 'marketing',
            granted: false,
            granted_at: '2025-01-14T10:00:00.000Z',
            revoked_at: '2025-01-15T10:00:00.000Z',
            consent_version: '1.0',
            updated_at: '2025-01-15T10:00:00.000Z',
          },
        ],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual({
        analytics: {
          granted: true,
          grantedAt: '2025-01-15T10:00:00.000Z',
          revokedAt: null,
          consentVersion: '1.0',
          updatedAt: '2025-01-15T10:00:00.000Z',
        },
        functional: {
          granted: true,
          grantedAt: '2025-01-15T09:00:00.000Z',
          revokedAt: null,
          consentVersion: '1.0',
          updatedAt: '2025-01-15T09:00:00.000Z',
        },
        marketing: {
          granted: false,
          grantedAt: '2025-01-14T10:00:00.000Z',
          revokedAt: '2025-01-15T10:00:00.000Z',
          consentVersion: '1.0',
          updatedAt: '2025-01-15T10:00:00.000Z',
        },
      });

      // Verify database query
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT consent_type, granted'),
        ['user-123']
      );
    });

    it('should return default consent status when user has no consents', async () => {
      const event = createMockEvent('GET', '/user/consent', true);

      mockPool.query.mockResolvedValue({
        rows: [],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual({
        analytics: { granted: false, grantedAt: null, revokedAt: null },
        functional: { granted: false, grantedAt: null, revokedAt: null },
        marketing: { granted: false, grantedAt: null, revokedAt: null },
      });
    });
  });

  describe('GET /user/consent - Unauthenticated user', () => {
    it('should return 401 when user is not authenticated', async () => {
      const event = createMockEvent('GET', '/user/consent', false);

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('AUTH_REQUIRED');
      expect(body.error.message).toBe('Authentication required');
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('POST /user/consent/check - Check specific consent type', () => {
    it('should return true when user has granted consent', async () => {
      const event = createMockEvent('POST', '/user/consent/check', true, {
        consentType: 'analytics',
      });

      mockPool.query.mockResolvedValue({
        rows: [{ granted: true }],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual({
        hasConsent: true,
        consentType: 'analytics',
        reason: 'consent_granted',
      });

      // Verify database query
      expect(mockPool.query).toHaveBeenCalledWith(expect.any(String), ['user-123', 'analytics']);
    });

    it('should return false when user has not granted consent', async () => {
      const event = createMockEvent('POST', '/user/consent/check', true, {
        consentType: 'marketing',
      });

      mockPool.query.mockResolvedValue({
        rows: [{ granted: false }],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual({
        hasConsent: false,
        consentType: 'marketing',
        reason: 'consent_not_granted',
      });
    });

    it('should return false when consent record does not exist', async () => {
      const event = createMockEvent('POST', '/user/consent/check', true, {
        consentType: 'analytics',
      });

      mockPool.query.mockResolvedValue({
        rows: [],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual({
        hasConsent: false,
        consentType: 'analytics',
        reason: 'consent_not_granted',
      });
    });

    it('should default to analytics consent type when not specified', async () => {
      const event = createMockEvent('POST', '/user/consent/check', true, {});

      mockPool.query.mockResolvedValue({
        rows: [{ granted: true }],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.consentType).toBe('analytics');

      // Verify database query defaults to analytics
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.anything(),
        ['user-123', 'analytics']
      );
    });
  });

  describe('POST /user/consent/check - Anonymous user', () => {
    it('should return false for anonymous user without database query', async () => {
      const event = createMockEvent('POST', '/user/consent/check', false, {
        consentType: 'analytics',
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual({
        hasConsent: false,
        reason: 'anonymous_user',
      });

      // Verify database was not called for anonymous user
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('Database error handling', () => {
    it('should handle database error when managing consent', async () => {
      const event = createMockEvent('POST', '/user/consent', true, {
        consentType: 'analytics',
        granted: true,
      });

      mockPool.query.mockRejectedValue(new Error('Database connection failed'));

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Failed to manage consent');
    });

    it('should handle database error when getting consent', async () => {
      const event = createMockEvent('GET', '/user/consent', true);

      mockPool.query.mockRejectedValue(new Error('Query execution failed'));

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Failed to retrieve consent status');
    });

    it('should handle database error when checking consent', async () => {
      const event = createMockEvent('POST', '/user/consent/check', true, {
        consentType: 'analytics',
      });

      mockPool.query.mockRejectedValue(new Error('Database timeout'));

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Failed to check consent');
    });

    it('should handle malformed JSON body', async () => {
      const event = createMockEvent('POST', '/user/consent', true);
      event.body = '{invalid json}';

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('Route handling', () => {
    it('should return 404 for unknown route', async () => {
      const event = createMockEvent('GET', '/user/consent/unknown', true);

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('Route not found');
    });

    it('should return 404 for unsupported method', async () => {
      const event = createMockEvent('DELETE', '/user/consent', true);

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('User context extraction', () => {
    it('should extract user ID from authorizer.userId', async () => {
      const event = createMockEvent('GET', '/user/consent', true);

      mockPool.query.mockResolvedValue({ rows: [] });

      await handler(event, {} as any);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.anything(),
        ['user-123']
      );
    });

    it('should extract IP address and user agent correctly', async () => {
      const event = createMockEvent('POST', '/user/consent', true, {
        consentType: 'analytics',
        granted: true,
      });

      mockPool.query.mockResolvedValue({
        rows: [
          {
            user_id: 'user-123',
            consent_type: 'analytics',
            granted: true,
            granted_at: '2025-01-15T10:00:00.000Z',
            revoked_at: null,
            consent_version: '1.0',
            ip_address: '192.168.1.100',
            user_agent: 'test-agent/1.0',
            updated_at: '2025-01-15T10:00:00.000Z',
          },
        ],
      });

      await handler(event, {} as any);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining(['192.168.1.100', 'test-agent/1.0'])
      );
    });
  });
});
