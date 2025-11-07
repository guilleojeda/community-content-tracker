import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ContentRepository } from '../../repositories/ContentRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { Visibility } from '@aws-community-hub/shared';
import { createErrorResponse, createSuccessResponse, canAccessContent, getContentAccessLevel } from '../auth/utils';
import { getDatabasePool } from '../../services/database';

const normalizeContentUrls = (contentId: string, rawUrls: any[]): Array<{ id: string; url: string }> => {
  return (rawUrls || [])
    .filter(url => url !== null && url !== undefined)
    .map((entry: any, index: number) => {
      if (typeof entry === 'string') {
        return { id: `url-${contentId}-${index}`, url: entry };
      }

      if (entry && typeof entry === 'object' && typeof entry.url === 'string') {
        return {
          id: entry.id ?? `url-${contentId}-${index}`,
          url: entry.url,
        };
      }

      return null;
    })
    .filter((entry): entry is { id: string; url: string } => Boolean(entry?.url));
};

function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('Get Content Lambda invoked', {
    requestId: context.requestId,
    path: event.path,
  });

  try {
    // Extract content ID from path parameters
    const contentId = event.pathParameters?.id;

    if (!contentId) {
      return createErrorResponse(400, 'VALIDATION_ERROR', 'Content ID is required');
    }

    // Validate UUID format
    if (!isValidUUID(contentId)) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Invalid content ID format',
        { id: 'Must be a valid UUID' }
      );
    }

    // Extract user ID from authorizer (may be null for anonymous users)
    const userId = event.requestContext.authorizer?.claims?.sub;

    // Get database pool
    const dbPool = await getDatabasePool();
    const contentRepo = new ContentRepository(dbPool);
    const userRepo = new UserRepository(dbPool);

    // Fetch the content
    const content = await contentRepo.findById(contentId);

    if (!content) {
      return createErrorResponse(404, 'NOT_FOUND', 'Content not found');
    }

    // Check visibility permissions
    let isOwner = false;
    let isAdmin = false;
    let isAwsEmployee = false;

    if (userId) {
      const user = await userRepo.findById(userId);
      if (user) {
        isOwner = content.userId === userId;
        isAdmin = user.isAdmin;
        isAwsEmployee = user.isAwsEmployee;
      }
    }

    // Get access level for the viewer
    const accessLevel = getContentAccessLevel(isAdmin, isAwsEmployee, isOwner);

    // Check if user can access this content
    if (!canAccessContent(content.visibility, accessLevel)) {
      // Return 404 instead of 403 to avoid leaking information about private content
      return createErrorResponse(404, 'NOT_FOUND', 'Content not found');
    }

    // Transform URLs array to proper format with IDs
    const urls = normalizeContentUrls(content.id, content.urls as any);

    // Return the content with all fields
    const responseData = {
      id: content.id,
      userId: content.userId,
      title: content.title,
      description: content.description,
      contentType: content.contentType,
      visibility: content.visibility,
      publishDate: content.publishDate ? content.publishDate.toISOString() : null,
      captureDate: content.captureDate.toISOString(),
      tags: content.tags || [],
      isClaimed: content.isClaimed,
      originalAuthor: content.originalAuthor,
      urls,
      createdAt: content.createdAt.toISOString(),
      updatedAt: content.updatedAt.toISOString(),
      version: content.version,
    };

    return createSuccessResponse(200, responseData);

  } catch (error: any) {
    console.error('Error getting content:', error);

    // Handle specific error cases
    if (error.message === 'Invalid UUID format') {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Invalid content ID format',
        { id: 'Must be a valid UUID' }
      );
    }

    if (error.code === '42P01') {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Database table not found');
    }

    return createErrorResponse(500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
