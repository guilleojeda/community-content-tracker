import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ContentRepository } from '../../repositories/ContentRepository';
import { AuditLogService } from '../../services/AuditLogService';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../auth/utils';
import { getDatabasePool } from '../../services/database';

/**
 * Unmerge content Lambda handler
 * POST /content/{id}/unmerge
 * Undoes a content merge operation within the 30-day window
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Unmerge content request:', JSON.stringify(event, null, 2));

  try {
    // Extract user ID from authorizer context
    const userId = event.requestContext.authorizer?.userId;
    const isAdmin = event.requestContext.authorizer?.isAdmin === 'true' ||
                    event.requestContext.authorizer?.isAdmin === true;

    if (!userId) {
      return createErrorResponse(
        401,
        'AUTH_REQUIRED',
        'Authentication required'
      );
    }

    // Get merge history ID from path or query parameters
    const mergeId = event.pathParameters?.id || event.queryStringParameters?.mergeId;
    if (!mergeId) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Merge ID is required'
      );
    }

    const dbPool = await getDatabasePool();
    const contentRepository = new ContentRepository(dbPool);
    const auditLogService = new AuditLogService(dbPool);

    try {
      // Unmerge content using repository method
      const success = await contentRepository.unmergeContent(mergeId);

      if (!success) {
        return createErrorResponse(
          400,
          'UNMERGE_FAILED',
          'Failed to unmerge content. The merge may have expired or already been undone.'
        );
      }

      // Log unmerge in audit trail
      await auditLogService.log({
        userId,
        action: 'content.unmerge',
        resourceType: 'content_merge_history',
        resourceId: mergeId,
        metadata: {
          ipAddress: event.requestContext.identity?.sourceIp,
          userAgent: event.headers['User-Agent'],
        },
      });

      console.log('Content unmerged successfully:', {
        mergeId,
        unmergedBy: userId,
        timestamp: new Date().toISOString(),
      });

      return createSuccessResponse(200, {
        message: 'Content unmerged successfully',
        mergeId,
        unmergedBy: userId,
        unmergedAt: new Date().toISOString(),
      });

    } catch (unmergeError: any) {
      console.error('Error during unmerge operation:', unmergeError);

      // Check for specific error messages
      if (unmergeError.message?.includes('expired')) {
        return createErrorResponse(
          410,
          'MERGE_EXPIRED',
          'The 30-day undo window for this merge has expired'
        );
      }

      if (unmergeError.message?.includes('not found')) {
        return createErrorResponse(
          404,
          'MERGE_NOT_FOUND',
          'Merge history not found'
        );
      }

      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Failed to unmerge content'
      );
    }

  } catch (error: any) {
    console.error('Unexpected unmerge error:', error);
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred'
    );
  }
}
