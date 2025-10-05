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

    // Get platform statistics with a single optimized query
    const statsQuery = `
      SELECT
        (SELECT COUNT(DISTINCT user_id) FROM content WHERE is_claimed = true) as contributors,
        (SELECT COUNT(*) FROM content) as content_pieces,
        (SELECT COUNT(*) FROM content WHERE created_at >= NOW() - INTERVAL '24 hours') as daily_content,
        (SELECT COUNT(DISTINCT user_id) FROM users WHERE created_at >= NOW() - INTERVAL '7 days') as weekly_active_users
    `;

    const result = await pool.query(statsQuery);
    const stats = result.rows[0];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        contributors: parseInt(stats.contributors, 10) || 0,
        contentPieces: parseInt(stats.content_pieces, 10) || 0,
        dailyContent: parseInt(stats.daily_content, 10) || 0,
        weeklyActiveUsers: parseInt(stats.weekly_active_users, 10) || 0,
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
