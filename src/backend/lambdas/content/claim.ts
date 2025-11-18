import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ContentRepository } from '../../repositories/ContentRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { NotificationService } from '../../services/NotificationService';
import { AuditLogService } from '../../services/AuditLogService';
import {
  createErrorResponse,
  createSuccessResponse,
  parseRequestBody,
} from '../auth/utils';
import { getDatabasePool } from '../../services/database';
import { buildCorsHeaders } from '../../services/cors';

interface ClaimRequest {
  contentIds?: string[];
}

interface ClaimResult {
  success: boolean;
  contentId: string;
  message?: string;
}

/**
 * Claim content Lambda handler
 * POST /content/:id/claim - Single claim
 * POST /content/claim - Bulk claim with body: {contentIds: string[]}
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Claim content request:', JSON.stringify(event, null, 2));

  const originHeader = event.headers?.Origin || event.headers?.origin || undefined;
  const corsOptions = { origin: originHeader, methods: 'POST,OPTIONS', allowCredentials: true };

  try {
    // Extract user ID from authorizer context
    const userId = event.requestContext.authorizer?.userId;
    const isAdmin = event.requestContext.authorizer?.isAdmin === 'true' ||
                    event.requestContext.authorizer?.isAdmin === true;

    if (!userId) {
      return createErrorResponse(
        401,
        'AUTH_REQUIRED',
        'Authentication required',
        undefined,
        corsOptions
      );
    }

    const dbPool = await getDatabasePool();
    const contentRepository = new ContentRepository(dbPool);
    const userRepository = new UserRepository(dbPool);
    const notificationService = new NotificationService(dbPool);
    const auditLogService = new AuditLogService(dbPool);

    // Get claiming user details for matching
    const claimingUser = await userRepository.findById(userId);
    if (!claimingUser) {
      return createErrorResponse(404, 'NOT_FOUND', 'User not found', undefined, corsOptions);
    }

    // Check if admin override is requested
    const adminOverride = event.queryStringParameters?.admin === 'true';
    if (adminOverride && !isAdmin) {
      return createErrorResponse(
        403,
        'PERMISSION_DENIED',
        'Admin privileges required for admin override',
        undefined,
        corsOptions
      );
    }

    // Determine if this is single or bulk claim
    const pathContentId = event.pathParameters?.id;
    let contentIds: string[] = [];

    if (pathContentId) {
      // Single claim via path parameter
      contentIds = [pathContentId];
    } else {
      // Bulk claim via request body
      const { data: requestBody, error: parseError } = parseRequestBody<ClaimRequest>(event.body);
      if (parseError) {
        return parseError;
      }

      if (!requestBody?.contentIds || requestBody.contentIds.length === 0) {
        return createErrorResponse(
          400,
          'VALIDATION_ERROR',
          'contentIds array is required for bulk claim',
          undefined,
          corsOptions
        );
      }

      contentIds = requestBody.contentIds;
    }

    // Process claims
    const results: ClaimResult[] = [];

    for (const contentId of contentIds) {
      try {
        // Fetch content
        const content = await contentRepository.findById(contentId);

        if (!content) {
          results.push({
            success: false,
            contentId,
            message: 'Content not found',
          });
          continue;
        }

        // Check if already claimed
        if (content.isClaimed && content.userId === userId) {
          results.push({
            success: true,
            contentId,
            message: 'Already claimed by you',
          });
          continue;
        }

        if (content.isClaimed && !adminOverride) {
          results.push({
            success: false,
            contentId,
            message: 'Content already claimed by another user',
          });
          continue;
        }

        // Verify identity match (flexible matching)
        let identityMatches = false;

        if (adminOverride) {
          identityMatches = true; // Admin can claim anything
        } else if (content.originalAuthor) {
          const originalAuthorLower = content.originalAuthor.toLowerCase().trim();
          const usernameLower = claimingUser.username.toLowerCase().trim();
          const emailLower = claimingUser.email.toLowerCase().trim();
          const emailUsername = emailLower.split('@')[0];

          // Flexible matching: case-insensitive, partial match
          identityMatches =
            originalAuthorLower === usernameLower ||
            originalAuthorLower.includes(usernameLower) ||
            usernameLower.includes(originalAuthorLower) ||
            originalAuthorLower === emailUsername ||
            originalAuthorLower.includes(emailUsername);
        } else {
          // No original author specified, allow claim
          identityMatches = true;
        }

        if (!identityMatches) {
          results.push({
            success: false,
            contentId,
            message: `Identity mismatch: original author "${content.originalAuthor}" does not match user`,
          });
          continue;
        }

        // Claim content using repository method
        const claimed = await contentRepository.claimContent(contentId, userId, {
          requestId: event.requestContext.requestId,
          sourceIp: event.requestContext.identity?.sourceIp,
          force: adminOverride,
        });

        if (claimed) {
          results.push({
            success: true,
            contentId,
            message: 'Successfully claimed',
          });

          // Log claim in audit trail
          await auditLogService.logContentClaim(userId, contentId, {
            adminOverride,
            originalAuthor: content.originalAuthor,
            ipAddress: event.requestContext.identity?.sourceIp,
          });

          // Notify admin if this requires review (admin override or suspicious claim)
          if (adminOverride || !identityMatches) {
            await notificationService.notifyAdminForReview(
              userId,
              contentId,
              adminOverride
                ? 'Admin override used for content claim'
                : `Identity mismatch: ${content.originalAuthor} vs ${claimingUser.username}`
            );
          }
        } else {
          results.push({
            success: false,
            contentId,
            message: 'Failed to claim content',
          });
        }

      } catch (error) {
        console.error(`Error claiming content ${contentId}:`, error);
        results.push({
          success: false,
          contentId,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Prepare response
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    if (contentIds.length === 1) {
      // Single claim response
      const result = results[0];
      if (result.success) {
        return createSuccessResponse(200, {
          message: result.message || 'Content claimed successfully',
          contentId: result.contentId,
        }, corsOptions);
      } else {
        return createErrorResponse(
          400,
          'CLAIM_FAILED',
          result.message || 'Failed to claim content',
          undefined,
          corsOptions
        );
      }
    } else {
      // Bulk claim response - use 207 Multi-Status for partial success
      const statusCode = failureCount > 0 && successCount > 0 ? 207 :
                         successCount === contentIds.length ? 200 : 400;

      return {
        statusCode,
        headers: {
          ...buildCorsHeaders(corsOptions),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Claimed ${successCount} of ${contentIds.length} content items`,
          results,
          summary: {
            total: contentIds.length,
            success: successCount,
            failure: failureCount,
          },
        }),
      };
    }

  } catch (error: any) {
    console.error('Unexpected claim error:', error);
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred',
      undefined,
      corsOptions
    );
  }
}
