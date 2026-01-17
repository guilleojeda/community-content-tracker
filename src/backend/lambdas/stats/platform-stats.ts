import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { getCacheClient } from '../../services/cache/cache';
import { buildCorsHeaders } from '../../services/cors';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

/**
 * GET /stats - Get platform statistics
 * Returns aggregate statistics about the platform
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const originHeader = event.headers?.Origin || event.headers?.origin || undefined;
  const headers = {
    ...buildCorsHeaders({ origin: originHeader, methods: 'GET,OPTIONS' }),
    'Content-Type': 'application/json',
  };

  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    const cache = await getCacheClient();
    const cacheKey = 'platform-stats';
    const rateLimit = await applyRateLimit(event, { resource: 'stats', skipIfAuthorized: true });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit({
        statusCode: 429,
        headers,
        body: JSON.stringify({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests from this IP address',
          },
        }),
      });
    }

    const cached = await cache.get<any>(cacheKey);
    if (cached) {
      return withRateLimit({
        statusCode: 200,
        headers: {
          ...headers,
          'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=30',
        },
        body: JSON.stringify(cached),
      });
    }

    const pool = await getDatabasePool();
    const isInMemory = process.env.TEST_DB_INMEMORY === 'true';

    let statsPayload: {
      totalUsers: number;
      totalContent: number;
      topContributors: number;
      contentByType: Record<string, number>;
      recentActivity: { last24h: number; last7d: number; last30d: number };
      uptime: string;
      lastUpdated: string;
    };

    if (isInMemory) {
      const [
        usersResult,
        contentResult,
        contributorsResult,
        contentTypeResult,
        recentContentResult,
      ] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS total_users FROM users'),
        pool.query('SELECT COUNT(*)::int AS total_content FROM content'),
        pool.query(
          'SELECT COUNT(DISTINCT user_id)::int AS top_contributors FROM content WHERE is_claimed = true AND user_id IS NOT NULL'
        ),
        pool.query('SELECT content_type, COUNT(*)::int AS count FROM content GROUP BY content_type'),
        pool.query('SELECT created_at FROM content'),
      ]);

      const totalUsers = Number(usersResult.rows[0]?.total_users) || 0;
      const totalContent = Number(contentResult.rows[0]?.total_content) || 0;
      const topContributors = Number(contributorsResult.rows[0]?.top_contributors) || 0;

      const contentByType = (contentTypeResult.rows || []).reduce<Record<string, number>>((acc, row: any) => {
        if (row.content_type) {
          acc[row.content_type] = Number(row.count) || 0;
        }
        return acc;
      }, {});

      const now = Date.now();
      const last24hThreshold = now - 24 * 60 * 60 * 1000;
      const last7dThreshold = now - 7 * 24 * 60 * 60 * 1000;
      const last30dThreshold = now - 30 * 24 * 60 * 60 * 1000;

      const recentActivity = {
        last24h: 0,
        last7d: 0,
        last30d: 0,
      };

      (recentContentResult.rows || []).forEach((row: any) => {
        const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
        if (!createdAt) {
          return;
        }
        if (createdAt >= last24hThreshold) {
          recentActivity.last24h += 1;
        }
        if (createdAt >= last7dThreshold) {
          recentActivity.last7d += 1;
        }
        if (createdAt >= last30dThreshold) {
          recentActivity.last30d += 1;
        }
      });

      statsPayload = {
        totalUsers,
        totalContent,
        topContributors,
        contentByType,
        recentActivity,
        uptime: '24/7',
        lastUpdated: new Date().toISOString(),
      };
    } else {
      const statsResult = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM users) AS total_users,
          (SELECT COUNT(*) FROM content) AS total_content,
          (SELECT COUNT(DISTINCT user_id) FROM content WHERE is_claimed = true AND user_id IS NOT NULL) AS top_contributors,
          (
            SELECT COALESCE(json_object_agg(content_type, content_count), '{}'::json)
            FROM (
              SELECT content_type, COUNT(*)::int AS content_count
              FROM content
              GROUP BY content_type
            ) type_counts
          ) AS content_by_type,
          (
            SELECT json_build_object(
              'last24h', COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours'),
              'last7d', COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'),
              'last30d', COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')
            )
            FROM content
          ) AS recent_activity
      `);

      const resultRow = statsResult.rows[0] ?? {};

      const totalUsers = Number(resultRow.total_users) || 0;
      const totalContent = Number(resultRow.total_content) || 0;
      const topContributors = Number(resultRow.top_contributors) || 0;

      const contentByTypeSource = resultRow.content_by_type;
      let parsedContentByType: Record<string, unknown> = {};
      if (typeof contentByTypeSource === 'string') {
        try {
          parsedContentByType = JSON.parse(contentByTypeSource) ?? {};
        } catch {
          parsedContentByType = {};
        }
      } else if (contentByTypeSource && typeof contentByTypeSource === 'object') {
        parsedContentByType = contentByTypeSource as Record<string, unknown>;
      }

      const contentByType = Object.entries(parsedContentByType).reduce<Record<string, number>>((acc, [key, value]) => {
        acc[key] = Number(value) || 0;
        return acc;
      }, {});

      const recentActivitySource = resultRow.recent_activity;
      let parsedRecentActivity: Record<string, unknown> = {};
      if (typeof recentActivitySource === 'string') {
        try {
          parsedRecentActivity = JSON.parse(recentActivitySource) ?? {};
        } catch {
          parsedRecentActivity = {};
        }
      } else if (recentActivitySource && typeof recentActivitySource === 'object') {
        parsedRecentActivity = recentActivitySource as Record<string, unknown>;
      }

      const rawRecentActivity = parsedRecentActivity;
      const recentActivity = {
        last24h: Number(rawRecentActivity.last24h) || 0,
        last7d: Number(rawRecentActivity.last7d) || 0,
        last30d: Number(rawRecentActivity.last30d) || 0,
      };

      statsPayload = {
        totalUsers,
        totalContent,
        topContributors,
        contentByType,
        recentActivity,
        uptime: '24/7',
        lastUpdated: new Date().toISOString(),
      };
    }

    const payload = withRateLimit({
      statusCode: 200,
      headers: {
        ...headers,
        'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=30',
      },
      body: JSON.stringify(statsPayload)
    });

    const ttlRaw = process.env.STATS_CACHE_TTL;
    if (!ttlRaw || ttlRaw.trim().length === 0) {
      throw new Error('STATS_CACHE_TTL must be set');
    }
    const ttlSeconds = Number(ttlRaw);
    if (Number.isNaN(ttlSeconds)) {
      throw new Error('STATS_CACHE_TTL must be a valid number');
    }
    await cache.set(cacheKey, statsPayload, ttlSeconds);
    return payload;
  } catch (error: any) {
    console.error('Stats error:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while fetching statistics'
        }
      })
    };
  }
};
