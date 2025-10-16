import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CognitoIdentityProviderClient, DeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { UserRepository } from '../../repositories/UserRepository';
import { DeleteAccountResponse } from '../../../shared/types';
import {
  createErrorResponse,
  createSuccessResponse,
  extractTokenFromHeader,
} from '../auth/utils';
import { verifyJwtToken, TokenVerifierConfig } from '../auth/tokenVerifier';
import { getDatabasePool } from '../../services/database';
import { getAuthEnvironment } from '../auth/config';

// Cognito client instance
let cognitoClient: CognitoIdentityProviderClient | null = null;

/**
 * Get Cognito client instance
 */
function getCognitoClient(): CognitoIdentityProviderClient {
  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityProviderClient({
      region: process.env.COGNITO_REGION || 'us-east-1',
    });
  }
  return cognitoClient;
}

/**
 * Get token verifier configuration
 */
function getTokenVerifierConfig(): TokenVerifierConfig {
  const authEnv = getAuthEnvironment();
  const allowedAudiences = authEnv.allowedAudiences.length > 0 ? authEnv.allowedAudiences : [authEnv.clientId];

  return {
    cognitoUserPoolId: authEnv.userPoolId,
    cognitoRegion: authEnv.region,
    allowedAudiences,
    issuer: `https://cognito-idp.${authEnv.region}.amazonaws.com/${authEnv.userPoolId}`,
  };
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

  try {
    // Extract user ID from path parameters
    const userId = event.pathParameters?.id;
    if (!userId) {
      return createErrorResponse(400, 'VALIDATION_ERROR', 'User ID is required');
    }

    // Extract and verify access token
    const accessToken = extractTokenFromHeader(event.headers.Authorization);
    if (!accessToken) {
      return createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication token is required');
    }

    // Verify token and get user
    const dbPool = await getDatabasePool();
    const userRepository = new UserRepository(dbPool);
    const tokenConfig = getTokenVerifierConfig();

    const verificationResult = await verifyJwtToken(accessToken, tokenConfig, userRepository);

    if (!verificationResult.isValid || !verificationResult.user) {
      console.error('Token verification failed:', verificationResult.error);
      return createErrorResponse(401, 'AUTH_INVALID', 'Invalid authentication token');
    }

    const authenticatedUser = verificationResult.user;

    // Check if authenticated user is deleting their own account (or is admin)
    if (authenticatedUser.id !== userId && !authenticatedUser.isAdmin) {
      return createErrorResponse(403, 'PERMISSION_DENIED', 'You can only delete your own account');
    }

    // Get user to verify existence
    const userToDelete = await userRepository.findById(userId);
    if (!userToDelete) {
      return createErrorResponse(404, 'NOT_FOUND', 'User not found');
    }

    // Log deletion for audit trail
    console.log('Deleting account for user:', {
      userId: userToDelete.id,
      email: userToDelete.email,
      username: userToDelete.username,
      deletedBy: authenticatedUser.id,
      deletedAt: new Date().toISOString(),
    });

    // Step 1: Delete from Cognito
    const cognito = getCognitoClient();

    try {
      await cognito.send(
        new DeleteUserCommand({
          AccessToken: accessToken,
        })
      );
      console.log('User deleted from Cognito:', userId);
    } catch (cognitoError: any) {
      console.error('Cognito deletion error:', cognitoError);
      // Continue with database deletion even if Cognito fails
      // This ensures we don't leave orphaned data
      console.warn('Proceeding with database deletion despite Cognito error');
    }

    // Step 2: Delete from database (cascades to all related tables)
    let deleted: boolean;
    try {
      deleted = await userRepository.deleteUserData(userId);
    } catch (dbError: any) {
      console.error('Database deletion error:', dbError);
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to delete user data from database');
    }

    if (!deleted) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Failed to delete user data from database');
    }

    console.log('Account deleted successfully for user:', userId);

    const response: DeleteAccountResponse = {
      message: 'Account deleted successfully',
    };

    return createSuccessResponse(200, response);
  } catch (error: any) {
    console.error('Unexpected account deletion error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred while deleting account');
  }
}
