import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

/**
 * Extract admin context from API Gateway event
 */
function extractAdminContext(event: APIGatewayProxyEvent) {
  const authorizer: any = event.requestContext?.authorizer || {};
  const claims: any = authorizer.claims || {};

  const isAdminFlag =
    authorizer.isAdmin === true ||
    authorizer.isAdmin === 'true' ||
    (Array.isArray(claims['cognito:groups'])
      ? claims['cognito:groups'].includes('Admin')
      : typeof claims['cognito:groups'] === 'string'
      ? claims['cognito:groups'].split(',').includes('Admin')
      : false);

  const adminUserId = authorizer.userId || claims.sub || claims['cognito:username'];

  return {
    isAdmin: !!isAdminFlag,
    adminUserId,
  };
}

/**
 * GET /admin/audit-log
 * Retrieve paginated and filtered admin action audit log
 */
async function handleGetAuditLog(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  const params = event.queryStringParameters || {};
  const limit = Math.min(parseInt(params.limit || '50', 10), 100); // Max 100
  const offset = parseInt(params.offset || '0', 10);
  const adminUserIdFilter = params.adminUserId;
  const actionTypeFilter = params.actionType;
  const startDate = params.startDate;
  const endDate = params.endDate;

  const pool = await getDatabasePool();

  try {
    // Build query with filters
    const conditions: string[] = [];
    const values: any[] = [];
    let paramCount = 0;

    if (adminUserIdFilter) {
      paramCount++;
      conditions.push(`aa.admin_user_id = $${paramCount}`);
      values.push(adminUserIdFilter);
    }

    if (actionTypeFilter) {
      paramCount++;
      conditions.push(`aa.action_type = $${paramCount}`);
      values.push(actionTypeFilter);
    }

    if (startDate) {
      paramCount++;
      conditions.push(`aa.created_at >= $${paramCount}`);
      values.push(startDate);
    }

    if (endDate) {
      paramCount++;
      conditions.push(`aa.created_at <= $${paramCount}`);
      values.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get audit log entries with user information
    const query = `
      SELECT
        aa.id,
        aa.admin_user_id,
        admin_user.username AS admin_username,
        admin_user.email AS admin_email,
        aa.action_type,
        aa.target_user_id,
        target_user.username AS target_username,
        target_user.email AS target_email,
        aa.target_content_id,
        aa.details,
        aa.ip_address,
        aa.created_at
      FROM admin_actions aa
      LEFT JOIN users admin_user ON aa.admin_user_id = admin_user.id
      LEFT JOIN users target_user ON aa.target_user_id = target_user.id
      ${whereClause}
      ORDER BY aa.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    values.push(limit, offset);

    const auditResult = await pool.query(query, values);

    // Get total count with same filters
    const countQuery = `
      SELECT COUNT(*) as count
      FROM admin_actions aa
      ${whereClause}
    `;

    const countResult = await pool.query(countQuery, values.slice(0, -2)); // Remove limit/offset
    const total = parseInt(countResult.rows[0].count, 10);

    return createSuccessResponse(200, {
      success: true,
      data: {
        entries: auditResult.rows.map((row: any) => ({
          id: row.id,
          adminUser: {
            id: row.admin_user_id,
            username: row.admin_username,
            email: row.admin_email,
          },
          actionType: row.action_type,
          targetUser: row.target_user_id
            ? {
                id: row.target_user_id,
                username: row.target_username,
                email: row.target_email,
              }
            : null,
          targetContentId: row.target_content_id,
          details: row.details,
          ipAddress: row.ip_address,
          createdAt: row.created_at,
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + auditResult.rows.length < total,
        },
      },
    });
  } catch (error: any) {
    console.error('Get audit log error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to retrieve audit log');
  }
}

/**
 * Main Lambda handler
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  const path = event.path || '';
  const method = (event.httpMethod || 'GET').toUpperCase();
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    rateLimit = await applyRateLimit(event, { resource: 'admin:audit-log' });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests'));
    }

    if (method === 'GET' && path === '/admin/audit-log') {
      return withRateLimit(await handleGetAuditLog(event));
    }

    return withRateLimit(createErrorResponse(404, 'NOT_FOUND', `Route not found: ${method} ${path}`));
  } catch (error) {
    console.error('Unhandled audit-log error', { path, method, error });
    return attachRateLimitHeaders(
      createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred'),
      rateLimit
    );
  }
}
