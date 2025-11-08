import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ChannelRepository } from '../../repositories/ChannelRepository';
import { ChannelType, CreateChannelRequest } from '../../../shared/types';
import { errorResponse, successResponse } from '../../../shared/api-errors';
import { getDatabasePool } from '../../services/database';

function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

async function validateUrlAccessibility(url: string): Promise<{ accessible: boolean; error?: string }> {
  try {
    // Use HEAD request to check if URL is accessible without downloading full content
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'AWS-Community-Content-Hub-Validator/1.0',
      },
    });

    clearTimeout(timeoutId);

    // Consider 2xx and 3xx status codes as accessible
    if (response.status >= 200 && response.status < 400) {
      return { accessible: true };
    }

    return { accessible: false, error: `URL returned status ${response.status}` };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { accessible: false, error: 'URL check timed out' };
    }
    return { accessible: false, error: error.message || 'URL is not accessible' };
  }
}

function detectChannelType(url: string): ChannelType | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname.toLowerCase();
    const search = urlObj.search.toLowerCase();

    // YouTube detection
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return ChannelType.YOUTUBE;
    }

    // GitHub detection
    if (hostname.includes('github.com')) {
      return ChannelType.GITHUB;
    }

    // Basic RSS/blog detection (feed, rss, atom, xml hints)
    const blogIndicators = ['feed', 'rss', 'atom', '.xml'];
    if (blogIndicators.some(indicator => pathname.includes(indicator) || search.includes(indicator))) {
      return ChannelType.BLOG;
    }

    return null;
  } catch {
    return null;
  }
}

function validateChannelType(type: any): type is ChannelType {
  return Object.values(ChannelType).includes(type);
}

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

    if (!event.body) {
      return errorResponse('VALIDATION_ERROR', 'Request body is required', 400);
    }

    const requestData: CreateChannelRequest = JSON.parse(event.body);

    // Validate required URL
    if (!requestData.url) {
      return errorResponse(
        'VALIDATION_ERROR',
        'url is required',
        400,
        {
          fields: {
            url: 'Required',
          },
        }
      );
    }

    // Validate URL format
    if (!validateUrl(requestData.url)) {
      return errorResponse(
        'VALIDATION_ERROR',
        'Invalid URL format',
        400,
        {
          fields: {
            url: 'Must be a valid URL',
          },
        }
      );
    }

    // Validate URL accessibility
    const accessibilityCheck = await validateUrlAccessibility(requestData.url);
    if (!accessibilityCheck.accessible) {
      return errorResponse(
        'VALIDATION_ERROR',
        'URL is not accessible',
        400,
        {
          fields: {
            url: accessibilityCheck.error || 'URL cannot be reached',
          },
        }
      );
    }

    // Auto-detect channel type if not provided
    let channelType = requestData.channelType;
    if (!channelType) {
      const detectedType = detectChannelType(requestData.url);
      if (!detectedType) {
        return errorResponse(
          'VALIDATION_ERROR',
          'Could not detect channel type from URL. Please provide channelType explicitly.',
          400,
          {
            fields: {
              channelType: 'Required when type cannot be auto-detected',
            },
          }
        );
      }
      channelType = detectedType;
    }

    // Validate channel type
    if (!validateChannelType(channelType)) {
      return errorResponse(
        'VALIDATION_ERROR',
        'Invalid channel type',
        400,
        {
          fields: {
            channelType: 'Must be one of: blog, youtube, github',
          },
        }
      );
    }

    // Check for duplicate URL
    const existing = await channelRepository.findByUserIdAndUrl(userId, requestData.url);
    if (existing) {
      return errorResponse('DUPLICATE_RESOURCE', 'Channel with this URL already exists', 409);
    }

    // Create channel
    const channel = await channelRepository.create({
      userId,
      channelType,
      url: requestData.url,
      name: requestData.name,
      syncFrequency: requestData.syncFrequency || 'daily',
      metadata: requestData.metadata || {},
    });

    return successResponse(201, channel);
  } catch (error: any) {
    console.error('Error creating channel:', error);

    return errorResponse('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
};
