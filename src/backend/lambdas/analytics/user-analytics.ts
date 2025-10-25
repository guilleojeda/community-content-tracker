import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { getCacheClient } from '../../services/cache/cache';

/**
 * Valid date grouping periods for DATE_TRUNC
 * SQL injection protection: Only these values are allowed
 */
const VALID_GROUP_BY_PERIODS = ['day', 'week', 'month'] as const;
type GroupByPeriod = typeof VALID_GROUP_BY_PERIODS[number];

/**
 * Validate and sanitize groupBy parameter
 */
function validateGroupByPeriod(groupBy: string | undefined): GroupByPeriod {
  const normalized = (groupBy || 'day').toLowerCase();

  if (VALID_GROUP_BY_PERIODS.includes(normalized as GroupByPeriod)) {
    return normalized as GroupByPeriod;
  }

  // Default to 'day' for invalid values
  return 'day';
}

/**
 * GET /analytics/user
 * Get user's content analytics
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  try {
    // Check authentication
    const authorizer: any = event.requestContext?.authorizer;
    if (!authorizer || !authorizer.userId) {
      return createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    const userId = authorizer.userId;
    const params = event.queryStringParameters || {};
    const startDate = params.startDate;
    const endDate = params.endDate;

    // Validate and sanitize groupBy parameter to prevent SQL injection
    const groupBy = validateGroupByPeriod(params.groupBy);

    const pool = await getDatabasePool();
    const cache = await getCacheClient();
    const cacheKey = [
      'analytics',
      userId,
      groupBy,
      startDate ?? 'all',
      endDate ?? 'all',
    ].join(':');

    const cachedResponse = await cache.get<Record<string, any>>(cacheKey);
    if (cachedResponse) {
      return createSuccessResponse(200, cachedResponse);
    }

    // Build date filter
    let dateFilter = '';
    const values: any[] = [userId];

    if (startDate && endDate) {
      dateFilter = ' AND publish_date BETWEEN $2 AND $3';
      values.push(startDate, endDate);
    }

    const shouldProfileQueries = process.env.ENABLE_QUERY_PROFILING === 'true';
    const profileQuery = async (sql: string, params: any[]) => {
      if (!shouldProfileQueries) {
        return;
      }
      try {
        await pool.query(`EXPLAIN ANALYZE ${sql}`, params);
      } catch (profilingError: any) {
        console.warn('Analytics profiling failed:', profilingError?.message ?? profilingError);
      }
    };

    // Get content by type distribution
    const contentByTypeQuery = `
      SELECT content_type, COUNT(*) as count
      FROM content
      WHERE user_id = $1 ${dateFilter}
      GROUP BY content_type
    `;
    await profileQuery(contentByTypeQuery, values);
    const contentByTypeResult = await pool.query(contentByTypeQuery, values);

    const contentByType: Record<string, number> = {};
    contentByTypeResult.rows.forEach((row: any) => {
      contentByType[row.content_type] = parseInt(row.count, 10);
    });

    // Get top tags
    const topTagsQuery = `
      SELECT UNNEST(tags) as tag, COUNT(*) as count
      FROM content
      WHERE user_id = $1 ${dateFilter}
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 10
    `;
    await profileQuery(topTagsQuery, values);
    const topTagsResult = await pool.query(topTagsQuery, values);

    const topTags = topTagsResult.rows.map((row: any) => ({
      tag: row.tag,
      count: parseInt(row.count, 10),
    }));

    // Get top performing content
    const topContentQuery = `
      SELECT id, title, content_type, COALESCE((metrics->>'views')::int, 0) as views
      FROM content
      WHERE user_id = $1 ${dateFilter}
      ORDER BY COALESCE((metrics->>'views')::int, 0) DESC NULLS LAST
      LIMIT 10
    `;
    await profileQuery(topContentQuery, values);
    const topContentResult = await pool.query(topContentQuery, values);

    const topContent = topContentResult.rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      contentType: row.content_type,
      views: row.views || 0,
    }));

    // Get time series data for views over time
    // groupBy is now validated and safe to use in SQL query
    const timeSeriesFilter = startDate && endDate ? ' AND created_at BETWEEN $2 AND $3' : '';

    const timeSeriesQuery = `
      SELECT DATE_TRUNC('${groupBy}', created_at) as date, COUNT(*) as views
      FROM analytics_events
      WHERE user_id = $1 AND event_type = 'content_view' ${timeSeriesFilter}
      GROUP BY date
      ORDER BY date
    `;
    await profileQuery(timeSeriesQuery, values);
    const timeSeriesResult = await pool.query(timeSeriesQuery, values);

    const timeSeries = timeSeriesResult.rows.map((row: any) => ({
      date: row.date.toISOString(),
      views: parseInt(row.views, 10),
    }));

    const payload = {
      success: true,
      data: {
        contentByType,
        topTags,
        topContent,
        timeSeries,
        dateRange: startDate && endDate ? { startDate, endDate } : null,
        groupBy,
      },
    };

    await cache.set(cacheKey, payload, 300);

    return createSuccessResponse(200, payload);
  } catch (error: any) {
    console.error('User analytics error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to fetch analytics');
  }
}
