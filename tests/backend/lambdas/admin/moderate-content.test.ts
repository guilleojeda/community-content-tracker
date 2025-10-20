import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/admin/moderate-content';
import { getDatabasePool } from '../../../../src/backend/services/database';

// Mock database
jest.mock('../../../../src/backend/services/database');

describe('Content Moderation Lambda', () => {
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
    method: string = 'GET',
    path: string = '/admin/content/flagged',
    pathParameters: any = null,
    body: any = null
  ): APIGatewayProxyEvent =>
    ({
      httpMethod: method,
      path,
      headers: {},
      body: body ? JSON.stringify(body) : null,
      isBase64Encoded: false,
      pathParameters,
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

  describe('GET /admin/content/flagged', () => {
    it('should list flagged content when user is admin', async () => {
      const event = createMockEvent(true, 'GET', '/admin/content/flagged');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'content-1',
              title: 'Flagged Content',
              description: 'This content was flagged',
              content_type: 'blog',
              visibility: 'public',
              is_flagged: true,
              flagged_at: new Date('2024-01-15T10:00:00Z'),
              flag_reason: 'Inappropriate content',
              moderation_status: 'flagged',
              created_at: new Date('2024-01-01T00:00:00Z'),
              user_id: 'user-1',
              username: 'testuser',
              email: 'test@example.com',
              flagged_by_username: 'adminuser',
              urls: ['https://example.com/blog'],
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ count: '1' }],
        });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.content).toHaveLength(1);
      expect(body.data.content[0].title).toBe('Flagged Content');
      expect(body.data.content[0].isFlagged).toBe(true);
      expect(body.data.content[0].flagReason).toBe('Inappropriate content');
      expect(body.data.content[0].user.username).toBe('testuser');
      expect(body.data.content[0].flaggedBy).toBe('adminuser');
      expect(body.data.total).toBe(1);
    });

    it('should return empty list when no flagged content exists', async () => {
      const event = createMockEvent(true, 'GET', '/admin/content/flagged');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [],
        })
        .mockResolvedValueOnce({
          rows: [{ count: '0' }],
        });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.content).toHaveLength(0);
      expect(body.data.total).toBe(0);
    });

    it('should return 403 when user is not admin', async () => {
      const event = createMockEvent(false, 'GET', '/admin/content/flagged');

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
    });

    it('should handle database errors gracefully', async () => {
      const event = createMockEvent(true, 'GET', '/admin/content/flagged');
      mockPool.query.mockRejectedValue(new Error('Database connection failed'));

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('PUT /admin/content/:id/flag', () => {
    it('should flag content when user is admin', async () => {
      const event = createMockEvent(
        true,
        'PUT',
        '/admin/content/content-1/flag',
        { id: 'content-1' },
        { reason: 'Spam content' }
      );

      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'content-1',
              title: 'Test Content',
              is_flagged: false,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'content-1' }],
        })
        .mockResolvedValueOnce({
          rows: [],
        });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.message).toBe('Content flagged successfully');
      expect(body.data.contentId).toBe('content-1');

      // Verify flag query was called with correct parameters
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('is_flagged = true'),
        ['admin-123', 'Spam content', 'content-1']
      );
    });

    it('should return 404 when content does not exist', async () => {
      const event = createMockEvent(
        true,
        'PUT',
        '/admin/content/nonexistent/flag',
        { id: 'nonexistent' },
        { reason: 'Test' }
      );

      mockPool.query.mockResolvedValueOnce({
        rows: [],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 403 when user is not admin', async () => {
      const event = createMockEvent(
        false,
        'PUT',
        '/admin/content/content-1/flag',
        { id: 'content-1' },
        { reason: 'Test' }
      );

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
    });

    it('should use default reason when none provided', async () => {
      const event = createMockEvent(
        true,
        'PUT',
        '/admin/content/content-1/flag',
        { id: 'content-1' },
        {}
      );

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ id: 'content-1', title: 'Test', is_flagged: false }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'content-1' }],
        })
        .mockResolvedValueOnce({
          rows: [],
        });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('is_flagged = true'),
        ['admin-123', 'No reason provided', 'content-1']
      );
    });
  });

  describe('PUT /admin/content/:id/moderate', () => {
    it('should approve content when action is approve', async () => {
      const event = createMockEvent(
        true,
        'PUT',
        '/admin/content/content-1/moderate',
        { id: 'content-1' },
        { action: 'approve', reason: 'Content is acceptable' }
      );

      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'content-1',
              title: 'Test Content',
              moderation_status: 'flagged',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'content-1' }],
        })
        .mockResolvedValueOnce({
          rows: [],
        });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.message).toBe('Content approved successfully');
      expect(body.data.action).toBe('approve');

      // Verify update query was called with approved status
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('moderation_status = $1'),
        ['approved', 'admin-123', 'content-1']
      );
    });

    it('should remove content when action is remove', async () => {
      const event = createMockEvent(
        true,
        'PUT',
        '/admin/content/content-1/moderate',
        { id: 'content-1' },
        { action: 'remove', reason: 'Violates guidelines' }
      );

      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'content-1',
              title: 'Test Content',
              moderation_status: 'flagged',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'content-1' }],
        })
        .mockResolvedValueOnce({
          rows: [],
        });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.message).toBe('Content removed successfully');
      expect(body.data.action).toBe('remove');

      // Verify update query was called with removed status
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('moderation_status = $1'),
        ['removed', 'admin-123', 'content-1']
      );
    });

    it('should return 400 when action is invalid', async () => {
      const event = createMockEvent(
        true,
        'PUT',
        '/admin/content/content-1/moderate',
        { id: 'content-1' },
        { action: 'invalid' }
      );

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('approve');
    });

    it('should return 404 when content does not exist', async () => {
      const event = createMockEvent(
        true,
        'PUT',
        '/admin/content/nonexistent/moderate',
        { id: 'nonexistent' },
        { action: 'approve' }
      );

      mockPool.query.mockResolvedValueOnce({
        rows: [],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 403 when user is not admin', async () => {
      const event = createMockEvent(
        false,
        'PUT',
        '/admin/content/content-1/moderate',
        { id: 'content-1' },
        { action: 'approve' }
      );

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('DELETE /admin/content/:id', () => {
    it('should soft delete content when user is admin', async () => {
      const event = createMockEvent(
        true,
        'DELETE',
        '/admin/content/content-1',
        { id: 'content-1' },
        { reason: 'Permanent removal' }
      );

      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'content-1',
              title: 'Test Content',
              deleted_at: null,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'content-1' }],
        })
        .mockResolvedValueOnce({
          rows: [],
        })
        .mockResolvedValueOnce({
          rows: [],
        });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.message).toBe('Content deleted successfully');
      expect(body.data.contentId).toBe('content-1');

      // Verify soft delete query was called
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('deleted_at = NOW()'),
        ['admin-123', 'content-1']
      );

      // Verify URLs were also soft deleted
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('content_urls'),
        ['content-1']
      );
    });

    it('should return 404 when content does not exist', async () => {
      const event = createMockEvent(
        true,
        'DELETE',
        '/admin/content/nonexistent',
        { id: 'nonexistent' },
        { reason: 'Test' }
      );

      mockPool.query.mockResolvedValueOnce({
        rows: [],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when content is already deleted', async () => {
      const event = createMockEvent(
        true,
        'DELETE',
        '/admin/content/content-1',
        { id: 'content-1' },
        { reason: 'Test' }
      );

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'content-1',
            title: 'Test Content',
            deleted_at: new Date(),
          },
        ],
      });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('already deleted');
    });

    it('should return 403 when user is not admin', async () => {
      const event = createMockEvent(
        false,
        'DELETE',
        '/admin/content/content-1',
        { id: 'content-1' },
        { reason: 'Test' }
      );

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
    });

    it('should use default reason when none provided', async () => {
      const event = createMockEvent(
        true,
        'DELETE',
        '/admin/content/content-1',
        { id: 'content-1' },
        null
      );

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ id: 'content-1', title: 'Test', deleted_at: null }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'content-1' }],
        })
        .mockResolvedValueOnce({
          rows: [],
        })
        .mockResolvedValueOnce({
          rows: [],
        });

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(200);
      // Verify the audit log contains default reason
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('admin_actions'),
        expect.arrayContaining([
          'admin-123',
          'delete_content',
          'content-1',
          expect.stringContaining('Deleted by admin'),
          expect.any(String),
        ])
      );
    });
  });

  describe('Admin action audit logging', () => {
    it('should log audit trail for flag action', async () => {
      const event = createMockEvent(
        true,
        'PUT',
        '/admin/content/content-1/flag',
        { id: 'content-1' },
        { reason: 'Test flag' }
      );

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ id: 'content-1', title: 'Test', is_flagged: false }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'content-1' }],
        })
        .mockResolvedValueOnce({
          rows: [],
        });

      await handler(event, {} as any);

      // Verify audit log was created
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admin_actions'),
        expect.arrayContaining([
          'admin-123',
          'flag_content',
          'content-1',
          expect.any(String),
          '127.0.0.1',
        ])
      );
    });

    it('should log audit trail for moderate action', async () => {
      const event = createMockEvent(
        true,
        'PUT',
        '/admin/content/content-1/moderate',
        { id: 'content-1' },
        { action: 'approve', reason: 'Test approve' }
      );

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ id: 'content-1', title: 'Test', moderation_status: 'flagged' }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'content-1' }],
        })
        .mockResolvedValueOnce({
          rows: [],
        });

      await handler(event, {} as any);

      // Verify audit log was created
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admin_actions'),
        expect.arrayContaining([
          'admin-123',
          'approve_content',
          'content-1',
          expect.any(String),
          '127.0.0.1',
        ])
      );
    });

    it('should log audit trail for delete action', async () => {
      const event = createMockEvent(
        true,
        'DELETE',
        '/admin/content/content-1',
        { id: 'content-1' },
        { reason: 'Test delete' }
      );

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ id: 'content-1', title: 'Test', deleted_at: null }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'content-1' }],
        })
        .mockResolvedValueOnce({
          rows: [],
        })
        .mockResolvedValueOnce({
          rows: [],
        });

      await handler(event, {} as any);

      // Verify audit log was created
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admin_actions'),
        expect.arrayContaining([
          'admin-123',
          'delete_content',
          'content-1',
          expect.any(String),
          '127.0.0.1',
        ])
      );
    });
  });

  describe('Route handling', () => {
    it('should return 404 for unknown routes', async () => {
      const event = createMockEvent(true, 'GET', '/admin/content/unknown');

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 404 for unsupported methods', async () => {
      const event = createMockEvent(true, 'POST', '/admin/content/flagged');

      const response = await handler(event, {} as any);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });
});
