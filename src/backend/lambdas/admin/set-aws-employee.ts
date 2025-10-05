import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { Pool } from 'pg';
import { UserRepository } from '../../repositories/UserRepository';
import { AuditLogService } from '../../services/AuditLogService';
import {
  createErrorResponse,
  createSuccessResponse,
  parseRequestBody,
} from '../auth/utils';

let pool: Pool | null = null;

function getDbPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  return pool;
}

interface SetAwsEmployeeRequest {
  isAwsEmployee: boolean;
}

/**
 * Set AWS employee status Lambda handler
 * PUT /admin/users/:id/aws-employee
 * Requires admin authentication
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Set AWS employee status request:', JSON.stringify(event, null, 2));

  try {
    // Check admin authentication
    const adminUserId = event.requestContext.authorizer?.userId;
    const isAdmin = event.requestContext.authorizer?.isAdmin === 'true' ||
                    event.requestContext.authorizer?.isAdmin === true;

    if (!isAdmin) {
      return createErrorResponse(
        403,
        'FORBIDDEN',
        'Admin privileges required'
      );
    }

    // Get user ID from path parameter
    const targetUserId = event.pathParameters?.id;
    if (!targetUserId) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'User ID is required in path'
      );
    }

    // Parse request body
    const { data: requestBody, error: parseError } = parseRequestBody<SetAwsEmployeeRequest>(event.body);
    if (parseError) {
      return parseError;
    }

    // Validate isAwsEmployee field
    if (requestBody?.isAwsEmployee === undefined || requestBody?.isAwsEmployee === null) {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'isAwsEmployee field is required (boolean)'
      );
    }

    if (typeof requestBody.isAwsEmployee !== 'boolean') {
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'isAwsEmployee must be a boolean value'
      );
    }

    const dbPool = getDbPool();
    const userRepository = new UserRepository(dbPool);
    const auditLogService = new AuditLogService(dbPool);

    // Verify target user exists
    const targetUser = await userRepository.findById(targetUserId);
    if (!targetUser) {
      return createErrorResponse(
        404,
        'NOT_FOUND',
        'User not found'
      );
    }

    // Check if status is already set to the requested value
    if (targetUser.isAwsEmployee === requestBody.isAwsEmployee) {
      return createSuccessResponse(200, {
        message: `User AWS employee status is already ${requestBody.isAwsEmployee}`,
        user: {
          id: targetUser.id,
          username: targetUser.username,
          email: targetUser.email,
          isAwsEmployee: targetUser.isAwsEmployee,
        },
      });
    }

    // Update AWS employee status
    const updatedUser = await userRepository.update(targetUserId, {
      isAwsEmployee: requestBody.isAwsEmployee,
    });

    if (!updatedUser) {
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Failed to update user AWS employee status'
      );
    }

    // Log AWS employee status change in audit trail
    await auditLogService.logAwsEmployeeChange(
      adminUserId!,
      targetUserId,
      requestBody.isAwsEmployee,
      {
        previousValue: targetUser.isAwsEmployee,
        newValue: requestBody.isAwsEmployee,
      }
    );

    console.log('AWS employee status updated:', {
      userId: targetUserId,
      isAwsEmployee: requestBody.isAwsEmployee,
      updatedBy: adminUserId,
      timestamp: new Date().toISOString(),
    });

    return createSuccessResponse(200, {
      message: `AWS employee status updated to ${requestBody.isAwsEmployee}`,
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        isAwsEmployee: updatedUser.isAwsEmployee,
        updatedAt: updatedUser.updatedAt,
      },
    });

  } catch (error: any) {
    console.error('Unexpected set AWS employee error:', error);
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred'
    );
  }
}