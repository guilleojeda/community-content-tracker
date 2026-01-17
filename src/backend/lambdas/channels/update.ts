import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ChannelRepository } from '../../repositories/ChannelRepository';
import { UpdateChannelRequest } from '../../../shared/types';
import { errorResponse, successResponse } from '../../../shared/api-errors';
import { getDatabasePool } from '../../services/database';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

const VALID_SYNC_FREQUENCIES = ['daily', 'weekly', 'manual'];

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    rateLimit = await applyRateLimit(event, { resource: 'channels:update' });
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

    if (!event.body) {
      return respondError('VALIDATION_ERROR', 'Request body is required', 400);
    }

    const requestData: UpdateChannelRequest = JSON.parse(event.body);

    // Validate sync frequency if provided
    if (requestData.syncFrequency && !VALID_SYNC_FREQUENCIES.includes(requestData.syncFrequency)) {
      return respondError(
        'VALIDATION_ERROR',
        'Invalid sync frequency',
        400,
        {
          fields: {
            syncFrequency: 'Must be one of: daily, weekly, manual',
          },
        }
      );
    }

    // Check if channel exists and belongs to user
    const channel = await channelRepository.findById(channelId);
    if (!channel) {
      return respondError('NOT_FOUND', 'Channel not found', 404);
    }

    if (channel.userId !== userId) {
      return respondError('PERMISSION_DENIED', 'You do not have permission to update this channel', 403);
    }

    // Update channel
    const updatedChannel = await channelRepository.update(channelId, requestData);
    if (!updatedChannel) {
      return respondError('INTERNAL_ERROR', 'Failed to update channel', 500);
    }

    return respondSuccess(200, updatedChannel);
  } catch (error: any) {
    console.error('Error updating channel:', error);

    return attachRateLimitHeaders(
      errorResponse('INTERNAL_ERROR', 'An unexpected error occurred', 500),
      rateLimit
    );
  }
};
