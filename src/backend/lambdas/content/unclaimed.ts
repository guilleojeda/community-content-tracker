import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { UserRepository } from '../../repositories/UserRepository';
import { ContentType, Visibility } from '@aws-community-hub/shared';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { getDatabasePool } from '../../services/database';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

interface UnclaimedQueryParams {
  limit?: string;
  offset?: string;
  sortBy?: string;
  sortOrder?: string;
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
  console.log('Unclaimed Content Lambda invoked', {
    requestId: context.awsRequestId,
    path: event.path,
  });
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    rateLimit = await applyRateLimit(event, { resource: 'content:unclaimed' });
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

    // Get database pool
    const dbPool = await getDatabasePool();
    const userRepo = new UserRepository(dbPool);

    // Get user information for visibility filtering
    const user = await userRepo.findById(userId);
    if (!user) {
      return withRateLimit(createErrorResponse(404, 'NOT_FOUND', 'User not found'));
    }
    const identityTokens = [
      user.username,
      user.email,
      user.email?.split('@')[0],
    ]
      .filter((value): value is string => Boolean(value && value.trim().length > 0))
      .map((value) => value.toLowerCase().trim());

    // Parse query parameters
    const queryParams = (event.queryStringParameters || {}) as UnclaimedQueryParams;

    // Validate and parse limit
    let limit = 20; // Default
    if (queryParams.limit) {
      const parsedLimit = parseInt(queryParams.limit, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1) {
        return withRateLimit(createErrorResponse(
          400,
          'VALIDATION_ERROR',
          'Invalid limit parameter',
          { limit: 'Must be a positive integer' }
        ));
      }
      if (parsedLimit > 100) {
        return withRateLimit(createErrorResponse(
          400,
          'VALIDATION_ERROR',
          'Limit exceeds maximum allowed value',
          { limit: 'Maximum is 100' }
        ));
      }
      limit = parsedLimit;
    }

    // Validate and parse offset
    let offset = 0; // Default
    if (queryParams.offset) {
      const parsedOffset = parseInt(queryParams.offset, 10);
      if (isNaN(parsedOffset) || parsedOffset < 0) {
        return withRateLimit(createErrorResponse(
          400,
          'VALIDATION_ERROR',
          'Invalid offset parameter',
          { offset: 'Must be non-negative' }
        ));
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
             urls.urls
      FROM content c
      LEFT JOIN (
        SELECT content_id,
               array_agg(DISTINCT url) FILTER (WHERE url IS NOT NULL) as urls
        FROM content_urls
        GROUP BY content_id
      ) urls ON c.id = urls.content_id
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
      const urls = normalizeContentUrls(row.id, row.urls as any);

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
        version: row.version ?? 1,
      };
    });

    const matchesIdentity = (originalAuthor?: string | null): boolean => {
      if (!originalAuthor) {
        return false;
      }
      const normalizedAuthor = originalAuthor.toLowerCase().trim();
      if (normalizedAuthor.length === 0) {
        return false;
      }
      return identityTokens.some((token) =>
        normalizedAuthor === token ||
        normalizedAuthor.includes(token) ||
        token.includes(normalizedAuthor)
      );
    };

    const sortedItems = transformedItems
      .map((item, index) => ({
        item,
        index,
        matches: matchesIdentity(item.originalAuthor),
      }))
      .sort((a, b) => {
        if (a.matches === b.matches) {
          return a.index - b.index;
        }
        return a.matches ? -1 : 1;
      })
      .map(({ item }) => item);

    return withRateLimit(createSuccessResponse(200, {
      items: sortedItems,
      total,
      limit,
      offset,
    }));

  } catch (error: any) {
    console.error('Error listing unclaimed content:', error);

    // Handle specific error cases
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
