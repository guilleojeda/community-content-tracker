import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';

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

    // Build date filter
    let dateFilter = '';
    const values: any[] = [userId];

    if (startDate && endDate) {
      dateFilter = ' AND publish_date BETWEEN $2 AND $3';
      values.push(startDate, endDate);
    }

    // Get content by type distribution
    const contentByTypeQuery = `
      SELECT content_type, COUNT(*) as count
      FROM content
      WHERE user_id = $1 AND deleted_at IS NULL ${dateFilter}
      GROUP BY content_type
    `;
    const contentByTypeResult = await pool.query(contentByTypeQuery, values);

    const contentByType: Record<string, number> = {};
    contentByTypeResult.rows.forEach((row: any) => {
      contentByType[row.content_type] = parseInt(row.count, 10);
    });

    // Get top tags
    const topTagsQuery = `
      SELECT UNNEST(tags) as tag, COUNT(*) as count
      FROM content
      WHERE user_id = $1 AND deleted_at IS NULL ${dateFilter}
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 10
    `;
    const topTagsResult = await pool.query(topTagsQuery, values);

    const topTags = topTagsResult.rows.map((row: any) => ({
      tag: row.tag,
      count: parseInt(row.count, 10),
    }));

    // Get top performing content
    const topContentQuery = `
      SELECT id, title, content_type, (metrics->>'views')::int as views
      FROM content
      WHERE user_id = $1 AND deleted_at IS NULL ${dateFilter}
      ORDER BY (metrics->>'views')::int DESC NULLS LAST
      LIMIT 10
    `;
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
    const timeSeriesResult = await pool.query(timeSeriesQuery, values);

    const timeSeries = timeSeriesResult.rows.map((row: any) => ({
      date: row.date.toISOString(),
      views: parseInt(row.views, 10),
    }));

    return createSuccessResponse(200, {
      success: true,
      data: {
        contentByType,
        topTags,
        topContent,
        timeSeries,
        dateRange: startDate && endDate ? { startDate, endDate } : null,
        groupBy,
      },
    });
  } catch (error: any) {
    console.error('User analytics error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to fetch analytics');
  }
}
