import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { BadgeType } from '@aws-community-hub/shared';
import { PoolClient } from 'pg';

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

interface GrantBadgeRequest {
  userId: string;
  badgeType: BadgeType;
  reason?: string;
}

/**
 * POST /admin/badges/grant
 * Grant badge to a user
 * Requires admin authentication
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);

  // Check admin privileges
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  // Parse and validate request body
  let requestBody: GrantBadgeRequest;
  try {
    if (!event.body) {
      return createErrorResponse(400, 'VALIDATION_ERROR', 'Request body is required');
    }
    requestBody = JSON.parse(event.body);
  } catch (error) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'Invalid JSON in request body');
  }

  // Validate required fields
  if (!requestBody.userId) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'userId is required');
  }

  if (!requestBody.badgeType) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'badgeType is required');
  }

  // Validate badge type enum
  const validBadgeTypes = Object.values(BadgeType);
  if (!validBadgeTypes.includes(requestBody.badgeType)) {
    return createErrorResponse(
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

    // Check if user exists
    const userCheck = await client.query(
      'SELECT id FROM users WHERE id = $1',
      [requestBody.userId]
    );

    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return createErrorResponse(404, 'NOT_FOUND', 'User not found');
    }

    // Check if badge already exists (active or inactive)
    const badgeCheck = await client.query(
      'SELECT id, is_active FROM user_badges WHERE user_id = $1 AND badge_type = $2',
      [requestBody.userId, requestBody.badgeType]
    );

    let badgeId: string;
    let operation: 'granted' | 'reactivated';

    if (badgeCheck.rows.length > 0) {
      const existingBadge = badgeCheck.rows[0];

      if (existingBadge.is_active) {
        // Badge is already active
        await client.query('ROLLBACK');
        return createErrorResponse(
          409,
          'DUPLICATE_RESOURCE',
          'User already has an active badge of this type'
        );
      }

      // Reactivate the inactive badge
      const reactivateResult = await client.query(
        `UPDATE user_badges
         SET is_active = true,
             awarded_at = NOW(),
             awarded_by = $1,
             awarded_reason = $2,
             revoked_at = NULL,
             revoked_by = NULL,
             revoke_reason = NULL,
             updated_at = NOW()
         WHERE id = $3
         RETURNING id`,
        [admin.adminUserId, requestBody.reason, existingBadge.id]
      );
      badgeId = reactivateResult.rows[0].id;
      operation = 'reactivated';
    } else {
      // Insert new badge
      const insertResult = await client.query(
        `INSERT INTO user_badges (
          user_id, badge_type, awarded_at, awarded_by, awarded_reason, is_active
        ) VALUES ($1, $2, NOW(), $3, $4, true)
        RETURNING id`,
        [requestBody.userId, requestBody.badgeType, admin.adminUserId, requestBody.reason]
      );
      badgeId = insertResult.rows[0].id;
      operation = 'granted';
    }

    // Insert audit record into admin_actions table
    await client.query(
      `INSERT INTO admin_actions (
        admin_user_id, action_type, target_user_id, details, created_at
      ) VALUES ($1, $2, $3, $4, NOW())`,
      [
        admin.adminUserId,
        'grant_badge',
        requestBody.userId,
        JSON.stringify({
          badgeType: requestBody.badgeType,
          badgeId,
          reason: requestBody.reason,
          operation,
        }),
      ]
    );

    // Commit transaction
    await client.query('COMMIT');

    console.log('Badge granted successfully:', {
      badgeId,
      userId: requestBody.userId,
      badgeType: requestBody.badgeType,
      grantedBy: admin.adminUserId,
      operation,
    });

    return createSuccessResponse(operation === 'reactivated' ? 200 : 201, {
      success: true,
      data: {
        badgeId,
        userId: requestBody.userId,
        badgeType: requestBody.badgeType,
        grantedBy: admin.adminUserId,
        grantedAt: new Date().toISOString(),
        operation,
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

    console.error('Grant badge error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to grant badge');
  } finally {
    if (client) {
      client.release();
    }
  }
}
