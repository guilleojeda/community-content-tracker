import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ContentRepository, ContentSearchOptions } from '../../repositories/ContentRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { ContentType, Visibility } from '@aws-community-hub/shared';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { getDatabasePool } from '../../services/database';

interface ListQueryParams {
  limit?: string;
  offset?: string;
  sortBy?: string;
  sortOrder?: string;
  visibility?: string;
  contentType?: string;
}

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

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('List Content Lambda invoked', {
    requestId: context.requestId,
    path: event.path,
  });

  try {
    // Extract user ID from authorizer
    const userId = event.requestContext.authorizer?.claims?.sub;

    if (!userId) {
    return createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required');
  }

    // Get database pool
    const dbPool = await getDatabasePool();
    const contentRepo = new ContentRepository(dbPool);
    const userRepo = new UserRepository(dbPool);

    // Get user information for visibility filtering
    const user = await userRepo.findById(userId);
    if (!user) {
      return createErrorResponse(404, 'NOT_FOUND', 'User not found');
    }

    // Parse query parameters
    const queryParams = (event.queryStringParameters || {}) as ListQueryParams;

    // Validate and parse limit
    let limit = 20; // Default
    if (queryParams.limit) {
      const parsedLimit = parseInt(queryParams.limit, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1) {
        return createErrorResponse(
          400,
          'VALIDATION_ERROR',
          'Invalid limit parameter',
          { limit: 'Must be a positive integer' }
        );
      }
      if (parsedLimit > 100) {
        return createErrorResponse(
          400,
          'VALIDATION_ERROR',
          'Limit exceeds maximum allowed value',
          { limit: 'Maximum is 100' }
        );
      }
      limit = parsedLimit;
    }

    // Validate and parse offset
    let offset = 0; // Default
    if (queryParams.offset) {
      const parsedOffset = parseInt(queryParams.offset, 10);
      if (isNaN(parsedOffset) || parsedOffset < 0) {
        return createErrorResponse(
          400,
          'VALIDATION_ERROR',
          'Invalid offset parameter',
          { offset: 'Must be non-negative' }
        );
      }
      offset = parsedOffset;
    }

    // Parse sort parameters
    const sortBy = queryParams.sortBy || 'date';
    const sortOrder = queryParams.sortOrder?.toLowerCase() === 'asc' ? 'asc' : 'desc';

    // Map sortBy to database column
    let orderBy: string;
    if (sortBy === 'date') {
      orderBy = 'publish_date';
    } else if (sortBy === 'title') {
      orderBy = 'title';
    } else {
      orderBy = 'publish_date'; // Default
    }

    // Build search options
    const searchOptions: ContentSearchOptions = {
      viewerId: userId,
      limit,
      offset,
      orderBy,
      orderDirection: sortOrder.toUpperCase() as 'ASC' | 'DESC',
      filters: {},
    };

    // Parse visibility filter
    if (queryParams.visibility) {
      const visibilityValues = queryParams.visibility.split(',').map(v => v.trim() as Visibility);
      searchOptions.filters!.visibility = visibilityValues;
    }

    // Parse content type filter
    if (queryParams.contentType) {
      const contentTypeValues = queryParams.contentType.split(',').map(t => t.trim() as ContentType);
      searchOptions.filters!.contentTypes = contentTypeValues;
    }

    // Fetch content for the user
    const contentItems = await contentRepo.findByUserId(userId, searchOptions);

    // Get total count for pagination
    const totalQuery = `
      SELECT COUNT(*)::int as total
      FROM content c
      LEFT JOIN users u_viewer ON u_viewer.id = $1
      WHERE c.user_id = $1
    `;
    const totalResult = await dbPool.query(totalQuery, [userId]);
    const total = totalResult.rows[0]?.total || 0;

    // Transform content items to include URLs with proper structure
    const transformedItems = contentItems.map(content => {
      return {
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
        urls: normalizeContentUrls(content.id, content.urls as any),
        createdAt: content.createdAt.toISOString(),
        updatedAt: content.updatedAt.toISOString(),
        version: content.version,
      };
    });

    return createSuccessResponse(200, {
      items: transformedItems,
      total,
      limit,
      offset,
    });

  } catch (error: any) {
    console.error('Error listing content:', error);

    // Handle specific error cases
    if (error.code === '42P01') {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Database table not found');
    }

    return createErrorResponse(500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
