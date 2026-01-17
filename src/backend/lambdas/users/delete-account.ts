import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CognitoIdentityProviderClient, DeleteUserCommand, AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { UserRepository } from '../../repositories/UserRepository';
import { DeleteAccountResponse } from '../../../shared/types';
import {
  createErrorResponse,
  createSuccessResponse,
  extractTokenFromHeader,
} from '../auth/utils';
import { getDatabasePool } from '../../services/database';
import { getAuthEnvironment } from '../auth/config';
import { AuditLogService } from '../../services/AuditLogService';
import { resolveAuthorizerContext } from '../../services/authorizerContext';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

// Cognito client instance
let cognitoClient: CognitoIdentityProviderClient | null = null;

/**
 * Get Cognito client instance
 */
function getCognitoClient(): CognitoIdentityProviderClient {
  if (!cognitoClient) {
    const authEnv = getAuthEnvironment();
    cognitoClient = new CognitoIdentityProviderClient({
      region: authEnv.region,
    });
  }
  return cognitoClient;
}

/**
 * Delete user account Lambda handler
 * DELETE /users/:id
 *
 * Performs complete account deletion:
 * 1. Deletes user from Cognito
 * 2. Deletes user data from database (cascades to related tables)
 * 3. Logs deletion for audit trail
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Delete account request:', JSON.stringify(event, null, 2));

  const originHeader = event.headers?.Origin || event.headers?.origin || undefined;
  const corsOptions = { origin: originHeader, methods: 'DELETE,OPTIONS', allowCredentials: true };
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    const isLocalAuthMode = process.env.LOCAL_AUTH_MODE === 'true';
    rateLimit = await applyRateLimit(event, { resource: 'users:delete-account' });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);
    const respondError = (
      statusCode: number,
      code: string,
      message: string,
      details?: Record<string, unknown>
    ) => withRateLimit(createErrorResponse(statusCode, code, message, details, corsOptions));
    const respondSuccess = (statusCode: number, body: Record<string, unknown> | DeleteAccountResponse) =>
      withRateLimit(createSuccessResponse(statusCode, body as Record<string, unknown>, corsOptions));

    if (rateLimit && !rateLimit.allowed) {
      return respondError(429, 'RATE_LIMITED', 'Too many requests');
    }

    const authContext = resolveAuthorizerContext(event.requestContext?.authorizer as any);
    if (!authContext.userId) {
      return respondError(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    // Extract user ID from path parameters
    const rawUserId = event.pathParameters?.id;
    if (!rawUserId) {
      return respondError(400, 'VALIDATION_ERROR', 'User ID is required');
    }
    const targetUserId = rawUserId === 'me' ? authContext.userId : rawUserId;

    // Check if authenticated user is deleting their own account (or is admin)
    if (authContext.userId !== targetUserId && !authContext.isAdmin) {
      return respondError(403, 'PERMISSION_DENIED', 'You can only delete your own account');
    }

    // Get user to verify existence
    const dbPool = await getDatabasePool();
    const userRepository = new UserRepository(dbPool);
    const userToDelete = await userRepository.findById(targetUserId);
    if (!userToDelete) {
      return respondError(404, 'NOT_FOUND', 'User not found');
    }

    // Log deletion for audit trail
    console.log('Deleting account for user:', {
      userId: userToDelete.id,
      email: userToDelete.email,
      username: userToDelete.username,
      deletedBy: authContext.userId,
      deletedAt: new Date().toISOString(),
    });

    // Step 1: Delete from Cognito
    const isSelfDelete = authContext.userId === targetUserId;
    const accessToken = extractTokenFromHeader(
      event.headers?.Authorization || event.headers?.authorization
    );

    if (!isLocalAuthMode) {
      const cognito = getCognitoClient();
      try {
        if (isSelfDelete) {
          if (!accessToken) {
            return respondError(401, 'AUTH_REQUIRED', 'Authentication token is required');
          }
          await cognito.send(
            new DeleteUserCommand({
              AccessToken: accessToken,
            })
          );
        } else {
          const authEnv = getAuthEnvironment();
          if (!authEnv.userPoolId || !userToDelete.cognitoSub) {
            throw new Error('Missing Cognito identifiers for administrative deletion');
          }

          await cognito.send(
            new AdminDeleteUserCommand({
              UserPoolId: authEnv.userPoolId,
              Username: userToDelete.cognitoSub,
            })
          );
        }
        console.log('User deleted from Cognito:', targetUserId);
      } catch (cognitoError: any) {
        console.error('Cognito deletion error:', cognitoError);
        // Continue with database deletion even if Cognito fails
        // This ensures we don't leave orphaned data
        console.warn('Proceeding with database deletion despite Cognito error');
      }
    }

    // Step 2: Delete from database (cascades to all related tables)
    let deleted: boolean;
    try {
      deleted = await userRepository.deleteUserData(targetUserId);
    } catch (dbError: any) {
      console.error('Database deletion error:', dbError);
      return respondError(500, 'INTERNAL_ERROR', 'Failed to delete user data from database');
    }

    if (!deleted) {
      return respondError(500, 'INTERNAL_ERROR', 'Failed to delete user data from database');
    }

    console.log('Account deleted successfully for user:', targetUserId);

    const auditLog = new AuditLogService(dbPool);
    await auditLog.log({
      userId: isSelfDelete ? null : authContext.userId,
      action: 'user.account.delete',
      resourceType: 'user',
      resourceId: targetUserId,
      oldValues: {
        email: userToDelete.email,
        username: userToDelete.username,
      },
      newValues: {
        deletedBy: authContext.userId,
        deletionMode: isSelfDelete ? 'self_service' : 'administrative',
      },
    });

    const response: DeleteAccountResponse = {
      message: 'Account deleted successfully',
    };

    return respondSuccess(200, response);
  } catch (error: any) {
    console.error('Unexpected account deletion error:', error);
    return attachRateLimitHeaders(
      createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred while deleting account', undefined, {
        origin: originHeader,
        methods: 'DELETE,OPTIONS',
        allowCredentials: true,
      }),
      rateLimit
    );
  }
}
