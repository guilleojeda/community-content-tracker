import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { Pool } from 'pg';
import { ContentRepository } from '../../repositories/ContentRepository';
import { AuditLogService } from '../../services/AuditLogService';
import {
  createErrorResponse,
  createSuccessResponse,
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

/**
 * DELETE /content/:id Lambda handler
 * Deletes content with authorization and cascade deletion of URLs
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Delete content request:', JSON.stringify(event, null, 2));

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

    // Get content ID from path
    const contentId = event.pathParameters?.id;
    if (!contentId) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Content ID is required'
      );
    }

    const dbPool = getDbPool();
    const contentRepository = new ContentRepository(dbPool);
    const auditLogService = new AuditLogService(dbPool);

    // Get existing content
    const existingContent = await contentRepository.findById(contentId);
    if (!existingContent) {
      return createErrorResponse(404, 'NOT_FOUND', 'Content not found');
    }

    // Check authorization (owner or admin)
    const isOwner = existingContent.userId === userId;
    if (!isOwner && !isAdmin) {
      return createErrorResponse(
        403,
        'FORBIDDEN',
        'You are not authorized to delete this content'
      );
    }

    // Check if already soft deleted
    const forceDelete = event.queryStringParameters?.force === 'true';

    if (existingContent.deletedAt && !forceDelete) {
      return createErrorResponse(
        410,
        'GONE',
        'Content has already been deleted'
      );
    }

    // Force delete requires admin
    if (forceDelete && !isAdmin) {
      return createErrorResponse(
        403,
        'FORBIDDEN',
        'Force delete requires admin privileges'
      );
    }

    // Determine delete strategy (soft delete by default, hard delete if forced)
    const softDelete = !forceDelete;

    try {
      // Delete content using repository method
      const deleted = await contentRepository.deleteContent(contentId, softDelete);

      if (!deleted) {
        return createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Failed to delete content'
        );
      }

      // Log deletion in audit trail
      await auditLogService.logContentDelete(
        userId,
        contentId,
        softDelete,
        {
          title: existingContent.title,
          contentType: existingContent.contentType,
          forceDelete,
          ipAddress: event.requestContext.identity?.sourceIp,
          userAgent: event.headers['User-Agent'],
        }
      );

      console.log(`Content ${softDelete ? 'soft' : 'hard'} deleted successfully:`, contentId);

      // Return 204 No Content for successful deletion
      return {
        statusCode: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'OPTIONS,DELETE',
        },
        body: '',
      };

    } catch (deleteError) {
      console.error('Error during delete operation:', deleteError);
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Failed to delete content'
      );
    }

  } catch (error: any) {
    console.error('Unexpected delete error:', error);
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred'
    );
  }
}