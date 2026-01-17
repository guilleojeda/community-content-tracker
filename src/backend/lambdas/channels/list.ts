import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ChannelRepository } from '../../repositories/ChannelRepository';
import { errorResponse, successResponse } from '../../../shared/api-errors';
import { getDatabasePool } from '../../services/database';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    rateLimit = await applyRateLimit(event, { resource: 'channels:list' });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);
    const respondError = (code: string, message: string, statusCode: number, details?: Record<string, any>) =>
      withRateLimit(errorResponse(code, message, statusCode, details));
    const respondSuccess = (statusCode: number, data: any) =>
      withRateLimit(successResponse(statusCode, data));

    if (rateLimit && !rateLimit.allowed) {
      return respondError('RATE_LIMITED', 'Too many requests', 429);
    }

    const pool = await getDatabasePool();
    const channelRepository = new ChannelRepository(pool);

    // Check authentication (supports both JWT and Lambda authorizer)
    const userId = event.requestContext.authorizer?.claims?.sub ||
                   event.requestContext?.authorizer?.userId;
    if (!userId) {
      return respondError('AUTH_REQUIRED', 'Authentication required', 401);
    }

    // Fetch channels for user
    const channels = await channelRepository.findByUserId(userId);

    return respondSuccess(200, {
      channels,
      total: channels.length,
    });
  } catch (error: any) {
    console.error('Error listing channels:', error);

    return attachRateLimitHeaders(
      errorResponse('INTERNAL_ERROR', 'An unexpected error occurred', 500),
      rateLimit
    );
  }
};
