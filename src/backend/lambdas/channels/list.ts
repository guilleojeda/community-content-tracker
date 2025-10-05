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

    // Fetch channels for user
    const channels = await channelRepository.findByUserId(userId);

    return successResponse(200, {
      channels,
      total: channels.length,
    });
  } catch (error: any) {
    console.error('Error listing channels:', error);

    return errorResponse('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
};
