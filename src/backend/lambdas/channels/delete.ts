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
    rateLimit = await applyRateLimit(event, { resource: 'channels:delete' });
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

    const channelId = event.pathParameters?.id;
    if (!channelId) {
      return respondError('VALIDATION_ERROR', 'Channel ID is required', 400);
    }

    // Check if channel exists and belongs to user
    const channel = await channelRepository.findById(channelId);
    if (!channel) {
      return respondError('NOT_FOUND', 'Channel not found', 404);
    }

    if (channel.userId !== userId) {
      return respondError('PERMISSION_DENIED', 'You do not have permission to delete this channel', 403);
    }

    // Delete channel
    await channelRepository.delete(channelId);

    return respondSuccess(200, { message: 'Channel deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting channel:', error);

    return attachRateLimitHeaders(
      errorResponse('INTERNAL_ERROR', 'An unexpected error occurred', 500),
      rateLimit
    );
  }
};
