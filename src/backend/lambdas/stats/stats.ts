import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { buildCorsHeaders } from '../../services/cors';

/**
 * GET /stats - Get platform statistics
 * Returns real-time statistics about the platform
 *
 * Response:
 * {
 *   totalUsers: number,
 *   totalContent: number,
 *   contentByType: { [type: string]: number },
 *   recentActivity: {
 *     last24h: number,
 *     last7d: number,
 *     last30d: number
 *   },
 *   topContributors: number
 * }
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const originHeader = event.headers?.Origin || event.headers?.origin || undefined;
  const headers = {
    ...buildCorsHeaders({ origin: originHeader, methods: 'GET,OPTIONS' }),
    'Content-Type': 'application/json',
  };

  try {
    // Get database connection
    const pool = await getDatabasePool();

    // Execute statistics queries in parallel for performance
    const [
      totalUsersResult,
      totalContentResult,
      contentByTypeResult,
      recentActivityResult,
      topContributorsResult
    ] = await Promise.all([
      // Total users count
      pool.query('SELECT COUNT(*) as count FROM users'),

      // Total content count
      pool.query('SELECT COUNT(*) as count FROM content'),

      // Content breakdown by type
      pool.query(`
        SELECT
          content_type,
          COUNT(*) as count
        FROM content
        GROUP BY content_type
        ORDER BY count DESC
      `),

      // Recent activity metrics
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as last_24h,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as last_7d,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as last_30d
        FROM content
      `),

      // Count of users with claimed content (contributors)
      pool.query(`
        SELECT COUNT(DISTINCT user_id) as count
        FROM content
        WHERE is_claimed = true
      `)
    ]);

    // Parse results
    const totalUsers = parseInt(totalUsersResult.rows[0]?.count || '0', 10);
    const totalContent = parseInt(totalContentResult.rows[0]?.count || '0', 10);

    const contentByType: { [key: string]: number } = {};
    contentByTypeResult.rows.forEach((row: any) => {
      contentByType[row.content_type] = parseInt(row.count, 10);
    });

    const recentActivity = {
      last24h: parseInt(recentActivityResult.rows[0]?.last_24h || '0', 10),
      last7d: parseInt(recentActivityResult.rows[0]?.last_7d || '0', 10),
      last30d: parseInt(recentActivityResult.rows[0]?.last_30d || '0', 10)
    };

    const topContributors = parseInt(topContributorsResult.rows[0]?.count || '0', 10);

    // Return statistics
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        totalUsers,
        totalContent,
        contentByType,
        recentActivity,
        topContributors
      })
    };
  } catch (error: any) {
    console.error('Stats retrieval error:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve statistics'
        }
      })
    };
  }
};
