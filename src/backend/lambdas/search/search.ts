import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { SearchService } from '../../services/SearchService';
import { ContentType, BadgeType, Visibility } from '@aws-community-hub/shared';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

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
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Content-Type': 'application/json'
  };

  try {
    // Parse and validate query parameters
    const query = event.queryStringParameters?.q;

    if (!query || query.trim().length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing required query parameter: q'
          }
        })
      };
    }

    // Parse pagination
    const limit = event.queryStringParameters?.limit
      ? parseInt(event.queryStringParameters.limit, 10)
      : 10;
    const offset = event.queryStringParameters?.offset
      ? parseInt(event.queryStringParameters.offset, 10)
      : 0;

    if (limit < 1 || limit > 100) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'limit must be between 1 and 100'
          }
        })
      };
    }

    // Parse filters
    const filters: any = {};

    // Content types filter
    if (event.queryStringParameters?.type) {
      const types = event.queryStringParameters.type.split(',').map(t => t.trim());
      const validTypes = Object.values(ContentType);
      const invalidTypes = types.filter(t => !validTypes.includes(t as ContentType));

      if (invalidTypes.length > 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid content type(s): ${invalidTypes.join(', ')}. Valid types: ${validTypes.join(', ')}`
            }
          })
        };
      }

      filters.contentTypes = types as ContentType[];
    }

    // Tags filter
    if (event.queryStringParameters?.tags) {
      filters.tags = event.queryStringParameters.tags.split(',').map(t => t.trim());
    }

    // Badges filter
    if (event.queryStringParameters?.badges) {
      const badges = event.queryStringParameters.badges.split(',').map(b => b.trim());
      const validBadges = Object.values(BadgeType);
      const invalidBadges = badges.filter(b => !validBadges.includes(b as BadgeType));

      if (invalidBadges.length > 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid badge(s): ${invalidBadges.join(', ')}. Valid badges: ${validBadges.join(', ')}`
            }
          })
        };
      }

      filters.badges = badges as BadgeType[];
    }

    // Date range filter
    if (event.queryStringParameters?.startDate || event.queryStringParameters?.endDate) {
      const startDate = event.queryStringParameters?.startDate;
      const endDate = event.queryStringParameters?.endDate;

      if (!startDate || !endDate) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Both startDate and endDate must be provided for date range filtering'
            }
          })
        };
      }

      try {
        filters.dateRange = {
          start: new Date(startDate),
          end: new Date(endDate)
        };

        // Validate dates
        if (isNaN(filters.dateRange.start.getTime()) || isNaN(filters.dateRange.end.getTime())) {
          throw new Error('Invalid date format');
        }

        if (filters.dateRange.start > filters.dateRange.end) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'startDate must be before endDate'
              }
            })
          };
        }
      } catch (error) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD)'
            }
          })
        };
      }
    }

    // Visibility filter
    if (event.queryStringParameters?.visibility) {
      const visibilityValues = event.queryStringParameters.visibility
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);

      const validVisibility = Object.values(Visibility);
      const invalidVisibility = visibilityValues.filter(
        value => !validVisibility.includes(value as Visibility)
      );

      if (invalidVisibility.length > 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid visibility value(s): ${invalidVisibility.join(', ')}`
            }
          })
        };
      }

      filters.visibility = visibilityValues as Visibility[];
    }

    // Get viewer information from authorizer
    const viewerId = event.requestContext.authorizer?.userId;
    const viewerBadges = event.requestContext.authorizer?.badges
      ? JSON.parse(event.requestContext.authorizer.badges)
      : undefined;
    const isAwsEmployee = event.requestContext.authorizer?.isAwsEmployee === 'true' ||
                          event.requestContext.authorizer?.isAwsEmployee === true;

    // Track search start time for performance metrics
    const searchStartTime = Date.now();

    // Perform search - use singleton instance for connection pool reuse
    const pool = await getDatabasePool();
    const { ContentRepository } = await import('../../repositories/ContentRepository');
    const { EmbeddingService, getEmbeddingService } = await import('../../services/EmbeddingService');
    const { getSearchService } = await import('../../services/SearchService');

    // Create service instances (singleton pattern will reuse across invocations)
    const contentRepo = new ContentRepository(pool);
    const embeddingService = getEmbeddingService();
    const cloudwatch = new CloudWatchClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const searchService = getSearchService(contentRepo, embeddingService, cloudwatch);

    // Use hybrid search for better results (combines semantic + keyword search)
    const results = await searchService.search(
      {
        query,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        limit,
        offset
      },
      !!viewerId,  // isAuthenticated
      viewerBadges || [],
      isAwsEmployee  // isAwsEmployee flag for AWS_ONLY content access
    );

    // Calculate search latency
    const searchLatency = Date.now() - searchStartTime;

    // Log search analytics (fire and forget)
    logSearchAnalytics({
      query,
      resultCount: results.total,
      latency: searchLatency,
      userId: viewerId,
      filters,
      timestamp: new Date()
    }).catch(err => {
      console.warn('Failed to log search analytics:', err.message);
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(results)
    };
  } catch (error: any) {
    console.error('Search error:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while performing the search'
        }
      })
    };
  }
};

/**
 * Log search analytics to CloudWatch for tracking and monitoring
 */
async function logSearchAnalytics(analytics: {
  query: string;
  resultCount: number;
  latency: number;
  userId?: string;
  filters: any;
  timestamp: Date;
}): Promise<void> {
  const cloudwatch = new CloudWatchClient({
    region: process.env.AWS_REGION || 'us-east-1'
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
