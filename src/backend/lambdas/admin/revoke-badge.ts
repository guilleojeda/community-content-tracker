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

interface RevokeBadgeRequest {
  userId: string;
  badgeType: BadgeType;
  reason?: string;
}

/**
 * DELETE /admin/badges/revoke
 * Revoke badge from a user
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
  let requestBody: RevokeBadgeRequest;
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

    // Check if badge exists and is active
    const badgeCheck = await client.query(
      'SELECT id, is_active FROM user_badges WHERE user_id = $1 AND badge_type = $2',
      [requestBody.userId, requestBody.badgeType]
    );

    if (badgeCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return createErrorResponse(404, 'NOT_FOUND', 'Badge not found for this user');
    }

    const badge = badgeCheck.rows[0];
    if (!badge.is_active) {
      await client.query('ROLLBACK');
      return createErrorResponse(404, 'NOT_FOUND', 'Badge is already revoked');
    }

    // Revoke the badge by marking it as inactive
    await client.query(
      `UPDATE user_badges
       SET is_active = false,
           revoked_at = NOW(),
           revoked_by = $1,
           revoke_reason = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [admin.adminUserId, requestBody.reason, badge.id]
    );

    // Insert audit record into admin_actions table
    await client.query(
      `INSERT INTO admin_actions (
        admin_user_id, action_type, target_user_id, details, created_at
      ) VALUES ($1, $2, $3, $4, NOW())`,
      [
        admin.adminUserId,
        'revoke_badge',
        requestBody.userId,
        JSON.stringify({
          badgeType: requestBody.badgeType,
          badgeId: badge.id,
          reason: requestBody.reason,
        }),
      ]
    );

    // Commit transaction
    await client.query('COMMIT');

    console.log('Badge revoked successfully:', {
      badgeId: badge.id,
      userId: requestBody.userId,
      badgeType: requestBody.badgeType,
      revokedBy: admin.adminUserId,
      reason: requestBody.reason,
    });

    return createSuccessResponse(200, {
      success: true,
      data: {
        badgeId: badge.id,
        userId: requestBody.userId,
        badgeType: requestBody.badgeType,
        revokedBy: admin.adminUserId,
        revokedAt: new Date().toISOString(),
        reason: requestBody.reason,
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

    console.error('Revoke badge error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to revoke badge');
  } finally {
    if (client) {
      client.release();
    }
  }
}
