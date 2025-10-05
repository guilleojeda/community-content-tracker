import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { Pool } from 'pg';
import { BadgeRepository } from '../../repositories/BadgeRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { AuditLogService } from '../../services/AuditLogService';
import { BadgeType } from '@aws-community-hub/shared';
import {
  createErrorResponse,
  createSuccessResponse,
  parseRequestBody,
} from '../auth/utils';

let pool: Pool | null = null;

function getDbPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  return pool;
}

interface RevokeBadgeRequest {
  userId?: string;
  userIds?: string[];
  badgeType: BadgeType;
  reason?: string;
}

interface RevokeResult {
  success: boolean;
  userId: string;
  badgeType: BadgeType;
  message?: string;
}

/**
 * Revoke badge Lambda handler
 * DELETE /admin/badges
 * Requires admin authentication
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Revoke badge request:', JSON.stringify(event, null, 2));

  try {
    // Check admin authentication
    const adminUserId = event.requestContext.authorizer?.userId;
    const isAdmin = event.requestContext.authorizer?.isAdmin === 'true' ||
                    event.requestContext.authorizer?.isAdmin === true;

    if (!isAdmin) {
      return createErrorResponse(
        403,
        'FORBIDDEN',
        'Admin privileges required'
      );
    }

    // Parse request body
    const { data: requestBody, error: parseError } = parseRequestBody<RevokeBadgeRequest>(event.body);
    if (parseError) {
      return parseError;
    }

    // Validate badge type
    if (!requestBody?.badgeType) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'badgeType is required'
      );
    }

    const validBadgeTypes = Object.values(BadgeType);
    if (!validBadgeTypes.includes(requestBody.badgeType)) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        `Invalid badge type. Must be one of: ${validBadgeTypes.join(', ')}`
      );
    }

    // Determine if single or bulk revoke
    let userIds: string[] = [];
    if (requestBody.userIds && requestBody.userIds.length > 0) {
      userIds = requestBody.userIds;
    } else if (requestBody.userId) {
      userIds = [requestBody.userId];
    } else {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'userId or userIds is required'
      );
    }

    const dbPool = getDbPool();
    const badgeRepository = new BadgeRepository(dbPool);
    const userRepository = new UserRepository(dbPool);
    const auditLogService = new AuditLogService(dbPool);

    // Process badge revocations
    const results: RevokeResult[] = [];

    for (const userId of userIds) {
      try {
        // Verify user exists
        const user = await userRepository.findById(userId);
        if (!user) {
          results.push({
            success: false,
            userId,
            badgeType: requestBody.badgeType,
            message: 'User not found',
          });
          continue;
        }

        // Check if user has this badge
        const hasBadge = await badgeRepository.userHasBadge(userId, requestBody.badgeType);
        if (!hasBadge) {
          results.push({
            success: false,
            userId,
            badgeType: requestBody.badgeType,
            message: 'User does not have this badge',
          });
          continue;
        }

        // Revoke the badge
        const revoked = await badgeRepository.revokeBadge(userId, requestBody.badgeType);

        if (revoked) {
          results.push({
            success: true,
            userId,
            badgeType: requestBody.badgeType,
            message: 'Badge revoked successfully',
          });

          // Log badge revocation in audit trail
          await auditLogService.logBadgeRevoke(
            adminUserId!,
            userId,
            requestBody.badgeType,
            requestBody.reason
          );

          console.log('Badge revoked:', {
            userId,
            badgeType: requestBody.badgeType,
            revokedBy: adminUserId,
            reason: requestBody.reason,
          });
        } else {
          results.push({
            success: false,
            userId,
            badgeType: requestBody.badgeType,
            message: 'Failed to revoke badge',
          });
        }

      } catch (error) {
        console.error(`Error revoking badge from user ${userId}:`, error);
        results.push({
          success: false,
          userId,
          badgeType: requestBody.badgeType,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Prepare response
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    if (userIds.length === 1) {
      // Single revoke response
      const result = results[0];
      if (result.success) {
        return createSuccessResponse(200, {
          message: 'Badge revoked successfully',
          userId: result.userId,
          badgeType: result.badgeType,
          revokedBy: adminUserId,
          revokedAt: new Date().toISOString(),
        });
      } else {
        return createErrorResponse(
          400,
          'REVOKE_FAILED',
          result.message || 'Failed to revoke badge'
        );
      }
    } else {
      // Bulk revoke response
      return createSuccessResponse(200, {
        message: `Revoked badges from ${successCount} of ${userIds.length} users`,
        results,
        summary: {
          total: userIds.length,
          success: successCount,
          failure: failureCount,
        },
      });
    }

  } catch (error: any) {
    console.error('Unexpected revoke badge error:', error);
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred'
    );
  }
}