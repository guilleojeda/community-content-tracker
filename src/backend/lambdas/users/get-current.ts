import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UserRepository } from '../../repositories/UserRepository';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../auth/utils';
import { getDatabasePool } from '../../services/database';
import { resolveAuthorizerContext } from '../../services/authorizerContext';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

/**
 * Get current user profile
 * GET /users/me
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Get current user request:', JSON.stringify(event, null, 2));
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    const originHeader = event.headers?.Origin || event.headers?.origin || undefined;
    const corsOptions = { origin: originHeader, methods: 'GET,OPTIONS', allowCredentials: true };
    rateLimit = await applyRateLimit(event, { resource: 'users:get-current' });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests', undefined, corsOptions));
    }

    const authContext = resolveAuthorizerContext(event.requestContext?.authorizer as any);
    if (!authContext.userId) {
      return withRateLimit(
        createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required', undefined, corsOptions)
      );
    }

    const dbPool = await getDatabasePool();
    const userRepository = new UserRepository(dbPool);
    const user = await userRepository.findById(authContext.userId);
    if (!user) {
      return withRateLimit(createErrorResponse(401, 'AUTH_INVALID', 'User not found', undefined, corsOptions));
    }

    return withRateLimit(createSuccessResponse(200, user, corsOptions));
  } catch (error: any) {
    console.error('Unexpected get current user error:', error);
    return attachRateLimitHeaders(
      createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred', undefined, {
        origin: event.headers?.Origin || event.headers?.origin || undefined,
        methods: 'GET,OPTIONS',
        allowCredentials: true,
      }),
      rateLimit
    );
  }
}
