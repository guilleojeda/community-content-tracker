import { handler } from '../../../../src/backend/lambdas/maintenance/data-retention';

jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn(),
}));

jest.mock('../../../../src/backend/services/AuditLogService', () => {
  const mockLog = jest.fn();
  return {
    AuditLogService: jest.fn(() => ({
      log: mockLog,
    })),
    __mockLog: mockLog,
  };
});

const mockPool = {
  query: jest.fn(),
};

const { getDatabasePool } = require('../../../../src/backend/services/database');
const { AuditLogService, __mockLog: mockAuditLog } = require('../../../../src/backend/services/AuditLogService');

describe('Data Retention Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPool.query.mockReset();
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
    (AuditLogService as jest.Mock).mockClear();
    (AuditLogService as jest.Mock).mockImplementation(() => ({
      log: mockAuditLog,
    }));
    mockAuditLog.mockClear();
    mockAuditLog.mockResolvedValue('audit-log-entry');
    process.env.ANALYTICS_RETENTION_DAYS = '730';
  });

  afterEach(() => {
    delete process.env.ANALYTICS_RETENTION_DAYS;
  });

  it('deletes analytics events older than the configured retention window', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ deleted_count: 42 }],
    });

    const result = await handler({} as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.analyticsDeleted).toBe(42);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM analytics_events'),
      ['730 days']
    );
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'system.data-retention',
      resourceType: 'analytics_events',
      newValues: expect.objectContaining({
        deletedCount: 42,
        retentionWindowDays: 730,
      }),
    }));
  });

  it('uses default retention when environment variable missing', async () => {
    delete process.env.ANALYTICS_RETENTION_DAYS;
    mockPool.query.mockResolvedValueOnce({
      rows: [{ deleted_count: 0 }],
    });

    const result = await handler({} as any);

    expect(result.statusCode).toBe(200);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM analytics_events'),
      ['730 days']
    );
  });

  it('returns error when database operation fails', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('db failure'));

    const result = await handler({} as any);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toMatch(/data retention/i);
  });
});
