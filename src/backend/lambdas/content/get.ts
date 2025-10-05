import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { Pool } from 'pg';
import { ContentRepository } from '../../repositories/ContentRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { Visibility } from '@aws-community-hub/shared';
import { createErrorResponse, createSuccessResponse, canAccessContent, getContentAccessLevel } from '../auth/utils';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      min: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  return pool;
}

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
    const dbPool = getPool();
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
    const urls = (content.urls || [])
      .filter(url => url !== null)
      .map((url, index) => ({
        id: `url-${content.id}-${index}`,
        url: url,
      }));

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