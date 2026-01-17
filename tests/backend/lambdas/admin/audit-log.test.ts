import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/admin/audit-log';
import { getDatabasePool } from '../../../../src/backend/services/database';
import { Pool } from 'pg';

jest.mock('../../../../src/backend/services/database');

const mockGetDatabasePool = getDatabasePool as jest.MockedFunction<typeof getDatabasePool>;

describe('audit-log Lambda', () => {
  let mockPool: jest.Mocked<Pool>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPool = {
      query: jest.fn(),
    } as any;

    mockGetDatabasePool.mockResolvedValue(mockPool);
  });

  const createEvent = (
    queryParams: Record<string, string> = {},
    isAdmin: boolean = true
  ): APIGatewayProxyEvent => ({
    httpMethod: 'GET',
    path: '/admin/audit-log',
    pathParameters: null,
    queryStringParameters: queryParams,
    body: null,
    headers: {},
    requestContext: {
      authorizer: {
        isAdmin,
        userId: 'admin-123',
      },
    } as any,
  } as any);

  const mockContext = {} as Context;

  describe('GET /admin/audit-log', () => {
    it('should return paginated audit log entries', async () => {
      const mockAuditEntries = [
        {
          id: 'audit-1',
          admin_user_id: 'admin-123',
          admin_username: 'admin_user',
          admin_email: 'admin@example.com',
          action_type: 'set_aws_employee',
          target_user_id: 'user-123',
          target_username: 'john_doe',
          target_email: 'john@example.com',
          target_content_id: null,
          details: { isAwsEmployee: true, reason: 'Verified employee' },
          ip_address: '192.168.1.1',
          created_at: '2024-01-15T10:00:00Z',
        },
        {
          id: 'audit-2',
          admin_user_id: 'admin-456',
          admin_username: 'another_admin',
          admin_email: 'admin2@example.com',
          action_type: 'grant_badge',
          target_user_id: 'user-456',
          target_username: 'jane_doe',
          target_email: 'jane@example.com',
          target_content_id: null,
          details: { badgeType: 'CONTENT_CREATOR' },
          ip_address: '192.168.1.2',
          created_at: '2024-01-14T15:30:00Z',
        },
      ];

      mockPool.query
        .mockResolvedValueOnce({
          rows: mockAuditEntries,
          command: '',
          oid: 0,
          fields: [],
          rowCount: 2,
        }) // SELECT audit entries
        .mockResolvedValueOnce({
          rows: [{ count: '25' }],
          command: '',
          oid: 0,
          fields: [],
          rowCount: 1,
        }); // COUNT

      const event = createEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);

      expect(responseBody.success).toBe(true);
      expect(responseBody.data.entries).toHaveLength(2);
      expect(responseBody.data.entries[0]).toMatchObject({
        id: 'audit-1',
        adminUser: {
          id: 'admin-123',
          username: 'admin_user',
          email: 'admin@example.com',
        },
        actionType: 'set_aws_employee',
        targetUser: {
          id: 'user-123',
          username: 'john_doe',
          email: 'john@example.com',
        },
      });

      expect(responseBody.data.pagination).toEqual({
        total: 25,
        limit: 50,
        offset: 0,
        hasMore: true,
      });
    });

    it('should filter by admin user ID', async () => {
      const queryParams = { adminUserId: 'admin-123' };

      mockPool.query
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{ count: '0' }],
          command: '',
          oid: 0,
          fields: [],
          rowCount: 1,
        });

      const event = createEvent(queryParams);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);

      const queryCall = (mockPool.query as jest.Mock).mock.calls[0];
      const queryValues = queryCall[1] as any[];
      expect(queryValues).toEqual(expect.arrayContaining(['admin-123', 50, 0]));
    });

    it('should filter by action type', async () => {
      const queryParams = { actionType: 'set_aws_employee' };

      mockPool.query
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{ count: '0' }],
          command: '',
          oid: 0,
          fields: [],
          rowCount: 1,
        });

      const event = createEvent(queryParams);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);

      const queryCall = (mockPool.query as jest.Mock).mock.calls[0];
      const queryValues = queryCall[1] as any[];
      expect(queryValues).toEqual(expect.arrayContaining(['set_aws_employee', 50, 0]));
    });

    it('should filter by date range', async () => {
      const queryParams = {
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-01-31T23:59:59Z',
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{ count: '0' }],
          command: '',
          oid: 0,
          fields: [],
          rowCount: 1,
        });

      const event = createEvent(queryParams);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);

      const queryCall = (mockPool.query as jest.Mock).mock.calls[0];
      const queryValues = queryCall[1] as any[];
      expect(queryValues).toEqual(
        expect.arrayContaining(['2024-01-01T00:00:00Z', '2024-01-31T23:59:59Z', 50, 0])
      );
    });

    it('should combine multiple filters', async () => {
      const queryParams = {
        adminUserId: 'admin-123',
        actionType: 'set_aws_employee',
        startDate: '2024-01-01T00:00:00Z',
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{ count: '0' }],
          command: '',
          oid: 0,
          fields: [],
          rowCount: 1,
        });

      const event = createEvent(queryParams);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);

      const queryCall = (mockPool.query as jest.Mock).mock.calls[0];
      const queryValues = queryCall[1] as any[];
      expect(queryValues).toEqual(
        expect.arrayContaining(['admin-123', 'set_aws_employee', '2024-01-01T00:00:00Z', 50, 0])
      );
    });

    it('should respect pagination parameters', async () => {
      const queryParams = { limit: '10', offset: '20' };

      mockPool.query
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{ count: '100' }],
          command: '',
          oid: 0,
          fields: [],
          rowCount: 1,
        });

      const event = createEvent(queryParams);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);

      expect(responseBody.data.pagination).toMatchObject({
        total: 100,
        limit: 10,
        offset: 20,
        hasMore: true,
      });

      const queryCall = (mockPool.query as jest.Mock).mock.calls[0];
      const queryValues = queryCall[1] as any[];
      expect(queryValues).toEqual(expect.arrayContaining([10, 20]));
    });

    it('should enforce maximum limit of 100', async () => {
      const queryParams = { limit: '999' };

      mockPool.query
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{ count: '0' }],
          command: '',
          oid: 0,
          fields: [],
          rowCount: 1,
        });

      const event = createEvent(queryParams);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);

      expect(responseBody.data.pagination.limit).toBe(100);
    });

    it('should return 403 for non-admin user', async () => {
      const event = createEvent({}, false);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(403);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe('PERMISSION_DENIED');
      expect(responseBody.error.message).toBe('Admin privileges required');

      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should handle entries with null target user', async () => {
      const mockAuditEntries = [
        {
          id: 'audit-1',
          admin_user_id: 'admin-123',
          admin_username: 'admin_user',
          admin_email: 'admin@example.com',
          action_type: 'system_maintenance',
          target_user_id: null,
          target_username: null,
          target_email: null,
          target_content_id: null,
          details: { operation: 'cache_clear' },
          ip_address: '192.168.1.1',
          created_at: '2024-01-15T10:00:00Z',
        },
      ];

      mockPool.query
        .mockResolvedValueOnce({
          rows: mockAuditEntries,
          command: '',
          oid: 0,
          fields: [],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ count: '1' }],
          command: '',
          oid: 0,
          fields: [],
          rowCount: 1,
        });

      const event = createEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);

      expect(responseBody.data.entries[0].targetUser).toBeNull();
    });

    it('should preserve ordering from query results', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'audit-2', created_at: '2024-01-16T10:00:00Z' },
            { id: 'audit-1', created_at: '2024-01-15T10:00:00Z' },
          ],
          command: '',
          oid: 0,
          fields: [],
          rowCount: 2,
        })
        .mockResolvedValueOnce({
          rows: [{ count: '0' }],
          command: '',
          oid: 0,
          fields: [],
          rowCount: 1,
        });

      const event = createEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.data.entries.map((entry: any) => entry.id)).toEqual(['audit-2', 'audit-1']);
    });

    it('should handle database errors gracefully', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database connection failed'));

      const event = createEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe('INTERNAL_ERROR');
      expect(responseBody.error.message).toBe('Failed to retrieve audit log');
    });

    it('should calculate hasMore correctly when at end of results', async () => {
      const queryParams = { limit: '10', offset: '90' };

      mockPool.query
        .mockResolvedValueOnce({
          rows: Array(10).fill({
            id: 'audit-1',
            admin_user_id: 'admin-123',
            admin_username: 'admin',
            admin_email: 'admin@example.com',
            action_type: 'test',
            target_user_id: null,
            target_username: null,
            target_email: null,
            target_content_id: null,
            details: {},
            ip_address: null,
            created_at: '2024-01-15T10:00:00Z',
          }),
          command: '',
          oid: 0,
          fields: [],
          rowCount: 10,
        })
        .mockResolvedValueOnce({
          rows: [{ count: '100' }],
          command: '',
          oid: 0,
          fields: [],
          rowCount: 1,
        });

      const event = createEvent(queryParams);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);

      expect(responseBody.data.pagination.hasMore).toBe(false); // 90 + 10 = 100 (no more)
    });
  });
});
