import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ContentRepository } from '../../repositories/ContentRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { ContentType, Visibility } from '@aws-community-hub/shared';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { getDatabasePool } from '../../services/database';

interface UnclaimedQueryParams {
  limit?: string;
  offset?: string;
  sortBy?: string;
  sortOrder?: string;
  contentType?: string;
}

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('Unclaimed Content Lambda invoked', {
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
    const queryParams = (event.queryStringParameters || {}) as UnclaimedQueryParams;

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

    // Parse content type filter
    let contentTypeFilter: ContentType[] | undefined;
    if (queryParams.contentType) {
      contentTypeFilter = queryParams.contentType.split(',').map(t => t.trim() as ContentType);
    }

    // Build visibility filter based on user permissions
    const visibilityConditions: string[] = ['c.visibility = $1']; // PUBLIC
    const visibilityParams: any[] = [Visibility.PUBLIC];
    let paramIndex = 2;

    // AWS employees can see AWS_ONLY unclaimed content
    if (user.isAwsEmployee || user.isAdmin) {
      visibilityConditions.push(`c.visibility = $${paramIndex++}`);
      visibilityParams.push(Visibility.AWS_ONLY);
    }

    // Authenticated users can see AWS_COMMUNITY unclaimed content
    visibilityConditions.push(`c.visibility = $${paramIndex++}`);
    visibilityParams.push(Visibility.AWS_COMMUNITY);

    // Build the query
    let query = `
      SELECT c.*,
             array_agg(DISTINCT cu.url) FILTER (WHERE cu.url IS NOT NULL) as urls
      FROM content c
      LEFT JOIN content_urls cu ON c.id = cu.content_id
      WHERE c.is_claimed = false
        AND (${visibilityConditions.join(' OR ')})
    `;

    const params: any[] = [...visibilityParams];

    // Add content type filter if provided
    if (contentTypeFilter && contentTypeFilter.length > 0) {
      const contentTypePlaceholders = contentTypeFilter.map(() => `$${paramIndex++}`).join(', ');
      query += ` AND c.content_type IN (${contentTypePlaceholders})`;
      params.push(...contentTypeFilter);
    }

    query += `
      GROUP BY c.id
      ORDER BY ${orderBy === 'title' ? 'c.title' : 'c.publish_date'} ${sortOrder.toUpperCase()}
      LIMIT $${paramIndex++}
      OFFSET $${paramIndex++}
    `;

    params.push(limit, offset);

    // Execute the query
    const result = await dbPool.query(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*)::int as total
      FROM content c
      WHERE c.is_claimed = false
        AND (${visibilityConditions.join(' OR ')})
    `;

    const countParams = [...visibilityParams];
    let countParamIndex = visibilityParams.length + 1;

    if (contentTypeFilter && contentTypeFilter.length > 0) {
      const contentTypePlaceholders = contentTypeFilter.map(() => `$${countParamIndex++}`).join(', ');
      countQuery += ` AND c.content_type IN (${contentTypePlaceholders})`;
      countParams.push(...contentTypeFilter);
    }

    const countResult = await dbPool.query(countQuery, countParams);
    const total = countResult.rows[0]?.total || 0;

    // Transform the results
    const transformedItems = result.rows.map(row => {
      // Transform URLs array to proper format
      const urls = (row.urls || [])
        .filter((url: string | null) => url !== null)
        .map((url: string, index: number) => ({
          id: `url-${row.id}-${index}`,
          url: url,
        }));

      return {
        id: row.id,
        userId: row.user_id,
        title: row.title,
        description: row.description,
        contentType: row.content_type,
        visibility: row.visibility,
        publishDate: row.publish_date ? new Date(row.publish_date).toISOString() : null,
        captureDate: new Date(row.capture_date).toISOString(),
        tags: row.tags || [],
        isClaimed: row.is_claimed,
        originalAuthor: row.original_author,
        urls,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      };
    });

    return createSuccessResponse(200, {
      items: transformedItems,
      total,
      limit,
      offset,
    });

  } catch (error: any) {
    console.error('Error listing unclaimed content:', error);

    // Handle specific error cases
    if (error.code === '42P01') {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Database table not found');
    }

    return createErrorResponse(500, 'INTERNAL_ERROR', 'Internal server error');
  }
};
