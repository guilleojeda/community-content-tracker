import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { PoolClient } from 'pg';
import { ContentRepository } from '../../repositories/ContentRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { AuditLogService } from '../../services/AuditLogService';
import { NotificationService } from '../../services/NotificationService';
import {
  createErrorResponse,
  createSuccessResponse,
  parseRequestBody,
} from '../auth/utils';
import { getDatabasePool } from '../../services/database';

interface MergeRequest {
  contentIds: string[];
  primaryId: string;
  reason?: string;
}

/**
 * Merge content items Lambda handler
 * POST /content/merge
 * Merges 2+ content items into one, keeping the best metadata
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Merge content request:', JSON.stringify(event, null, 2));

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

    // Parse request body
    const { data: requestBody, error: parseError } = parseRequestBody<MergeRequest>(event.body);
    if (parseError) {
      return parseError;
    }

    // Validate request
    if (!requestBody?.contentIds || requestBody.contentIds.length < 2) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'At least 2 content IDs are required for merge'
      );
    }

    if (!requestBody.primaryId) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'primaryId is required'
      );
    }

    if (!requestBody.contentIds.includes(requestBody.primaryId)) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'primaryId must be one of the contentIds'
      );
    }

    const dbPool = await getDatabasePool();
    const contentRepository = new ContentRepository(dbPool);
    const userRepository = new UserRepository(dbPool);
    const auditLogService = new AuditLogService(dbPool);
    const notificationService = new NotificationService(dbPool);

    // Fetch all content items
    const contentItems = await Promise.all(
      requestBody.contentIds.map(id => contentRepository.findById(id))
    );

    // Check all content exists
    const missingIds = requestBody.contentIds.filter((id, index) => !contentItems[index]);
    if (missingIds.length > 0) {
      return createErrorResponse(
        404,
        'NOT_FOUND',
        `Content not found: ${missingIds.join(', ')}`
      );
    }

    // Verify ownership of all content items (or admin)
    if (!isAdmin) {
      const unauthorizedItems = contentItems.filter(item => item!.userId !== userId);
      if (unauthorizedItems.length > 0) {
        return createErrorResponse(
          403,
          'PERMISSION_DENIED',
          'You must own all content items to merge them'
        );
      }
    }

    // Get secondary content IDs (all except primary)
    const secondaryContentIds = requestBody.contentIds.filter(id => id !== requestBody.primaryId);

    // Use ContentRepository's mergeContent method (handles transaction internally)
    try {
      const mergedContent = await contentRepository.mergeContent(
        requestBody.primaryId,
        secondaryContentIds,
        userId,
        requestBody.reason
      );

      // Get merge history for this operation
      const mergeHistory = await contentRepository.getMergeHistory(requestBody.primaryId, 1);
      const latestMerge = mergeHistory.length > 0 ? mergeHistory[0] : null;

      // Log merge in audit trail
      await auditLogService.logContentMerge(
        userId,
        requestBody.primaryId,
        secondaryContentIds,
        {
          reason: requestBody.reason,
          mergeHistoryId: latestMerge?.id,
          contentCount: requestBody.contentIds.length,
        }
      );

      // Notify user about successful merge
      await notificationService.notifyContentMerged(
        userId,
        requestBody.primaryId,
        secondaryContentIds.length
      );

      console.log('Content merged successfully:', {
        primaryId: requestBody.primaryId,
        mergedIds: secondaryContentIds,
        mergeHistoryId: latestMerge?.id,
        mergedBy: userId,
      });

      return createSuccessResponse(200, {
        message: 'Content merged successfully',
        content: mergedContent,
        mergeHistory: latestMerge ? {
          id: latestMerge.id,
          canUndoUntil: latestMerge.undoDeadline,
          canUndo: latestMerge.canUndo,
        } : undefined,
        merged: {
          primaryId: requestBody.primaryId,
          mergedIds: secondaryContentIds,
          urlsCount: mergedContent.urls.length,
          tagsCount: mergedContent.tags.length,
        },
      });

    } catch (mergeError) {
      console.error('Error during merge operation:', mergeError);
      throw mergeError;
    }

  } catch (error: any) {
    console.error('Unexpected merge error:', error);
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred during merge'
    );
  }
}
