import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/admin/set-aws-employee';
import { getDatabasePool } from '../../../../src/backend/services/database';
import { Pool, PoolClient } from 'pg';

jest.mock('../../../../src/backend/services/database');

const mockGetDatabasePool = getDatabasePool as jest.MockedFunction<typeof getDatabasePool>;

describe('set-aws-employee Lambda', () => {
  let mockPool: jest.Mocked<Pool>;
  let mockClient: jest.Mocked<PoolClient>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    } as any;

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn(),
    } as any;

    mockGetDatabasePool.mockResolvedValue(mockPool);
  });

  const createEvent = (
    userId: string,
    body: any,
    isAdmin: boolean = true,
    adminUserId: string = 'admin-123'
  ): APIGatewayProxyEvent => ({
    httpMethod: 'PUT',
    path: `/admin/users/${userId}/aws-employee`,
    pathParameters: { id: userId },
    body: JSON.stringify(body),
    queryStringParameters: null,
    headers: {},
    requestContext: {
      authorizer: {
        isAdmin,
        userId: adminUserId,
      },
      identity: {
        sourceIp: '192.168.1.1',
      },
    } as any,
  } as any);

  const mockContext = {} as Context;

  describe('PUT /admin/users/:id/aws-employee', () => {
    it('should set AWS employee flag to true', async () => {
      const userId = 'user-123';
      const body = {
        isAwsEmployee: true,
        reason: 'Verified AWS employee',
      };

      mockClient.query
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: userId, is_aws_employee: false }],
          command: '',
          oid: 0,
          fields: [],
          rowCount: 1,
        }) // SELECT user
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 1 }) // UPDATE user
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 1 }) // INSERT audit
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 }); // COMMIT

      const event = createEvent(userId, body);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.userId).toBe(userId);
      expect(responseBody.data.isAwsEmployee).toBe(true);
      expect(responseBody.data.previousStatus).toBe(false);

      // Verify transaction
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

      // Verify audit log insertion
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admin_actions'),
        expect.arrayContaining([
          'admin-123',
          'set_aws_employee',
          userId,
          expect.stringContaining('Verified AWS employee'),
          '192.168.1.1',
        ])
      );

      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should set AWS employee flag to false', async () => {
      const userId = 'user-456';
      const body = {
        isAwsEmployee: false,
        reason: 'No longer with AWS',
      };

      mockClient.query
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: userId, is_aws_employee: true }],
          command: '',
          oid: 0,
          fields: [],
          rowCount: 1,
        }) // SELECT user
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 1 }) // UPDATE user
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 1 }) // INSERT audit
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 }); // COMMIT

      const event = createEvent(userId, body);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.isAwsEmployee).toBe(false);
      expect(responseBody.data.previousStatus).toBe(true);

      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should return 404 for non-existent user', async () => {
      const userId = 'nonexistent-user';
      const body = { isAwsEmployee: true };

      mockClient.query
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 }) // SELECT user (not found)
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 }); // ROLLBACK

      const event = createEvent(userId, body);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(404);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe('NOT_FOUND');
      expect(responseBody.error.message).toBe('User not found');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should return 403 for non-admin user', async () => {
      const userId = 'user-123';
      const body = { isAwsEmployee: true };

      const event = createEvent(userId, body, false);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(403);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe('PERMISSION_DENIED');
      expect(responseBody.error.message).toBe('Admin privileges required');

      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it('should return 400 for missing isAwsEmployee field', async () => {
      const userId = 'user-123';
      const body = { reason: 'Some reason' }; // Missing isAwsEmployee

      const event = createEvent(userId, body);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(400);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe('VALIDATION_ERROR');
      expect(responseBody.error.message).toBe('isAwsEmployee must be a boolean');
    });

    it('should return 400 for invalid JSON body', async () => {
      const event = createEvent('user-123', {});
      event.body = 'invalid json{';

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(400);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe('VALIDATION_ERROR');
      expect(responseBody.error.message).toBe('Invalid JSON body');
    });

    it('should handle reason as optional field', async () => {
      const userId = 'user-789';
      const body = { isAwsEmployee: true }; // No reason

      mockClient.query
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: userId, is_aws_employee: false }],
          command: '',
          oid: 0,
          fields: [],
          rowCount: 1,
        }) // SELECT user
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 1 }) // UPDATE user
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 1 }) // INSERT audit
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 }); // COMMIT

      const event = createEvent(userId, body);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);

      // Verify audit log has null reason
      const auditCall = (mockClient.query as jest.Mock).mock.calls.find((call) =>
        call[0].includes('INSERT INTO admin_actions')
      );
      const auditDetails = JSON.parse(auditCall[1][3]);
      expect(auditDetails.reason).toBeNull();
    });

    it('should rollback on database error', async () => {
      const userId = 'user-123';
      const body = { isAwsEmployee: true };

      mockClient.query
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: userId, is_aws_employee: false }],
          command: '',
          oid: 0,
          fields: [],
          rowCount: 1,
        }) // SELECT user
        .mockRejectedValueOnce(new Error('Database error')) // UPDATE fails
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 }); // ROLLBACK

      const event = createEvent(userId, body);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(500);
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should verify audit log created with correct details', async () => {
      const userId = 'user-999';
      const body = {
        isAwsEmployee: true,
        reason: 'New hire at AWS',
      };

      mockClient.query
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: userId, is_aws_employee: false }],
          command: '',
          oid: 0,
          fields: [],
          rowCount: 1,
        }) // SELECT user
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 1 }) // UPDATE user
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 1 }) // INSERT audit
        .mockResolvedValueOnce({ rows: [], command: '', oid: 0, fields: [], rowCount: 0 }); // COMMIT

      const event = createEvent(userId, body);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);

      // Find the audit log insert call
      const auditInsertCall = (mockClient.query as jest.Mock).mock.calls.find((call) =>
        call[0].includes('INSERT INTO admin_actions')
      );

      expect(auditInsertCall).toBeDefined();
      expect(auditInsertCall[1][0]).toBe('admin-123'); // admin_user_id
      expect(auditInsertCall[1][1]).toBe('set_aws_employee'); // action_type
      expect(auditInsertCall[1][2]).toBe(userId); // target_user_id

      const details = JSON.parse(auditInsertCall[1][3]);
      expect(details.isAwsEmployee).toBe(true);
      expect(details.previousStatus).toBe(false);
      expect(details.reason).toBe('New hire at AWS');
    });
  });
});
