import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ChannelRepository } from '../../repositories/ChannelRepository';
import { UpdateChannelRequest } from '../../../shared/types';
import { errorResponse, successResponse } from '../../../shared/api-errors';
import { getDatabasePool } from '../../services/database';

const VALID_SYNC_FREQUENCIES = ['daily', 'weekly', 'manual'];

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  try {
    const pool = await getDatabasePool();
    const channelRepository = new ChannelRepository(pool);

    // Check authentication (supports both JWT and Lambda authorizer)
    const userId = event.requestContext.authorizer?.claims?.sub ||
                   event.requestContext?.authorizer?.userId;
    if (!userId) {
      return errorResponse('AUTH_REQUIRED', 'Authentication required', 401);
    }

    const channelId = event.pathParameters?.id;
    if (!channelId) {
      return errorResponse('VALIDATION_ERROR', 'Channel ID is required', 400);
    }

    if (!event.body) {
      return errorResponse('VALIDATION_ERROR', 'Request body is required', 400);
    }

    const requestData: UpdateChannelRequest = JSON.parse(event.body);

    // Validate sync frequency if provided
    if (requestData.syncFrequency && !VALID_SYNC_FREQUENCIES.includes(requestData.syncFrequency)) {
      return errorResponse(
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
      return errorResponse('NOT_FOUND', 'Channel not found', 404);
    }

    if (channel.userId !== userId) {
      return errorResponse('PERMISSION_DENIED', 'You do not have permission to update this channel', 403);
    }

    // Update channel
    const updatedChannel = await channelRepository.update(channelId, requestData);

    return successResponse(200, { channel: updatedChannel });
  } catch (error: any) {
    console.error('Error updating channel:', error);

    return errorResponse('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
};
