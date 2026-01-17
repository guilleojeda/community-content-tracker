import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { BadgeRepository } from '../../repositories/BadgeRepository';
import { UserRepository } from '../../repositories/UserRepository';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../auth/utils';
import { getDatabasePool } from '../../services/database';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

/**
 * Get user badges Lambda handler
 * GET /users/:id/badges
 * Public endpoint (no authentication required)
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Get user badges request:', JSON.stringify(event, null, 2));

  try {
    const rateLimit = await applyRateLimit(event, { resource: 'users:badges', skipIfAuthorized: true });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(
        createErrorResponse(429, 'RATE_LIMITED', 'Too many requests')
      );
    }

    // Get user ID from path parameter
    const rawUserId = event.pathParameters?.id;
    if (!rawUserId) {
      return withRateLimit(createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'User ID is required in path'
      ));
    }

    let userId = rawUserId;
    if (rawUserId === 'me') {
      const authorizer: any = event.requestContext?.authorizer || {};
      const claims: any = authorizer.claims || {};
      userId = authorizer.userId || claims.sub || claims['cognito:username'];
      if (!userId) {
        return withRateLimit(createErrorResponse(
          401,
          'AUTH_REQUIRED',
          'Authentication required'
        ));
      }
    }

    const dbPool = await getDatabasePool();
    const badgeRepository = new BadgeRepository(dbPool);
    const userRepository = new UserRepository(dbPool);

    // Verify user exists
    const user = await userRepository.findById(userId);
    if (!user) {
      return withRateLimit(createErrorResponse(
        404,
        'NOT_FOUND',
        'User not found'
      ));
    }

    // Get all badges for the user
    const badges = await badgeRepository.findByUserId(userId);

    return withRateLimit(createSuccessResponse(200, {
      userId: user.id,
      username: user.username,
      badges,
      badgeCount: badges.length,
    }));

  } catch (error: any) {
    console.error('Unexpected get badges error:', error);
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred'
    );
  }
}
