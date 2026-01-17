import { Pool, PoolClient } from 'pg';

export interface AuditLogEntry {
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

export interface AuditLogQuery {
  userId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Service for comprehensive audit logging
 * Tracks all significant system operations for compliance and debugging
 */
export class AuditLogService {
  constructor(private pool: Pool | PoolClient) {}

  /**
   * Log a system action
   */
  async log(entry: AuditLogEntry): Promise<string> {
    const query = `
      INSERT INTO audit_log (
        user_id,
        action,
        resource_type,
        resource_id,
        old_values,
        new_values,
        ip_address,
        user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;

    const values = [
      entry.userId || null,
      entry.action,
      entry.resourceType,
      entry.resourceId || null,
      entry.oldValues ? JSON.stringify(entry.oldValues) : null,
      entry.newValues ? JSON.stringify(entry.newValues) : null,
      entry.ipAddress || null,
      entry.userAgent || null,
    ];

    const result = await this.pool.query(query, values);
    return result.rows[0].id;
  }

  /**
   * Log content creation
   */
  async logContentCreate(
    userId: string,
    contentId: string,
    content: any,
    metadata?: Record<string, any>
  ): Promise<string> {
    return this.log({
      userId,
      action: 'content.create',
      resourceType: 'content',
      resourceId: contentId,
      newValues: content,
      ...metadata,
    });
  }

  /**
   * Log content update
   */
  async logContentUpdate(
    userId: string,
    contentId: string,
    oldValues: any,
    newValues: any,
    metadata?: Record<string, any>
  ): Promise<string> {
    return this.log({
      userId,
      action: 'content.update',
      resourceType: 'content',
      resourceId: contentId,
      oldValues,
      newValues,
      ...metadata,
    });
  }

  /**
   * Log content deletion
   */
  async logContentDelete(
    userId: string,
    contentId: string,
    content: any,
    metadata?: Record<string, any>
  ): Promise<string> {
    return this.log({
      userId,
      action: 'content.delete',
      resourceType: 'content',
      resourceId: contentId,
      oldValues: content,
      ...metadata,
    });
  }

  /**
   * Log content claim
   */
  async logContentClaim(
    userId: string,
    contentId: string,
    metadata?: Record<string, any>
  ): Promise<string> {
    return this.log({
      userId,
      action: 'content.claim',
      resourceType: 'content',
      resourceId: contentId,
      newValues: { claimed: true, claimedBy: userId },
      ...metadata,
    });
  }

  /**
   * Log content merge
   */
  async logContentMerge(
    userId: string,
    primaryContentId: string,
    mergedContentIds: string[],
    metadata?: Record<string, any>
  ): Promise<string> {
    return this.log({
      userId,
      action: 'content.merge',
      resourceType: 'content',
      resourceId: primaryContentId,
      newValues: {
        primaryContentId,
        mergedContentIds,
        mergedCount: mergedContentIds.length,
      },
      ...metadata,
    });
  }

  /**
   * Log badge grant
   */
  async logBadgeGrant(
    adminId: string,
    userId: string,
    badgeType: string,
    reason?: string,
    metadata?: Record<string, any>
  ): Promise<string> {
    return this.log({
      userId: adminId,
      action: 'badge.grant',
      resourceType: 'user_badge',
      resourceId: userId,
      newValues: {
        userId,
        badgeType,
        reason,
        grantedBy: adminId,
        metadata: metadata ?? {},
      },
    });
  }

  /**
   * Log badge revoke
   */
  async logBadgeRevoke(
    adminId: string,
    userId: string,
    badgeType: string,
    reason?: string
  ): Promise<string> {
    return this.log({
      userId: adminId,
      action: 'badge.revoke',
      resourceType: 'user_badge',
      resourceId: userId,
      oldValues: {
        userId,
        badgeType,
      },
      newValues: {
        revokedBy: adminId,
        reason,
      },
    });
  }

  /**
   * Log AWS employee status change
   */
  async logAwsEmployeeChange(
    adminId: string,
    userId: string,
    isAwsEmployee: boolean,
    reason?: string,
    metadata?: Record<string, any>
  ): Promise<string> {
    return this.log({
      userId: adminId,
      action: 'user.aws_employee_change',
      resourceType: 'user',
      resourceId: userId,
      newValues: {
        isAwsEmployee,
        changedBy: adminId,
        reason,
        metadata: metadata ?? {},
      },
    });
  }

  /**
   * Query audit logs with filtering
   */
  async query(params: AuditLogQuery): Promise<any[]> {
    let query = `
      SELECT
        al.*,
        u.username as user_username,
        u.email as user_email
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;

    const values: any[] = [];
    let paramIndex = 1;

    if (params.userId) {
      query += ` AND al.user_id = $${paramIndex++}`;
      values.push(params.userId);
    }

    if (params.action) {
      query += ` AND al.action = $${paramIndex++}`;
      values.push(params.action);
    }

    if (params.resourceType) {
      query += ` AND al.resource_type = $${paramIndex++}`;
      values.push(params.resourceType);
    }

    if (params.resourceId) {
      query += ` AND al.resource_id = $${paramIndex++}`;
      values.push(params.resourceId);
    }

    if (params.startDate) {
      query += ` AND al.created_at >= $${paramIndex++}`;
      values.push(params.startDate);
    }

    if (params.endDate) {
      query += ` AND al.created_at <= $${paramIndex++}`;
      values.push(params.endDate);
    }

    query += ` ORDER BY al.created_at DESC`;

    if (params.limit) {
      query += ` LIMIT $${paramIndex++}`;
      values.push(params.limit);
    }

    if (params.offset) {
      query += ` OFFSET $${paramIndex++}`;
      values.push(params.offset);
    }

    const result = await this.pool.query(query, values);
    return result.rows;
  }

  /**
   * Get audit trail for a specific resource
   */
  async getResourceAuditTrail(
    resourceType: string,
    resourceId: string,
    limit: number = 50
  ): Promise<any[]> {
    return this.query({
      resourceType,
      resourceId,
      limit,
    });
  }

  /**
   * Get user's recent actions
   */
  async getUserActions(userId: string, limit: number = 50): Promise<any[]> {
    return this.query({
      userId,
      limit,
    });
  }

  /**
   * Get statistics on actions
   */
  async getActionStatistics(
    startDate?: Date,
    endDate?: Date
  ): Promise<Array<{ action: string; count: number }>> {
    let query = `
      SELECT action, COUNT(*) as count
      FROM audit_log
      WHERE 1=1
    `;

    const values: any[] = [];
    let paramIndex = 1;

    if (startDate) {
      query += ` AND created_at >= $${paramIndex++}`;
      values.push(startDate);
    }

    if (endDate) {
      query += ` AND created_at <= $${paramIndex++}`;
      values.push(endDate);
    }

    query += ` GROUP BY action ORDER BY count DESC`;

    const result = await this.pool.query(query, values);
    return result.rows.map(row => ({
      action: row.action,
      count: parseInt(row.count, 10),
    }));
  }
}
