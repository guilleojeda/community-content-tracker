import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/admin/user-management';
import { getDatabasePool } from '../../../../src/backend/services/database';
import { BadgeType } from '@aws-community-hub/shared';

jest.mock('../../../../src/backend/services/database');

describe('Admin User Management Lambda', () => {
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
    isAdmin: boolean = true,
    path: string = '/admin/users',
    method: string = 'GET',
    body: any = null,
    queryParams: any = null
  ): APIGatewayProxyEvent => ({
    httpMethod: method,
    path,
    headers: {},
    body: body ? JSON.stringify(body) : null,
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters: queryParams,
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
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: 'test-agent',
        userArn: null,
      },
      authorizer: {
        isAdmin: isAdmin,
        userId: 'admin-123',
        claims: {
          sub: 'admin-123',
          'cognito:groups': isAdmin ? 'Admin' : 'User',
        },
      },
    },
    resource: path,
  } as any);

  describe('GET /admin/users', () => {
    it('should return paginated user list with filters', async () => {
      const event = createMockEvent(true, '/admin/users', 'GET', null, {
        search: 'john',
        badgeType: BadgeType.HERO,
        limit: '20',
        offset: '0',
      });

      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'user-1',
              username: 'john_doe',
              email: 'john@example.com',
              is_admin: false,
              is_aws_employee: false,
              created_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ count: 1 }],
        });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.users).toHaveLength(1);
      expect(body.data.total).toBe(1);
      expect(body.data.users[0].username).toBe('john_doe');
    });

    it('should return 403 when user is not admin', async () => {
      const event = createMockEvent(false, '/admin/users', 'GET');

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('GET /admin/users/:id', () => {
    it('should return user details with badges and content stats', async () => {
      const event = createMockEvent(true, '/admin/users/user-123', 'GET');
      event.pathParameters = { id: 'user-123' };

      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'user-123',
              username: 'john_doe',
              email: 'john@example.com',
              is_admin: false,
              is_aws_employee: true,
              created_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { badge_type: BadgeType.HERO, awarded_at: new Date() },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ content_count: 25 }],
        });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.user.id).toBe('user-123');
      expect(body.data.badges).toHaveLength(1);
      expect(body.data.contentCount).toBe(25);
    });

    it('should return 404 when user not found', async () => {
      const event = createMockEvent(true, '/admin/users/nonexistent', 'GET');
      event.pathParameters = { id: 'nonexistent' };

      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /admin/users/export', () => {
    it('should export user list as CSV', async () => {
      const event = createMockEvent(true, '/admin/users/export', 'POST');

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'user-1',
            username: 'john_doe',
            email: 'john@example.com',
            is_admin: false,
            is_aws_employee: true,
            created_at: new Date(),
          },
        ],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      expect(response.headers?.['Content-Type']).toBe('text/csv');
      expect(response.body).toContain('ID,Username,Email');
      expect(response.body).toContain('john_doe');
    });
  });
});
