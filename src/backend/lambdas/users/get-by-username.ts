import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UserRepository } from '../../repositories/UserRepository';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../auth/utils';
import { getDatabasePool } from '../../services/database';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

/**
 * Get user by username (public profile lookup)
 * GET /users/username/{username}
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Get user by username request:', JSON.stringify(event, null, 2));

  try {
    const originHeader = event.headers?.Origin || event.headers?.origin || undefined;
    const corsOptions = { origin: originHeader, methods: 'GET,OPTIONS', allowCredentials: true };
    const rateLimit = await applyRateLimit(event, { resource: 'users:profile', skipIfAuthorized: true });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(
        createErrorResponse(429, 'RATE_LIMITED', 'Too many requests', undefined, corsOptions)
      );
    }

    const username = event.pathParameters?.username;
    if (!username) {
      return withRateLimit(
        createErrorResponse(400, 'VALIDATION_ERROR', 'Username is required in path', undefined, corsOptions)
      );
    }

    const dbPool = await getDatabasePool();
    const userRepository = new UserRepository(dbPool);
    const user = await userRepository.findByUsername(username);

    if (!user) {
      return withRateLimit(
        createErrorResponse(404, 'NOT_FOUND', 'User not found', undefined, corsOptions)
      );
    }

    const authorizer = event.requestContext?.authorizer as Record<string, any> | undefined;
    const requesterId = authorizer?.userId;
    const requesterIsAdmin = authorizer?.isAdmin === 'true' || authorizer?.isAdmin === true;
    const exposeEmail = Boolean(requesterId) && (requesterId === user.id || requesterIsAdmin);
    const sanitizedUser = exposeEmail ? user : { ...user, email: '' };

    return withRateLimit(createSuccessResponse(200, { user: sanitizedUser }, corsOptions));
  } catch (error: any) {
    console.error('Unexpected get user by username error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred', undefined, {
      origin: event.headers?.Origin || event.headers?.origin || undefined,
      methods: 'GET,OPTIONS',
      allowCredentials: true,
    });
  }
}
