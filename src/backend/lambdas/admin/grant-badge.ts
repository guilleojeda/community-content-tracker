import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { BadgeRepository } from '../../repositories/BadgeRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { AuditLogService } from '../../services/AuditLogService';
import { NotificationService } from '../../services/NotificationService';
import { BadgeType } from '@aws-community-hub/shared';
import {
  createErrorResponse,
  createSuccessResponse,
  parseRequestBody,
} from '../auth/utils';
import { getDatabasePool } from '../../services/database';

interface GrantBadgeRequest {
  userId?: string;
  userIds?: string[];
  badgeType: BadgeType;
  reason?: string;
}

interface GrantResult {
  success: boolean;
  userId: string;
  badgeType: BadgeType;
  message?: string;
  badgeId?: string;
}

/**
 * Grant badge Lambda handler
 * POST /admin/badges
 * Requires admin authentication
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Grant badge request:', JSON.stringify(event, null, 2));

  try {
    // Check admin authentication
    const adminUserId = event.requestContext.authorizer?.userId;
    const isAdmin = event.requestContext.authorizer?.isAdmin === 'true' ||
                    event.requestContext.authorizer?.isAdmin === true;

    if (!isAdmin) {
      return createErrorResponse(
        403,
        'PERMISSION_DENIED',
        'Admin privileges required'
      );
    }

    // Parse request body
    const { data: requestBody, error: parseError } = parseRequestBody<GrantBadgeRequest>(event.body);
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

    // Determine if single or bulk grant
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

    const dbPool = await getDatabasePool();
    const badgeRepository = new BadgeRepository(dbPool);
    const userRepository = new UserRepository(dbPool);
    const auditLogService = new AuditLogService(dbPool);
    const notificationService = new NotificationService(dbPool);

    // Process badge grants
    const results: GrantResult[] = [];

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

        // Check if user already has this badge
        const hasBadge = await badgeRepository.userHasBadge(userId, requestBody.badgeType);
        if (hasBadge) {
          results.push({
            success: false,
            userId,
            badgeType: requestBody.badgeType,
            message: 'User already has this badge',
          });
          continue;
        }

        // Grant the badge
        const badge = await badgeRepository.awardBadge({
          userId,
          badgeType: requestBody.badgeType,
          awardedBy: adminUserId,
          awardedReason: requestBody.reason,
        });

        results.push({
          success: true,
          userId,
          badgeType: requestBody.badgeType,
          badgeId: badge.id,
          message: 'Badge granted successfully',
        });

        // Log badge grant in audit trail
        await auditLogService.logBadgeGrant(
          adminUserId!,
          userId,
          requestBody.badgeType,
          requestBody.reason
        );

        // Notify user about badge
        await notificationService.notifyBadgeGranted(
          userId,
          requestBody.badgeType,
          requestBody.reason
        );

        console.log('Badge granted:', {
          badgeId: badge.id,
          userId,
          badgeType: requestBody.badgeType,
          grantedBy: adminUserId,
        });

      } catch (error) {
        console.error(`Error granting badge to user ${userId}:`, error);
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
      // Single grant response
      const result = results[0];
      if (result.success) {
        return createSuccessResponse(201, {
          message: 'Badge granted successfully',
          badge: {
            id: result.badgeId,
            userId: result.userId,
            badgeType: result.badgeType,
            grantedBy: adminUserId,
            grantedAt: new Date().toISOString(),
          },
        });
      } else {
        return createErrorResponse(
          400,
          'GRANT_FAILED',
          result.message || 'Failed to grant badge'
        );
      }
    } else {
      // Bulk grant response
      return createSuccessResponse(200, {
        message: `Granted badges to ${successCount} of ${userIds.length} users`,
        results,
        summary: {
          total: userIds.length,
          success: successCount,
          failure: failureCount,
        },
      });
    }

  } catch (error: any) {
    console.error('Unexpected grant badge error:', error);
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred'
    );
  }
}
