import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UserRepository } from '../../repositories/UserRepository';
import { UpdatePreferencesRequest, UpdatePreferencesResponse } from '../../../shared/types';
import {
  parseRequestBody,
  createErrorResponse,
  createSuccessResponse,
} from '../auth/utils';
import { getDatabasePool } from '../../services/database';
import { resolveAuthorizerContext } from '../../services/authorizerContext';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

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
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    rateLimit = await applyRateLimit(event, { resource: 'users:update-preferences' });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests'));
    }

    const authContext = resolveAuthorizerContext(event.requestContext?.authorizer as any);
    if (!authContext.userId) {
      return withRateLimit(createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required'));
    }

    // Extract user ID from path parameters
    const rawUserId = event.pathParameters?.id;
    if (!rawUserId) {
      return withRateLimit(createErrorResponse(400, 'VALIDATION_ERROR', 'User ID is required'));
    }
    const targetUserId = rawUserId === 'me' ? authContext.userId : rawUserId;

    // Check if authenticated user is updating their own preferences
    if (authContext.userId !== targetUserId) {
      return withRateLimit(
        createErrorResponse(403, 'PERMISSION_DENIED', 'You can only update your own preferences')
      );
    }

    // Parse request body
    const { data: requestBody, error: parseError } = parseRequestBody<UpdatePreferencesRequest>(event.body);
    if (parseError) {
      return withRateLimit(parseError);
    }

    // Validate input
    const validation = validatePreferencesInput(requestBody!);
    if (!validation.isValid) {
      return withRateLimit(
        createErrorResponse(400, 'VALIDATION_ERROR', 'Validation failed', { fields: validation.errors })
      );
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

    const dbPool = await getDatabasePool();
    const userRepository = new UserRepository(dbPool);
    await (userRepository as any).executeQuery(query, [
      targetUserId,
      requestBody!.receiveNewsletter,
      requestBody!.receiveContentNotifications,
      requestBody!.receiveCommunityUpdates,
    ]);

    console.log('Preferences updated successfully for user:', targetUserId);

    const response: UpdatePreferencesResponse = {
      message: 'Preferences updated successfully',
    };

    return withRateLimit(createSuccessResponse(200, response));
  } catch (error: any) {
    console.error('Unexpected preferences update error:', error);
    return attachRateLimitHeaders(
      createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred while updating preferences'),
      rateLimit
    );
  }
}
