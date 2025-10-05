import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ChannelRepository } from '../../repositories/ChannelRepository';
import { errorResponse, successResponse } from '../../../shared/api-errors';
import { getDatabasePool } from '../../services/database';

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

    // Check if channel exists and belongs to user
    const channel = await channelRepository.findById(channelId);
    if (!channel) {
      return errorResponse('NOT_FOUND', 'Channel not found', 404);
    }

    if (channel.userId !== userId) {
      return errorResponse('PERMISSION_DENIED', 'You do not have permission to delete this channel', 403);
    }

    // Delete channel
    await channelRepository.delete(channelId);

    return successResponse(200, { message: 'Channel deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting channel:', error);

    return errorResponse('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
};
