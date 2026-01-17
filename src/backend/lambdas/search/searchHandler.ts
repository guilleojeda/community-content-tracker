import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { ContentRepository } from '../../repositories/ContentRepository';
import { getEmbeddingService } from '../../services/EmbeddingService';
import { getSearchService } from '../../services/SearchService';
import { ContentType, BadgeType, Visibility } from '@aws-community-hub/shared';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { buildCorsHeaders } from '../../services/cors';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

const requireAwsRegion = (): string => {
  if (!process.env.AWS_REGION || process.env.AWS_REGION.trim().length === 0) {
    throw new Error('AWS_REGION must be set');
  }
  return process.env.AWS_REGION.trim();
};

interface ViewerContext {
  viewerId?: string;
  badges: BadgeType[];
  isAwsEmployee: boolean;
  sourceIp: string;
}

const normalizeParams = (event: APIGatewayProxyEvent): Record<string, string | undefined> => {
  return event.queryStringParameters ?? {};
};

const safeParseBadges = (raw: unknown): BadgeType[] => {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BadgeType[]) : [];
  } catch {
    return [];
  }
};

const getViewerContext = (event: APIGatewayProxyEvent): ViewerContext => {
  const requestContext = event.requestContext ?? ({} as APIGatewayProxyEvent['requestContext']);
  const authorizer = (requestContext?.authorizer ?? {}) as Record<string, unknown>;
  const identity = requestContext?.identity ?? ({} as typeof requestContext.identity);

  const viewerId = typeof authorizer.userId === 'string' ? authorizer.userId : undefined;
  const badges = safeParseBadges(authorizer.badges);
  const isAwsEmployee = authorizer.isAwsEmployee === true || authorizer.isAwsEmployee === 'true';
  const sourceIp =
    typeof identity?.sourceIp === 'string' && identity?.sourceIp.length > 0 ? identity.sourceIp : 'anonymous';

  return {
    viewerId,
    badges,
    isAwsEmployee,
    sourceIp,
  };
};

interface DateRangeResult {
  error?: string;
  value?: { start: Date; end: Date };
}

const parseDateRange = (start?: string, end?: string): DateRangeResult => {
  if (!start && !end) {
    return {};
  }

  if (!start || !end) {
    return { error: 'Both startDate and endDate must be provided for date range filtering' };
  }

  const startDate = new Date(start);
  const endDate = new Date(end);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { error: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD)' };
  }

  if (startDate > endDate) {
    return { error: 'startDate must be before endDate' };
  }

  return { value: { start: startDate, end: endDate } };
};

/**
 * GET /search - Search for content
 * Supports semantic and keyword search with filtering
 *
 * Query parameters:
 * - q: Search query (required)
 * - limit: Results per page (default: 10)
 * - offset: Pagination offset (default: 0)
 * - type: Content types filter (comma-separated: blog,youtube,github,conference_talk,podcast)
 * - tags: Tags filter (comma-separated)
 * - badges: Badge filter (comma-separated: hero,community_builder,ambassador,user_group_leader)
 * - startDate: Start date for date range filter (ISO 8601)
 * - endDate: End date for date range filter (ISO 8601)
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const originHeader = event.headers?.Origin || event.headers?.origin || undefined;
  const headers = {
    ...buildCorsHeaders({ origin: originHeader, methods: 'GET,OPTIONS' }),
    'Content-Type': 'application/json',
  };
  const params = normalizeParams(event);
  const viewer = getViewerContext(event);
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    rateLimit = await applyRateLimit(event, { resource: 'search' });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit({
        statusCode: 429,
        headers,
        body: JSON.stringify({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many search requests from this IP address',
          },
        }),
      });
    }

    const query = params.q;
    if (!query || query.trim().length === 0) {
      return withRateLimit({
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing required query parameter: q',
          },
        }),
      });
    }

    const limit = params.limit ? Number.parseInt(params.limit, 10) : 10;
    const offset = params.offset ? Number.parseInt(params.offset, 10) : 0;
    const sortBy = params.sortBy ? params.sortBy.toLowerCase() : undefined;

    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      return withRateLimit({
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'limit must be between 1 and 100',
          },
        }),
      });
    }

    if (sortBy && sortBy !== 'relevance' && sortBy !== 'date') {
      return withRateLimit({
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'sortBy must be either relevance or date',
          },
        }),
      });
    }

    const filters: Record<string, unknown> = {};

    if (params.type) {
      const types = params.type.split(',').map((value) => value.trim()).filter(Boolean);
      const validTypes = Object.values(ContentType);
      const invalidTypes = types.filter((value) => !validTypes.includes(value as ContentType));

      if (invalidTypes.length > 0) {
        return withRateLimit({
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid content type(s): ${invalidTypes.join(', ')}. Valid types: ${validTypes.join(', ')}`,
            },
          }),
        });
      }

      filters.contentTypes = types as ContentType[];
    }

    if (params.tags) {
      const sanitizedTags = params.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => tag.replace(/[^\w\s-]/g, ''))
        .filter(Boolean);

      if (sanitizedTags.length === 0) {
        return withRateLimit({
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Tags filter must include at least one valid tag',
            },
          }),
        });
      }

      filters.tags = sanitizedTags;
    }

    if (params.badges) {
      const badges = params.badges.split(',').map((badge) => badge.trim()).filter(Boolean);
      const validBadges = Object.values(BadgeType);
      const invalidBadges = badges.filter((badge) => !validBadges.includes(badge as BadgeType));

      if (invalidBadges.length > 0) {
        return withRateLimit({
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid badge(s): ${invalidBadges.join(', ')}. Valid badges: ${validBadges.join(', ')}`,
            },
          }),
        });
      }

      filters.badges = badges as BadgeType[];
    }

    const dateRange = parseDateRange(params.startDate, params.endDate);
    if (dateRange.error) {
      return withRateLimit({
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: dateRange.error,
          },
        }),
      });
    }
    if (dateRange.value) {
      filters.dateRange = dateRange.value;
    }

    if (params.visibility) {
      const visibilityValues = params.visibility.split(',').map((value) => value.trim()).filter(Boolean);
      const validVisibility = Object.values(Visibility);
      const invalidVisibility = visibilityValues.filter((value) => !validVisibility.includes(value as Visibility));

      if (invalidVisibility.length > 0) {
        return withRateLimit({
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid visibility value(s): ${invalidVisibility.join(', ')}`,
            },
          }),
        });
      }

      filters.visibility = visibilityValues as Visibility[];
    }

    let searchFilters: typeof filters | undefined;
    if (Object.keys(filters).length > 0) {
      searchFilters = filters;
    }

    const searchStartTime = Date.now();

    const pool = await getDatabasePool();
    const contentRepo = new ContentRepository(pool);
    const embeddingService = getEmbeddingService();
    const cloudwatch = new CloudWatchClient({ region: requireAwsRegion() });
    const searchService = getSearchService(contentRepo, embeddingService, cloudwatch);

    const results = await searchService.search(
      {
        query,
        filters: searchFilters,
        limit,
        offset,
      },
      Boolean(viewer.viewerId),
      viewer.badges,
      viewer.isAwsEmployee,
      { viewerId: viewer.viewerId, sortBy: sortBy as 'relevance' | 'date' | undefined }
    );

    const searchLatency = Date.now() - searchStartTime;

    logSearchAnalytics({
      query,
      resultCount: results.total,
      latency: searchLatency,
      userId: viewer.viewerId,
      filters,
      timestamp: new Date(),
    }).catch((err) => {
      console.warn('Failed to log search analytics:', err.message);
    });

    return withRateLimit({
      statusCode: 200,
      headers,
      body: JSON.stringify(results),
    });
  } catch (error: any) {
    console.error('Search error:', error);

    return attachRateLimitHeaders({
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while performing the search',
        },
      }),
    }, rateLimit);
  }
};

/**
 * Log search analytics to CloudWatch for tracking and monitoring
 */
export async function logSearchAnalytics(analytics: {
  query: string;
  resultCount: number;
  latency: number;
  userId?: string;
  filters: any;
  timestamp: Date;
}, client?: CloudWatchClient): Promise<void> {
  if (process.env.DISABLE_CLOUDWATCH_METRICS === 'true' || process.env.LOCAL_AUTH_MODE === 'true') {
    return;
  }

  const cloudwatch = client ?? new CloudWatchClient({
    region: requireAwsRegion()
  });

  const namespace = 'CommunityContentHub/Search';

  // Log to CloudWatch Logs for detailed query analysis
  console.log('Search Analytics:', JSON.stringify({
    query: analytics.query,
    resultCount: analytics.resultCount,
    latency: analytics.latency,
    userId: analytics.userId || 'anonymous',
    filters: analytics.filters,
    timestamp: analytics.timestamp.toISOString()
  }));

  // Publish metrics to CloudWatch
  const command = new PutMetricDataCommand({
    Namespace: namespace,
    MetricData: [
      {
        MetricName: 'SearchCount',
        Value: 1,
        Unit: 'Count',
        Timestamp: analytics.timestamp,
        Dimensions: [
          { Name: 'UserType', Value: analytics.userId ? 'authenticated' : 'anonymous' }
        ]
      },
      {
        MetricName: 'SearchLatency',
        Value: analytics.latency,
        Unit: 'Milliseconds',
        Timestamp: analytics.timestamp,
        Dimensions: [
          { Name: 'Service', Value: 'Search' }
        ]
      },
      {
        MetricName: 'SearchResultsCount',
        Value: analytics.resultCount,
        Unit: 'Count',
        Timestamp: analytics.timestamp,
        Dimensions: [
          { Name: 'Service', Value: 'Search' }
        ]
      },
      {
        MetricName: 'ZeroResultSearches',
        Value: analytics.resultCount === 0 ? 1 : 0,
        Unit: 'Count',
        Timestamp: analytics.timestamp,
        Dimensions: [
          { Name: 'Service', Value: 'Search' }
        ]
      }
    ]
  });

  await cloudwatch.send(command);
}
