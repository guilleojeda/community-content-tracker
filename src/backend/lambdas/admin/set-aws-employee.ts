import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { createErrorResponse, createSuccessResponse } from '../auth/utils';

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
 * Extract IP address from event
 */
function extractIpAddress(event: APIGatewayProxyEvent): string | null {
  return event.requestContext?.identity?.sourceIp || null;
}

/**
 * PUT /admin/users/:id/aws-employee
 * Set or unset AWS employee flag for a user
 */
async function handleSetAwsEmployee(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  const userId = event.pathParameters?.id;
  if (!userId) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'User ID required');
  }

  if (!admin.adminUserId) {
    return createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required');
  }

  let body: any;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (error) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  const { isAwsEmployee, reason } = body;

  if (typeof isAwsEmployee !== 'boolean') {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'isAwsEmployee must be a boolean');
  }

  const pool = await getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if user exists
    const userResult = await client.query('SELECT id, is_aws_employee FROM users WHERE id = $1', [
      userId,
    ]);

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return createErrorResponse(404, 'NOT_FOUND', 'User not found');
    }

    const currentStatus = userResult.rows[0].is_aws_employee;

    // Update user's AWS employee status
    await client.query('UPDATE users SET is_aws_employee = $1 WHERE id = $2', [
      isAwsEmployee,
      userId,
    ]);

    // Insert audit record
    const ipAddress = extractIpAddress(event);
    await client.query(
      `INSERT INTO admin_actions (admin_user_id, action_type, target_user_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        admin.adminUserId,
        'set_aws_employee',
        userId,
        JSON.stringify({
          isAwsEmployee,
          previousStatus: currentStatus,
          reason: reason || null,
        }),
        ipAddress,
      ]
    );

    await client.query('COMMIT');

    return createSuccessResponse(200, {
      success: true,
      data: {
        userId,
        isAwsEmployee,
        previousStatus: currentStatus,
      },
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Set AWS employee error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to update AWS employee status');
  } finally {
    client.release();
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
    if (method === 'PUT' && /^\/admin\/users\/[^/]+\/aws-employee$/.test(path)) {
      return await handleSetAwsEmployee(event);
    }

    return createErrorResponse(404, 'NOT_FOUND', `Route not found: ${method} ${path}`);
  } catch (error) {
    console.error('Unhandled set-aws-employee error', { path, method, error });
    return createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
}
