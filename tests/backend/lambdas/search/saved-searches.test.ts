import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/search/saved-searches';
import { getDatabasePool } from '../../../../src/backend/services/database';

jest.mock('../../../../src/backend/services/database');

describe('Saved Searches Lambda', () => {
  const mockPool = {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  };

  const mockUserId = 'user-123';
  const mockSearchId = 'search-456';

  beforeEach(() => {
    jest.clearAllMocks();
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
  });

  const createMockEvent = (
    method: string,
    body: any = null,
    pathParams: any = null,
    userId: string | null = mockUserId
  ): APIGatewayProxyEvent => ({
    httpMethod: method,
    path: '/search/saved',
    headers: {},
    body: body ? JSON.stringify(body) : null,
    isBase64Encoded: false,
    pathParameters: pathParams,
    queryStringParameters: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123',
      apiId: 'api-id',
      protocol: 'HTTP/1.1',
      httpMethod: method,
      path: '/search/saved',
      stage: 'test',
      requestId: 'request-id',
      requestTimeEpoch: 0,
      resourceId: 'resource-id',
      resourcePath: '/search/saved',
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
      authorizer: userId ? { userId } : undefined,
    },
    resource: '/search/saved',
  } as any);

  describe('POST /search/saved - Save search', () => {
    it('should save a new search successfully', async () => {
      const event = createMockEvent('POST', {
        name: 'My AWS Search',
        query: 'AWS Lambda',
        filters: { contentType: 'blog' },
        isPublic: false,
      });

      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: mockSearchId,
            user_id: mockUserId,
            name: 'My AWS Search',
            query: 'AWS Lambda',
            filters: { contentType: 'blog' },
            is_public: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('My AWS Search');
      expect(body.data.query).toBe('AWS Lambda');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO saved_searches'),
        expect.arrayContaining([mockUserId, 'My AWS Search', 'AWS Lambda'])
      );
    });

    it('should return 400 if name is missing', async () => {
      const event = createMockEvent('POST', {
        query: 'AWS Lambda',
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Name and query are required');
    });

    it('should return 400 if query is missing', async () => {
      const event = createMockEvent('POST', {
        name: 'My Search',
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Name and query are required');
    });

    it('should return 400 if name exceeds 255 characters', async () => {
      const event = createMockEvent('POST', {
        name: 'a'.repeat(256),
        query: 'AWS Lambda',
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('255 characters');
    });

    it('should return 401 if user is not authenticated', async () => {
      const event = createMockEvent('POST', {
        name: 'My Search',
        query: 'AWS Lambda',
      }, null, null);

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('AUTH_REQUIRED');
    });
  });

  describe('GET /search/saved - List saved searches', () => {
    it('should list all saved searches for user', async () => {
      const event = createMockEvent('GET');

      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: 'search-1',
            user_id: mockUserId,
            name: 'Search 1',
            query: 'AWS',
            filters: {},
            is_public: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 'search-2',
            user_id: mockUserId,
            name: 'Search 2',
            query: 'Lambda',
            filters: {},
            is_public: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.searches).toHaveLength(2);
      expect(body.data.count).toBe(2);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [mockUserId]
      );
    });

    it('should return empty array if user has no saved searches', async () => {
      const event = createMockEvent('GET');

      mockPool.query.mockResolvedValue({
        rows: [],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.searches).toHaveLength(0);
      expect(body.data.count).toBe(0);
    });
  });

  describe('GET /search/saved/:id - Get specific saved search', () => {
    it('should get saved search by id if user owns it', async () => {
      const event = createMockEvent('GET', null, { id: mockSearchId });

      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: mockSearchId,
            user_id: mockUserId,
            name: 'My Search',
            query: 'AWS Lambda',
            filters: {},
            is_public: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(mockSearchId);
      expect(body.data.name).toBe('My Search');
    });

    it('should return 404 if search does not exist', async () => {
      const event = createMockEvent('GET', null, { id: 'non-existent' });

      mockPool.query.mockResolvedValue({
        rows: [],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 403 if user does not own private search', async () => {
      const event = createMockEvent('GET', null, { id: mockSearchId });

      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: mockSearchId,
            user_id: 'other-user',
            name: 'Other User Search',
            query: 'AWS',
            filters: {},
            is_public: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
    });

    it('should allow access to public search from other users', async () => {
      const event = createMockEvent('GET', null, { id: mockSearchId });

      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: mockSearchId,
            user_id: 'other-user',
            name: 'Public Search',
            query: 'AWS',
            filters: {},
            is_public: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.isPublic).toBe(true);
    });
  });

  describe('PUT /search/saved/:id - Update saved search', () => {
    it('should update saved search successfully', async () => {
      const event = createMockEvent('PUT', {
        name: 'Updated Search',
        query: 'Updated Query',
      }, { id: mockSearchId });

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ user_id: mockUserId }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: mockSearchId,
              user_id: mockUserId,
              name: 'Updated Search',
              query: 'Updated Query',
              filters: {},
              is_public: false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Updated Search');
      expect(body.data.query).toBe('Updated Query');
    });

    it('should return 404 if search does not exist', async () => {
      const event = createMockEvent('PUT', {
        name: 'Updated Search',
      }, { id: 'non-existent' });

      mockPool.query.mockResolvedValue({
        rows: [],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 403 if user does not own the search', async () => {
      const event = createMockEvent('PUT', {
        name: 'Updated Search',
      }, { id: mockSearchId });

      mockPool.query.mockResolvedValue({
        rows: [{ user_id: 'other-user' }],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
    });

    it('should return 400 if no fields provided for update', async () => {
      const event = createMockEvent('PUT', {}, { id: mockSearchId });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /search/saved/:id - Delete saved search', () => {
    it('should delete saved search successfully', async () => {
      const event = createMockEvent('DELETE', null, { id: mockSearchId });

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ user_id: mockUserId }],
        })
        .mockResolvedValueOnce({
          rows: [],
        });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.message).toContain('deleted successfully');
    });

    it('should return 404 if search does not exist', async () => {
      const event = createMockEvent('DELETE', null, { id: 'non-existent' });

      mockPool.query.mockResolvedValue({
        rows: [],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 403 if user does not own the search', async () => {
      const event = createMockEvent('DELETE', null, { id: mockSearchId });

      mockPool.query.mockResolvedValue({
        rows: [{ user_id: 'other-user' }],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      const event = createMockEvent('GET');

      mockPool.query.mockRejectedValue(new Error('Database error'));

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should return 401 for all operations without authentication', async () => {
      const methods = ['POST', 'GET', 'PUT', 'DELETE'];

      for (const method of methods) {
        const event = createMockEvent(method, null, null, null);
        const response = await handler(event, {} as any);

        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.body);
        expect(body.error.code).toBe('AUTH_REQUIRED');
      }
    });
  });
});
