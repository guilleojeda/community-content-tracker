import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';

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
 * Log admin action to audit trail
 */
async function logAdminAction(
  pool: any,
  adminUserId: string,
  actionType: string,
  targetContentId: string,
  details: Record<string, any>,
  ipAddress?: string
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO admin_actions (admin_user_id, action_type, target_content_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminUserId, actionType, targetContentId, JSON.stringify(details), ipAddress || null]
    );
  } catch (error) {
    console.error('Failed to log admin action:', error);
    // Don't throw - logging failure shouldn't block the operation
  }
}

/**
 * GET /admin/content/flagged
 * List all flagged content
 */
async function handleListFlaggedContent(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  const pool = await getDatabasePool();
  const params = event.queryStringParameters || {};
  const limit = parseInt(params.limit || '50', 10);
  const offset = parseInt(params.offset || '0', 10);

  try {
    // Get flagged content with user information
    const query = `
      SELECT
        c.id,
        c.title,
        c.description,
        c.content_type,
        c.visibility,
        c.is_flagged,
        c.flagged_at,
        c.flag_reason,
        c.moderation_status,
        c.created_at,
        u.id as user_id,
        u.username,
        u.email,
        fb.username as flagged_by_username,
        array_agg(DISTINCT cu.url) FILTER (WHERE cu.url IS NOT NULL) as urls
      FROM content c
      INNER JOIN users u ON c.user_id = u.id
      LEFT JOIN users fb ON c.flagged_by = fb.id
      LEFT JOIN content_urls cu ON c.id = cu.content_id AND cu.deleted_at IS NULL
      WHERE c.is_flagged = true AND c.deleted_at IS NULL
      GROUP BY c.id, u.id, u.username, u.email, fb.username
      ORDER BY c.flagged_at DESC
      LIMIT $1 OFFSET $2
    `;

    const result = await pool.query(query, [limit, offset]);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as count
      FROM content
      WHERE is_flagged = true AND deleted_at IS NULL
    `;
    const countResult = await pool.query(countQuery);
    const total = parseInt(countResult.rows[0].count, 10);

    return createSuccessResponse(200, {
      success: true,
      data: {
        content: result.rows.map((row: any) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          contentType: row.content_type,
          visibility: row.visibility,
          isFlagged: row.is_flagged,
          flaggedAt: row.flagged_at,
          flagReason: row.flag_reason,
          moderationStatus: row.moderation_status,
          createdAt: row.created_at,
          urls: row.urls || [],
          user: {
            id: row.user_id,
            username: row.username,
            email: row.email,
          },
          flaggedBy: row.flagged_by_username,
        })),
        total,
        limit,
        offset,
      },
    });
  } catch (error: any) {
    console.error('List flagged content error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to list flagged content');
  }
}

/**
 * PUT /admin/content/:id/flag
 * Flag content for review
 */
async function handleFlagContent(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  const contentId = event.pathParameters?.id;
  if (!contentId) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'Content ID required');
  }

  const pool = await getDatabasePool();
  const body = event.body ? JSON.parse(event.body) : {};
  const reason = body.reason || 'No reason provided';

  try {
    // Check if content exists
    const checkQuery = 'SELECT id, title, is_flagged FROM content WHERE id = $1 AND deleted_at IS NULL';
    const checkResult = await pool.query(checkQuery, [contentId]);

    if (checkResult.rows.length === 0) {
      return createErrorResponse(404, 'NOT_FOUND', 'Content not found');
    }

    const content = checkResult.rows[0];

    // Flag the content
    const updateQuery = `
      UPDATE content
      SET
        is_flagged = true,
        flagged_at = NOW(),
        flagged_by = $1,
        flag_reason = $2,
        moderation_status = 'flagged',
        updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `;

    await pool.query(updateQuery, [admin.adminUserId, reason, contentId]);

    // Log admin action
    const ipAddress = event.requestContext?.identity?.sourceIp;
    await logAdminAction(
      pool,
      admin.adminUserId,
      'flag_content',
      contentId,
      {
        contentTitle: content.title,
        reason,
        previouslyFlagged: content.is_flagged,
      },
      ipAddress
    );

    return createSuccessResponse(200, {
      success: true,
      message: 'Content flagged successfully',
      data: {
        contentId,
        flaggedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('Flag content error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to flag content');
  }
}

/**
 * PUT /admin/content/:id/moderate
 * Approve or remove content
 */
async function handleModerateContent(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  const contentId = event.pathParameters?.id;
  if (!contentId) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'Content ID required');
  }

  const pool = await getDatabasePool();
  const body = event.body ? JSON.parse(event.body) : {};
  const action = body.action; // 'approve' or 'remove'
  const reason = body.reason || '';

  if (!action || !['approve', 'remove'].includes(action)) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'Action must be "approve" or "remove"');
  }

  try {
    // Check if content exists
    const checkQuery = 'SELECT id, title, moderation_status FROM content WHERE id = $1 AND deleted_at IS NULL';
    const checkResult = await pool.query(checkQuery, [contentId]);

    if (checkResult.rows.length === 0) {
      return createErrorResponse(404, 'NOT_FOUND', 'Content not found');
    }

    const content = checkResult.rows[0];

    // Update moderation status
    const moderationStatus = action === 'approve' ? 'approved' : 'removed';
    const updateQuery = `
      UPDATE content
      SET
        is_flagged = false,
        moderation_status = $1,
        moderated_at = NOW(),
        moderated_by = $2,
        updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `;

    await pool.query(updateQuery, [moderationStatus, admin.adminUserId, contentId]);

    // Log admin action
    const ipAddress = event.requestContext?.identity?.sourceIp;
    await logAdminAction(
      pool,
      admin.adminUserId,
      action === 'approve' ? 'approve_content' : 'remove_content',
      contentId,
      {
        contentTitle: content.title,
        action,
        reason,
        previousStatus: content.moderation_status,
      },
      ipAddress
    );

    return createSuccessResponse(200, {
      success: true,
      message: `Content ${action}d successfully`,
      data: {
        contentId,
        action,
        moderatedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('Moderate content error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to moderate content');
  }
}

/**
 * DELETE /admin/content/:id
 * Soft delete content
 */
async function handleDeleteContent(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  const contentId = event.pathParameters?.id;
  if (!contentId) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'Content ID required');
  }

  const pool = await getDatabasePool();
  const body = event.body ? JSON.parse(event.body) : {};
  const reason = body.reason || 'Deleted by admin';

  try {
    // Check if content exists and is not already deleted
    const checkQuery = 'SELECT id, title, deleted_at FROM content WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [contentId]);

    if (checkResult.rows.length === 0) {
      return createErrorResponse(404, 'NOT_FOUND', 'Content not found');
    }

    const content = checkResult.rows[0];

    if (content.deleted_at) {
      return createErrorResponse(400, 'VALIDATION_ERROR', 'Content already deleted');
    }

    // Soft delete content
    const deleteQuery = `
      UPDATE content
      SET
        deleted_at = NOW(),
        moderation_status = 'removed',
        moderated_at = NOW(),
        moderated_by = $1,
        updated_at = NOW()
      WHERE id = $2
    `;

    await pool.query(deleteQuery, [admin.adminUserId, contentId]);

    // Also soft delete associated URLs
    await pool.query(
      'UPDATE content_urls SET deleted_at = NOW() WHERE content_id = $1 AND deleted_at IS NULL',
      [contentId]
    );

    // Log admin action
    const ipAddress = event.requestContext?.identity?.sourceIp;
    await logAdminAction(
      pool,
      admin.adminUserId,
      'delete_content',
      contentId,
      {
        contentTitle: content.title,
        reason,
      },
      ipAddress
    );

    return createSuccessResponse(200, {
      success: true,
      message: 'Content deleted successfully',
      data: {
        contentId,
        deletedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('Delete content error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to delete content');
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

  try {
    // GET /admin/content/flagged
    if (method === 'GET' && path === '/admin/content/flagged') {
      return await handleListFlaggedContent(event);
    }

    // PUT /admin/content/:id/flag
    if (method === 'PUT' && /^\/admin\/content\/[^/]+\/flag$/.test(path)) {
      return await handleFlagContent(event);
    }

    // PUT /admin/content/:id/moderate
    if (method === 'PUT' && /^\/admin\/content\/[^/]+\/moderate$/.test(path)) {
      return await handleModerateContent(event);
    }

    // DELETE /admin/content/:id
    if (method === 'DELETE' && /^\/admin\/content\/[^/]+$/.test(path)) {
      return await handleDeleteContent(event);
    }

    return createErrorResponse(404, 'NOT_FOUND', `Route not found: ${method} ${path}`);
  } catch (error) {
    console.error('Unhandled content moderation error', { path, method, error });
    return createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
}
