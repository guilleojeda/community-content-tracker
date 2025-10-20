import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { BadgeType } from '@aws-community-hub/shared';

/**
 * Extract admin context from API Gateway event
 */
function extractAdminContext(event: APIGatewayProxyEvent) {
  const authorizer: any = event.requestContext?.authorizer || {};
  const claims: any = authorizer.claims || {};

  const isAdminFlag =
    authorizer.isAdmin === true ||
    authorizer.isAdmin === 'true' ||
    (Array.isArray(claims['cognito:groups'])
      ? claims['cognito:groups'].includes('Admin')
      : typeof claims['cognito:groups'] === 'string'
      ? claims['cognito:groups'].split(',').includes('Admin')
      : false);

  const adminUserId = authorizer.userId || claims.sub || claims['cognito:username'];

  return {
    isAdmin: !!isAdminFlag,
    adminUserId,
  };
}

/**
 * GET /admin/dashboard/stats
 * Returns comprehensive admin dashboard statistics
 */
async function handleDashboardStats(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  const pool = await getDatabasePool();

  try {
    // Get user statistics
    const userStatsQuery = `
      SELECT
        COUNT(*) AS total_users,
        COUNT(*) FILTER (WHERE is_aws_employee = true) AS aws_employees
      FROM users
    `;
    const userStatsResult = await pool.query(userStatsQuery);
    const userStats = userStatsResult.rows[0];

    // Get user count by badge type
    const badgeStatsQuery = `
      SELECT
        badge_type,
        COUNT(DISTINCT user_id) AS count
      FROM user_badges
      WHERE is_active = true
      GROUP BY badge_type
    `;
    const badgeStatsResult = await pool.query(badgeStatsQuery);
    const usersByBadgeType: Record<string, number> = {};
    badgeStatsResult.rows.forEach((row: any) => {
      usersByBadgeType[row.badge_type] = parseInt(row.count, 10);
    });

    // Get content statistics
    const contentStatsQuery = `
      SELECT COUNT(*) AS total_content
      FROM content
      WHERE deleted_at IS NULL
    `;
    const contentStatsResult = await pool.query(contentStatsQuery);
    const contentStats = contentStatsResult.rows[0];

    // Get recent registrations (last 10)
    const recentRegistrationsQuery = `
      SELECT id, username, email, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 10
    `;
    const recentRegistrationsResult = await pool.query(recentRegistrationsQuery);

    // Get pending badge candidates (users with content but no badges)
    const pendingBadgeCandidatesQuery = `
      SELECT
        u.id,
        u.username,
        u.email,
        COUNT(DISTINCT c.id) AS content_count,
        u.created_at
      FROM users u
      LEFT JOIN user_badges ub ON u.id = ub.user_id AND ub.is_active = true
      LEFT JOIN content c ON u.id = c.user_id AND c.deleted_at IS NULL
      WHERE ub.id IS NULL
        AND u.is_admin = false
      GROUP BY u.id, u.username, u.email, u.created_at
      HAVING COUNT(DISTINCT c.id) > 0
      ORDER BY COUNT(DISTINCT c.id) DESC, u.created_at ASC
      LIMIT 10
    `;
    const pendingBadgeCandidatesResult = await pool.query(pendingBadgeCandidatesQuery);

    // Get quick actions panel data
    // 1. Flagged content count
    const flaggedContentQuery = `
      SELECT COUNT(*) AS flagged_count
      FROM content
      WHERE is_flagged = true
        AND deleted_at IS NULL
        AND moderation_status != 'removed'
    `;
    const flaggedContentResult = await pool.query(flaggedContentQuery);

    // 2. Recent admin actions (last 24 hours)
    const recentAdminActionsQuery = `
      SELECT COUNT(*) AS recent_actions
      FROM admin_actions
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `;
    const recentAdminActionsResult = await pool.query(recentAdminActionsQuery);

    // 3. Active users without badges
    const usersWithoutBadgesQuery = `
      SELECT COUNT(*) AS users_without_badges
      FROM users u
      LEFT JOIN user_badges ub ON u.id = ub.user_id AND ub.is_active = true
      WHERE ub.id IS NULL
        AND u.is_admin = false
    `;
    const usersWithoutBadgesResult = await pool.query(usersWithoutBadgesQuery);

    // 4. Content needing review (recently published, not yet reviewed)
    const contentNeedingReviewQuery = `
      SELECT COUNT(*) AS content_needing_review
      FROM content
      WHERE deleted_at IS NULL
        AND moderation_status = 'flagged'
        AND (
          flagged_at IS NULL
          OR flagged_at > NOW() - INTERVAL '7 days'
        )
    `;
    const contentNeedingReviewResult = await pool.query(contentNeedingReviewQuery);

    return createSuccessResponse(200, {
      success: true,
      data: {
        totalUsers: parseInt(userStats.total_users, 10),
        awsEmployees: parseInt(userStats.aws_employees, 10),
        usersByBadgeType,
        totalContent: parseInt(contentStats.total_content, 10),
        recentRegistrations: recentRegistrationsResult.rows.map((row: any) => ({
          id: row.id,
          username: row.username,
          email: row.email,
          createdAt: row.created_at,
        })),
        pendingBadgeCandidates: pendingBadgeCandidatesResult.rows.map((row: any) => ({
          id: row.id,
          username: row.username,
          email: row.email,
          contentCount: parseInt(row.content_count, 10),
          createdAt: row.created_at,
        })),
        quickActions: {
          flaggedContentCount: parseInt(flaggedContentResult.rows[0].flagged_count, 10),
          recentAdminActions: parseInt(recentAdminActionsResult.rows[0].recent_actions, 10),
          usersWithoutBadges: parseInt(usersWithoutBadgesResult.rows[0].users_without_badges, 10),
          contentNeedingReview: parseInt(contentNeedingReviewResult.rows[0].content_needing_review, 10),
        },
      },
    });
  } catch (error: any) {
    console.error('Dashboard stats error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to fetch dashboard statistics');
  }
}

/**
 * GET /admin/dashboard/system-health
 * Returns comprehensive system health indicators
 */
async function handleSystemHealth(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  const pool = await getDatabasePool();
  const healthData: any = {
    database: 'unhealthy',
    timestamp: new Date().toISOString(),
  };

  try {
    // Check database connectivity with query performance timing
    const queryStartTime = Date.now();
    await pool.query('SELECT 1');
    const queryEndTime = Date.now();
    const queryDurationMs = queryEndTime - queryStartTime;

    healthData.database = 'healthy';
    healthData.queryPerformance = {
      lastQueryMs: queryDurationMs,
    };

    // Get connection pool metrics
    try {
      const poolStatsQuery = `
        SELECT
          count(*) as total_connections,
          count(*) FILTER (WHERE state = 'active') as active_connections,
          count(*) FILTER (WHERE state = 'idle') as idle_connections,
          count(*) FILTER (WHERE wait_event IS NOT NULL) as waiting_connections
        FROM pg_stat_activity
        WHERE datname = current_database()
      `;
      const poolStatsResult = await pool.query(poolStatsQuery);
      const poolStats = poolStatsResult.rows[0];

      healthData.connectionPool = {
        totalConnections: parseInt(poolStats.total_connections, 10),
        activeConnections: parseInt(poolStats.active_connections, 10),
        idleConnections: parseInt(poolStats.idle_connections, 10),
        waitingConnections: parseInt(poolStats.waiting_connections, 10),
      };
    } catch (poolError: any) {
      console.warn('Failed to fetch connection pool metrics:', poolError.message);
      // Continue without pool metrics - not critical
    }

    // Get Lambda memory usage from context
    if (context && context.memoryLimitInMB) {
      const memoryUsedMB = Math.round(
        (process.memoryUsage().heapUsed + process.memoryUsage().external) / 1024 / 1024
      );
      healthData.lambda = {
        memoryUsedMB,
        memoryLimitMB: parseInt(context.memoryLimitInMB as any, 10),
      };
    }

    return createSuccessResponse(200, {
      success: true,
      data: healthData,
    });
  } catch (error: any) {
    console.error('System health check error:', error);
    healthData.error = error.message;

    return createSuccessResponse(200, {
      success: true,
      data: healthData,
    });
  }
}

/**
 * Main Lambda handler
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  const path = event.path || '';
  const method = (event.httpMethod || 'GET').toUpperCase();

  try {
    if (method === 'GET' && path === '/admin/dashboard/stats') {
      return await handleDashboardStats(event);
    }

    if (method === 'GET' && path === '/admin/dashboard/system-health') {
      return await handleSystemHealth(event, context);
    }

    return createErrorResponse(404, 'NOT_FOUND', `Route not found: ${method} ${path}`);
  } catch (error) {
    console.error('Unhandled admin dashboard error', { path, method, error });
    return createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
}
