import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';

/**
 * GET /stats - Get platform statistics
 * Returns aggregate statistics about the platform
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Content-Type': 'application/json'
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
    const pool = await getDatabasePool();

    const statsQuery = `
      SELECT
        COUNT(DISTINCT user_id) FILTER (WHERE is_claimed = true) AS contributors,
        COUNT(*) AS content_pieces,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS daily_content,
        COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS weekly_active_users
      FROM content
    `;

    const [stats] = (await pool.query(statsQuery)).rows;
    const contributors = Number(stats?.contributors) || 0;
    const contentPieces = Number(stats?.content_pieces) || 0;
    const dailyContent = Number(stats?.daily_content) || 0;
    const weeklyActiveUsers = Number(stats?.weekly_active_users) || 0;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        contributors,
        contentPieces,
        dailyContent,
        weeklyActiveUsers,
        uptime: '24/7',
        lastUpdated: new Date().toISOString()
      })
    };
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
