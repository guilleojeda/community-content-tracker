import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ContentRepository } from '../../repositories/ContentRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { validate as validateUuid } from 'uuid';
import { getDatabasePool, closeDatabasePool } from '../../services/database';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

/**
 * Find duplicate content using multiple detection strategies
 * Supports title similarity, tag matching, and URL comparison
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('Find Duplicates Lambda invoked', {
    requestId: context.awsRequestId,
    path: event.path,
  });
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    rateLimit = await applyRateLimit(event, { resource: 'content:find-duplicates' });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests'));
    }

    // Extract user ID from authorizer
    const userId = event.requestContext.authorizer?.claims?.sub;

    if (!userId) {
      return withRateLimit(createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required'));
    }

    if (!validateUuid(userId)) {
      return withRateLimit(createErrorResponse(404, 'NOT_FOUND', 'User not found'));
    }

    // Get database pool
    const dbPool = await getDatabasePool();
    const contentRepo = new ContentRepository(dbPool);
    const userRepo = new UserRepository(dbPool);

    // Verify user exists
    const user = await userRepo.findById(userId);
    if (!user) {
      return withRateLimit(createErrorResponse(404, 'NOT_FOUND', 'User not found'));
    }

    // Parse query parameters
    const queryParams = event.queryStringParameters || {};

    // Parse threshold (default 0.8)
    let threshold = 0.8;
    if (queryParams.threshold) {
      const parsedThreshold = parseFloat(queryParams.threshold);
      if (isNaN(parsedThreshold) || parsedThreshold < 0 || parsedThreshold > 1) {
        return withRateLimit(createErrorResponse(
          400,
          'VALIDATION_ERROR',
          'Threshold must be a number between 0 and 1',
          { threshold: 'Must be between 0 and 1' }
        ));
      }
      threshold = parsedThreshold;
    }

    // Parse fields (default: title,tags)
    const fields = queryParams.fields ? queryParams.fields.split(',') : ['title', 'tags'];

    // Validate fields
    const validFields = ['title', 'tags', 'urls'];
    const invalidFields = fields.filter(f => !validFields.includes(f));
    if (invalidFields.length > 0) {
      return withRateLimit(createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Invalid fields specified',
        { fields: `Invalid fields: ${invalidFields.join(', ')}. Valid fields are: ${validFields.join(', ')}` }
      ));
    }

    // Optional: specific content ID to find duplicates for
    const contentId = queryParams.contentId;

    // Find duplicates
    const duplicates = await contentRepo.findDuplicates(
      userId,
      threshold,
      fields,
      contentId
    );

    // Transform results for response
    const transformedDuplicates = duplicates.map(({ content, similarity, matchedFields }) => {
      // Transform URLs array to proper format
      const urls = (content.urls || [])
        .filter(url => url !== null)
        .map((url, index) => ({
          id: `url-${content.id}-${index}`,
          url: typeof url === 'string' ? url : url.url || '',
        }));

      return {
        content: {
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
        },
        similarity,
        matchedFields,
      };
    });

    return withRateLimit(createSuccessResponse(200, {
      duplicates: transformedDuplicates,
      total: transformedDuplicates.length,
      threshold,
      fields,
    }));

  } catch (error: any) {
    console.error('Error finding duplicates:', error);

    // Handle specific error cases
    if (error.code === '42P01') {
      return attachRateLimitHeaders(
        createErrorResponse(500, 'INTERNAL_ERROR', 'Database table not found'),
        rateLimit
      );
    }

    if (error.code === '42883') {
      return attachRateLimitHeaders(
        createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Database function not found. The pg_trgm extension may not be installed.'
        ),
        rateLimit
      );
    }

    return attachRateLimitHeaders(
      createErrorResponse(500, 'INTERNAL_ERROR', 'Internal server error'),
      rateLimit
    );
  }
};

export const closePool = closeDatabasePool;
