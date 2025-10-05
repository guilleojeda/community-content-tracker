import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { Pool } from 'pg';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { ChannelRepository } from '../../repositories/ChannelRepository';
import { ChannelType } from '../../../shared/types';
import { errorResponse, successResponse } from '../../../shared/api-errors';
import { getDatabasePool } from '../../services/database';
import { ExternalApiError, formatErrorForLogging } from '../../../shared/errors';

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });

const SCRAPER_FUNCTIONS: Record<ChannelType, string | undefined> = {
  [ChannelType.BLOG]: process.env.BLOG_SCRAPER_FUNCTION_NAME,
  [ChannelType.YOUTUBE]: process.env.YOUTUBE_SCRAPER_FUNCTION_NAME,
  [ChannelType.GITHUB]: process.env.GITHUB_SCRAPER_FUNCTION_NAME,
};

// Lambda global scope - database pool persists across invocations
let pool: Pool | null = null;

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  try {
    // Initialize database connection in global scope for reuse
    if (!pool) {
      pool = await getDatabasePool();
    }
    const channelRepository = new ChannelRepository(pool);

    // Extract channel ID from path parameters
    const channelId = event.pathParameters?.id;
    if (!channelId) {
      return errorResponse('VALIDATION_ERROR', 'Channel ID is required', 400);
    }

    // Extract user ID from authorizer (supports both JWT and Lambda authorizer)
    const userId = event.requestContext.authorizer?.claims?.sub ||
                   event.requestContext?.authorizer?.userId;
    if (!userId) {
      return errorResponse('AUTH_REQUIRED', 'Authentication required', 401);
    }

    // Get channel from database
    const channel = await channelRepository.findById(channelId);
    if (!channel) {
      return errorResponse('NOT_FOUND', 'Channel not found', 404);
    }

    // Verify ownership
    if (channel.userId !== userId) {
      return errorResponse('PERMISSION_DENIED', 'You do not have permission to sync this channel', 403);
    }

    // Check if channel is enabled
    if (!channel.enabled) {
      return errorResponse('VALIDATION_ERROR', 'Cannot sync a disabled channel', 400);
    }

    // Get the appropriate scraper function for this channel type
    const scraperFunction = SCRAPER_FUNCTIONS[channel.channelType];
    if (!scraperFunction) {
      return errorResponse(
        'INTERNAL_ERROR',
        `Scraper for channel type ${channel.channelType} is not configured`,
        500
      );
    }

    // Invoke the scraper Lambda asynchronously
    const invokeCommand = new InvokeCommand({
      FunctionName: scraperFunction,
      InvocationType: 'Event', // Async invocation
      Payload: JSON.stringify({
        channelId: channel.id,
        manual: true, // Flag to indicate manual trigger
      }),
    });

    const response = await lambdaClient.send(invokeCommand);

    if (response.StatusCode !== 202) {
      const lambdaError = new ExternalApiError(
        'Lambda',
        `Unexpected Lambda response status: ${response.StatusCode}`,
        response.StatusCode || 500,
        { scraperFunction, channelId: channel.id, statusCode: response.StatusCode }
      );
      console.error(formatErrorForLogging(lambdaError, { channelId: channel.id, scraperFunction }));
      throw lambdaError;
    }

    // Return standardized success response
    return successResponse(200, {
      message: 'Channel sync triggered successfully',
      channelId: channel.id,
      channelType: channel.channelType,
      syncStatus: 'in_progress',
    });
  } catch (error: any) {
    console.error(formatErrorForLogging(error, { context: 'channel-sync-handler' }));
    return errorResponse(
      'INTERNAL_ERROR',
      'Failed to trigger channel sync',
      500
    );
  }
};
