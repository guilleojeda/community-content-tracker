import { APIGatewayProxyResult } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { AuditLogService } from '../../services/AuditLogService';

const DEFAULT_ANALYTICS_RETENTION_DAYS = 730;

function getAnalyticsRetentionDays(): number {
  const value = process.env.ANALYTICS_RETENTION_DAYS;
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_ANALYTICS_RETENTION_DAYS;
  }
  return parsed;
}

export async function handler(): Promise<APIGatewayProxyResult> {
  try {
    const retentionDays = getAnalyticsRetentionDays();
    const pool = await getDatabasePool();

    const analyticsResult = await pool.query(
      `WITH deleted AS (
         DELETE FROM analytics_events
         WHERE created_at < NOW() - ($1::interval)
         RETURNING 1
       )
       SELECT COUNT(*)::int AS deleted_count FROM deleted`,
      [`${retentionDays} days`]
    );

    const analyticsDeleted: number = analyticsResult.rows?.[0]?.deleted_count ?? 0;

    const auditLog = new AuditLogService(pool);
    await auditLog.log({
      action: 'system.data-retention',
      resourceType: 'analytics_events',
      resourceId: null,
      userId: undefined,
      newValues: {
        deletedCount: analyticsDeleted,
        retentionWindowDays: retentionDays,
      },
    });

    return createSuccessResponse(200, {
      analyticsDeleted,
      retentionWindowDays: retentionDays,
    });
  } catch (error) {
    console.error('Data retention execution failed', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to execute data retention');
  }
}
