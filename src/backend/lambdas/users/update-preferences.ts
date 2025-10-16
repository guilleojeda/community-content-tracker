import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UserRepository } from '../../repositories/UserRepository';
import { UpdatePreferencesRequest, UpdatePreferencesResponse } from '../../../shared/types';
import {
  parseRequestBody,
  createErrorResponse,
  createSuccessResponse,
  extractTokenFromHeader,
} from '../auth/utils';
import { verifyJwtToken, TokenVerifierConfig } from '../auth/tokenVerifier';
import { getDatabasePool } from '../../services/database';
import { getAuthEnvironment } from '../auth/config';

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
 * Validate preferences update input
 */
function validatePreferencesInput(input: UpdatePreferencesRequest): { isValid: boolean; errors?: Record<string, string> } {
  const errors: Record<string, string> = {};

  // All fields are optional booleans, just check types
  if (input.receiveNewsletter !== undefined && typeof input.receiveNewsletter !== 'boolean') {
    errors.receiveNewsletter = 'Must be a boolean value';
  }

  if (input.receiveContentNotifications !== undefined && typeof input.receiveContentNotifications !== 'boolean') {
    errors.receiveContentNotifications = 'Must be a boolean value';
  }

  if (input.receiveCommunityUpdates !== undefined && typeof input.receiveCommunityUpdates !== 'boolean') {
    errors.receiveCommunityUpdates = 'Must be a boolean value';
  }

  // At least one preference must be provided
  const hasAnyPreference =
    input.receiveNewsletter !== undefined ||
    input.receiveContentNotifications !== undefined ||
    input.receiveCommunityUpdates !== undefined;

  if (!hasAnyPreference) {
    errors.preferences = 'At least one preference must be provided';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  };
}

/**
 * Update user email preferences Lambda handler
 * PATCH /users/:id/preferences
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Update preferences request:', JSON.stringify(event, null, 2));

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

    // Check if authenticated user is updating their own preferences
    if (authenticatedUser.id !== userId) {
      return createErrorResponse(403, 'PERMISSION_DENIED', 'You can only update your own preferences');
    }

    // Parse request body
    const { data: requestBody, error: parseError } = parseRequestBody<UpdatePreferencesRequest>(event.body);
    if (parseError) {
      return parseError;
    }

    // Validate input
    const validation = validatePreferencesInput(requestBody!);
    if (!validation.isValid) {
      return createErrorResponse(400, 'VALIDATION_ERROR', 'Validation failed', { fields: validation.errors });
    }

    // Update preferences in database
    // Note: UserRepository.updatePreferences() method is available but using direct query for backward compatibility
    const query = `
      UPDATE users
      SET
        receive_newsletter = COALESCE($2, receive_newsletter),
        receive_content_notifications = COALESCE($3, receive_content_notifications),
        receive_community_updates = COALESCE($4, receive_community_updates),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    await (userRepository as any).executeQuery(query, [
      userId,
      requestBody!.receiveNewsletter,
      requestBody!.receiveContentNotifications,
      requestBody!.receiveCommunityUpdates,
    ]);

    console.log('Preferences updated successfully for user:', userId);

    const response: UpdatePreferencesResponse = {
      message: 'Preferences updated successfully',
    };

    return createSuccessResponse(200, response);
  } catch (error: any) {
    console.error('Unexpected preferences update error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred while updating preferences');
  }
}
