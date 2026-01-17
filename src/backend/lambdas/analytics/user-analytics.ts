import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { getCacheClient } from '../../services/cache/cache';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

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
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    rateLimit = await applyRateLimit(event, { resource: 'analytics:user' });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests'));
    }

    // Check authentication
    const authorizer: any = event.requestContext?.authorizer;
    if (!authorizer || !authorizer.userId) {
      return withRateLimit(createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required'));
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
      return withRateLimit(createSuccessResponse(200, cachedResponse));
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
    let topTags: Array<{ tag: string; count: number }> = [];
    if (process.env.TEST_DB_INMEMORY === 'true') {
      const tagsResult = await pool.query(
        `SELECT tags FROM content WHERE user_id = $1 ${dateFilter}`,
        values
      );

      const tagCounts: Record<string, number> = {};
      tagsResult.rows.forEach((row: any) => {
        const rowTags: string[] = Array.isArray(row.tags) ? row.tags : [];
        rowTags.forEach((tag) => {
          const key = tag?.toString() ?? '';
          if (key.length === 0) {
            return;
          }
          tagCounts[key] = (tagCounts[key] ?? 0) + 1;
        });
      });

      topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count }));
    } else {
      await profileQuery(topTagsQuery, values);
      const topTagsResult = await pool.query(topTagsQuery, values);
      topTags = topTagsResult.rows.map((row: any) => ({
        tag: row.tag,
        count: parseInt(row.count, 10),
      }));
    }

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

    const isInMemory = process.env.TEST_DB_INMEMORY === 'true';
    let timeSeries: Array<{ date: string; views: number }> = [];
    if (isInMemory) {
      const eventsResult = await pool.query(
        `SELECT created_at FROM analytics_events WHERE user_id = $1 AND event_type = 'content_view' ${timeSeriesFilter}`,
        values
      );

      const truncateDate = (input: Date, unit: string): Date | null => {
        if (!(input instanceof Date) || Number.isNaN(input.getTime())) {
          return null;
        }

        const result = new Date(input.getTime());
        const normalized = unit.toLowerCase();

        switch (normalized) {
          case 'hour':
            result.setUTCMinutes(0, 0, 0);
            break;
          case 'day':
            result.setUTCHours(0, 0, 0, 0);
            break;
          case 'week': {
            const day = result.getUTCDay();
            const diff = (day + 6) % 7; // move to Monday
            result.setUTCDate(result.getUTCDate() - diff);
            result.setUTCHours(0, 0, 0, 0);
            break;
          }
          case 'month':
            result.setUTCDate(1);
            result.setUTCHours(0, 0, 0, 0);
            break;
          case 'quarter': {
            const month = result.getUTCMonth();
            const firstMonthOfQuarter = month - (month % 3);
            result.setUTCMonth(firstMonthOfQuarter, 1);
            result.setUTCHours(0, 0, 0, 0);
            break;
          }
          case 'year':
            result.setUTCMonth(0, 1);
            result.setUTCHours(0, 0, 0, 0);
            break;
          default:
            result.setUTCHours(0, 0, 0, 0);
            break;
        }

        return result;
      };

      const counts: Record<string, number> = {};
      eventsResult.rows.forEach((row: any) => {
        const createdAt = row.created_at ? new Date(row.created_at) : null;
        if (!createdAt) {
          return;
        }
        const truncated = truncateDate(createdAt, groupBy);
        if (!truncated) {
          return;
        }
        const key = truncated.toISOString();
        counts[key] = (counts[key] ?? 0) + 1;
      });

      timeSeries = Object.entries(counts)
        .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
        .map(([date, views]) => ({ date, views }));
    } else {
      const timeSeriesQuery = `
        SELECT DATE_TRUNC('${groupBy}', created_at) as date, COUNT(*) as views
        FROM analytics_events
        WHERE user_id = $1 AND event_type = 'content_view' ${timeSeriesFilter}
        GROUP BY date
        ORDER BY date
      `;
      await profileQuery(timeSeriesQuery, values);
      const timeSeriesResult = await pool.query(timeSeriesQuery, values);

      timeSeries = timeSeriesResult.rows.map((row: any) => ({
        date: row.date.toISOString(),
        views: parseInt(row.views, 10),
      }));
    }

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

    return withRateLimit(createSuccessResponse(200, payload));
  } catch (error: any) {
    console.error('User analytics error:', error);
    return attachRateLimitHeaders(
      createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to fetch analytics'),
      rateLimit
    );
  }
}
