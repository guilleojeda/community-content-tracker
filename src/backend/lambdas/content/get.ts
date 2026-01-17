import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ContentRepository } from '../../repositories/ContentRepository';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { getDatabasePool } from '../../services/database';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

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
    requestId: context.awsRequestId,
    path: event.path,
  });
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    rateLimit = await applyRateLimit(event, { resource: 'content:get' });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests'));
    }

    // Extract content ID from path parameters
    const contentId = event.pathParameters?.id;

    if (!contentId) {
      return withRateLimit(createErrorResponse(400, 'VALIDATION_ERROR', 'Content ID is required'));
    }

    // Validate UUID format
    if (!isValidUUID(contentId)) {
      return withRateLimit(createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Invalid content ID format',
        { id: 'Must be a valid UUID' }
      ));
    }

    // Extract user ID from authorizer (may be null for anonymous users)
    const userId = event.requestContext.authorizer?.claims?.sub;

    // Get database pool
    const dbPool = await getDatabasePool();
    const contentRepo = new ContentRepository(dbPool);

    // Fetch the content with visibility filtering at the query level
    const content = await contentRepo.findByIdForViewer(contentId, userId ?? null);

    if (!content) {
      return withRateLimit(createErrorResponse(404, 'NOT_FOUND', 'Content not found'));
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

    return withRateLimit(createSuccessResponse(200, responseData));

  } catch (error: any) {
    console.error('Error getting content:', error);

    // Handle specific error cases
    if (error.message === 'Invalid UUID format') {
      return attachRateLimitHeaders(createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Invalid content ID format',
        { id: 'Must be a valid UUID' }
      ), rateLimit);
    }

    if (error.code === '42P01') {
      return attachRateLimitHeaders(
        createErrorResponse(500, 'INTERNAL_ERROR', 'Database table not found'),
        rateLimit
      );
    }

    return attachRateLimitHeaders(
      createErrorResponse(500, 'INTERNAL_ERROR', 'Internal server error'),
      rateLimit
    );
  }
};
