import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { BadgeType } from '@aws-community-hub/shared';
import { PoolClient } from 'pg';
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

interface BulkBadgesRequest {
  operation: 'grant' | 'revoke';
  userIds: string[];
  badgeType: BadgeType;
  reason?: string;
}

interface OperationResult {
  userId: string;
  success: boolean;
  error?: string;
}

/**
 * Process badge grant for a single user
 */
async function grantBadgeForUser(
  client: PoolClient,
  userId: string,
  badgeType: BadgeType,
  adminUserId: string,
  reason?: string
): Promise<{ success: boolean; error?: string; badgeId?: string }> {
  try {
    // Check if user exists
    const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return { success: false, error: 'User not found' };
    }

    // Check if badge already exists
    const badgeCheck = await client.query(
      'SELECT id, is_active FROM user_badges WHERE user_id = $1 AND badge_type = $2',
      [userId, badgeType]
    );

    let badgeId: string;

    if (badgeCheck.rows.length > 0) {
      const existingBadge = badgeCheck.rows[0];

      if (existingBadge.is_active) {
        return { success: false, error: 'Badge already active' };
      }

      // Reactivate
      const result = await client.query(
        `UPDATE user_badges
         SET is_active = true, awarded_at = NOW(), awarded_by = $1,
             awarded_reason = $2, revoked_at = NULL, revoked_by = NULL,
             revoke_reason = NULL, updated_at = NOW()
         WHERE id = $3
         RETURNING id`,
        [adminUserId, reason, existingBadge.id]
      );
      badgeId = result.rows[0].id;
    } else {
      // Insert new badge
      const result = await client.query(
        `INSERT INTO user_badges (user_id, badge_type, awarded_at, awarded_by, awarded_reason, is_active)
         VALUES ($1, $2, NOW(), $3, $4, true)
         RETURNING id`,
        [userId, badgeType, adminUserId, reason]
      );
      badgeId = result.rows[0].id;
    }

    // Audit log
    await client.query(
      `INSERT INTO admin_actions (admin_user_id, action_type, target_user_id, details, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        adminUserId,
        'grant_badge',
        userId,
        JSON.stringify({ badgeType, badgeId, reason, bulk: true }),
      ]
    );

    return { success: true, badgeId };
  } catch (error: any) {
    console.error(`Error granting badge to user ${userId}:`, error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Process badge revoke for a single user
 */
async function revokeBadgeForUser(
  client: PoolClient,
  userId: string,
  badgeType: BadgeType,
  adminUserId: string,
  reason?: string
): Promise<{ success: boolean; error?: string; badgeId?: string }> {
  try {
    // Check if badge exists and is active
    const badgeCheck = await client.query(
      'SELECT id, is_active FROM user_badges WHERE user_id = $1 AND badge_type = $2',
      [userId, badgeType]
    );

    if (badgeCheck.rows.length === 0) {
      return { success: false, error: 'Badge not found' };
    }

    const badge = badgeCheck.rows[0];
    if (!badge.is_active) {
      return { success: false, error: 'Badge already revoked' };
    }

    // Revoke badge
    await client.query(
      `UPDATE user_badges
       SET is_active = false, revoked_at = NOW(), revoked_by = $1,
           revoke_reason = $2, updated_at = NOW()
       WHERE id = $3`,
      [adminUserId, reason, badge.id]
    );

    // Audit log
    await client.query(
      `INSERT INTO admin_actions (admin_user_id, action_type, target_user_id, details, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        adminUserId,
        'revoke_badge',
        userId,
        JSON.stringify({ badgeType, badgeId: badge.id, reason, bulk: true }),
      ]
    );

    return { success: true, badgeId: badge.id };
  } catch (error: any) {
    console.error(`Error revoking badge from user ${userId}:`, error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * POST /admin/badges/bulk
 * Bulk badge operations (grant or revoke)
 * Requires admin authentication
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;
  const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
    attachRateLimitHeaders(response, rateLimit);
  const respondError = (...args: Parameters<typeof createErrorResponse>) =>
    withRateLimit(createErrorResponse(...args));
  const respondSuccess = (...args: Parameters<typeof createSuccessResponse>) =>
    withRateLimit(createSuccessResponse(...args));

  rateLimit = await applyRateLimit(event, { resource: 'admin:bulk-badges' });
  if (rateLimit && !rateLimit.allowed) {
    return respondError(429, 'RATE_LIMITED', 'Too many requests');
  }

  const admin = extractAdminContext(event);

  // Check admin privileges
  if (!admin.isAdmin) {
    return respondError(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  // Parse and validate request body
  let requestBody: BulkBadgesRequest;
  try {
    if (!event.body) {
      return respondError(400, 'VALIDATION_ERROR', 'Request body is required');
    }
    requestBody = JSON.parse(event.body);
  } catch (error) {
    return respondError(400, 'VALIDATION_ERROR', 'Invalid JSON in request body');
  }

  // Validate required fields
  if (!requestBody.operation) {
    return respondError(400, 'VALIDATION_ERROR', 'operation is required');
  }

  if (!['grant', 'revoke'].includes(requestBody.operation)) {
    return respondError(
      400,
      'VALIDATION_ERROR',
      'operation must be either "grant" or "revoke"'
    );
  }

  if (!requestBody.userIds || !Array.isArray(requestBody.userIds) || requestBody.userIds.length === 0) {
    return respondError(400, 'VALIDATION_ERROR', 'userIds must be a non-empty array');
  }

  if (!requestBody.badgeType) {
    return respondError(400, 'VALIDATION_ERROR', 'badgeType is required');
  }

  // Validate badge type enum
  const validBadgeTypes = Object.values(BadgeType);
  if (!validBadgeTypes.includes(requestBody.badgeType)) {
    return respondError(
      400,
      'VALIDATION_ERROR',
      `Invalid badge type. Must be one of: ${validBadgeTypes.join(', ')}`
    );
  }

  const pool = await getDatabasePool();
  let client: PoolClient | null = null;

  try {
    // Start transaction
    client = await pool.connect();
    await client.query('BEGIN');

    const results: OperationResult[] = [];
    let successCount = 0;

    // Process each user
    for (const userId of requestBody.userIds) {
      if (requestBody.operation === 'grant') {
        const result = await grantBadgeForUser(
          client,
          userId,
          requestBody.badgeType,
          admin.adminUserId!,
          requestBody.reason
        );

        if (result.success) {
          successCount++;
          results.push({ userId, success: true });
        } else {
          results.push({ userId, success: false, error: result.error });
        }
      } else {
        // revoke
        const result = await revokeBadgeForUser(
          client,
          userId,
          requestBody.badgeType,
          admin.adminUserId!,
          requestBody.reason
        );

        if (result.success) {
          successCount++;
          results.push({ userId, success: true });
        } else {
          results.push({ userId, success: false, error: result.error });
        }
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    const failed = results.filter(r => !r.success);

    console.log(`Bulk ${requestBody.operation} completed:`, {
      operation: requestBody.operation,
      badgeType: requestBody.badgeType,
      total: requestBody.userIds.length,
      successful: successCount,
      failed: failed.length,
    });

    return respondSuccess(200, {
      success: true,
      data: {
        operation: requestBody.operation,
        badgeType: requestBody.badgeType,
        successful: successCount,
        failed: failed,
        summary: {
          total: requestBody.userIds.length,
          successful: successCount,
          failed: failed.length,
        },
      },
    });

  } catch (error: any) {
    // Rollback on error
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Rollback error:', rollbackError);
      }
    }

    console.error('Bulk badges error:', error);
    return respondError(500, 'INTERNAL_ERROR', 'Failed to process bulk badge operation');
  } finally {
    if (client) {
      client.release();
    }
  }
}
