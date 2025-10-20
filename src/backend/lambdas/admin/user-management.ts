import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';
import { BadgeType } from '@aws-community-hub/shared';

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
 * GET /admin/users
 * List users with search and filters
 */
async function handleListUsers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  const pool = await getDatabasePool();
  const params = event.queryStringParameters || {};

  const search = params.search || '';
  const badgeType = params.badgeType as BadgeType | undefined;
  const limit = parseInt(params.limit || '50', 10);
  const offset = parseInt(params.offset || '0', 10);

  try {
    let query = `
      SELECT DISTINCT u.id, u.username, u.email, u.is_admin, u.is_aws_employee, u.created_at
      FROM users u
    `;

    const conditions: string[] = [];
    const values: any[] = [];

    if (badgeType) {
      query += ` LEFT JOIN user_badges ub ON u.id = ub.user_id`;
      conditions.push(`ub.badge_type = $${values.length + 1}`);
      values.push(badgeType);
    }

    if (search) {
      conditions.push(`(u.username ILIKE $${values.length + 1} OR u.email ILIKE $${values.length + 1})`);
      values.push(`%${search}%`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY u.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const usersResult = await pool.query(query, values);

    // Get total count
    let countQuery = `SELECT COUNT(DISTINCT u.id) as count FROM users u`;
    if (badgeType) {
      countQuery += ` LEFT JOIN user_badges ub ON u.id = ub.user_id`;
    }
    if (conditions.length > 0) {
      countQuery += ` WHERE ${conditions.join(' AND ')}`;
    }

    const countResult = await pool.query(countQuery, values.slice(0, -2));
    const total = parseInt(countResult.rows[0].count, 10);

    return createSuccessResponse(200, {
      success: true,
      data: {
        users: usersResult.rows.map((row: any) => ({
          id: row.id,
          username: row.username,
          email: row.email,
          isAdmin: row.is_admin,
          isAwsEmployee: row.is_aws_employee,
          createdAt: row.created_at,
        })),
        total,
        limit,
        offset,
      },
    });
  } catch (error: any) {
    console.error('List users error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to list users');
  }
}

/**
 * GET /admin/users/:id
 * Get user details with badges and content stats
 */
async function handleGetUser(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  const userId = event.pathParameters?.id;
  if (!userId) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'User ID required');
  }

  const pool = await getDatabasePool();

  try {
    // Get user
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return createErrorResponse(404, 'NOT_FOUND', 'User not found');
    }

    const user = userResult.rows[0];

    // Get badges
    const badgesResult = await pool.query(
      'SELECT badge_type, awarded_at FROM user_badges WHERE user_id = $1 AND is_active = true',
      [userId]
    );

    // Get content count
    const contentResult = await pool.query(
      'SELECT COUNT(*) as content_count FROM content WHERE user_id = $1 AND deleted_at IS NULL',
      [userId]
    );

    return createSuccessResponse(200, {
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          isAdmin: user.is_admin,
          isAwsEmployee: user.is_aws_employee,
          createdAt: user.created_at,
        },
        badges: badgesResult.rows.map((row: any) => ({
          badgeType: row.badge_type,
          awardedAt: row.awarded_at,
        })),
        contentCount: parseInt(contentResult.rows[0].content_count, 10),
      },
    });
  } catch (error: any) {
    console.error('Get user error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to get user details');
  }
}

/**
 * POST /admin/users/export
 * Export user list as CSV
 */
async function handleExportUsers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  const pool = await getDatabasePool();

  try {
    const usersResult = await pool.query(`
      SELECT id, username, email, is_admin, is_aws_employee, created_at
      FROM users
      ORDER BY created_at DESC
    `);

    const csvRows = [
      'ID,Username,Email,Is Admin,Is AWS Employee,Created At',
      ...usersResult.rows.map((row: any) =>
        [
          row.id,
          row.username,
          row.email,
          row.is_admin,
          row.is_aws_employee,
          row.created_at,
        ].join(',')
      ),
    ];

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="users.csv"',
      },
      body: csvRows.join('\n'),
    };
  } catch (error: any) {
    console.error('Export users error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to export users');
  }
}

export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  const path = event.path || '';
  const method = (event.httpMethod || 'GET').toUpperCase();

  try {
    if (method === 'GET' && path === '/admin/users') {
      return await handleListUsers(event);
    }

    if (method === 'GET' && /^\/admin\/users\/[^/]+$/.test(path)) {
      return await handleGetUser(event);
    }

    if (method === 'POST' && path === '/admin/users/export') {
      return await handleExportUsers(event);
    }

    return createErrorResponse(404, 'NOT_FOUND', `Route not found: ${method} ${path}`);
  } catch (error) {
    console.error('Unhandled user management error', { path, method, error });
    return createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
}
