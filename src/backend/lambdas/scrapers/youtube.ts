import { ScheduledEvent, Context } from 'aws-lambda';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { ChannelRepository } from '../../repositories/ChannelRepository';
import { ChannelType, ContentType, ContentProcessorMessage } from '../../../shared/types';
import { getDatabasePool } from '../../services/database';
import { ExternalApiError, ValidationError, formatErrorForLogging } from '../../../shared/errors';
import { createSendMessageCommand } from '../../utils/sqs';

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

let cachedQueueUrl: string | null = null;
function resolveQueueUrl(): string {
  if (cachedQueueUrl) {
    return cachedQueueUrl;
  }

  const value = process.env.CONTENT_PROCESSING_QUEUE_URL;
  if (!value || value.trim() === '') {
    throw new Error('Missing required environment variables: CONTENT_PROCESSING_QUEUE_URL');
  }

  cachedQueueUrl = value;
  return cachedQueueUrl;
}
// Cache for API key to avoid repeated Secrets Manager calls
let cachedApiKey: string | null = null;
let cachedApiSourceKey: string | null = null;

async function getYouTubeApiKey(): Promise<string> {
  const secretArn = process.env.YOUTUBE_API_SECRET_ARN;
  const envKey = process.env.YOUTUBE_API_KEY;
  const currentSourceKey = `${secretArn ?? ''}|${envKey ?? ''}`;

  if (cachedApiSourceKey !== currentSourceKey) {
    cachedApiKey = null;
    cachedApiSourceKey = currentSourceKey;
  }

  // Return cached key if available
  if (cachedApiKey) {
    return cachedApiKey;
  }

  // Try to get from Secrets Manager first
  if (secretArn) {
    try {
      const response = await secretsClient.send(new GetSecretValueCommand({
        SecretId: secretArn,
      }));

      if (response.SecretString) {
        cachedApiKey = response.SecretString;
        cachedApiSourceKey = currentSourceKey;
        return cachedApiKey;
      }
    } catch (error: any) {
      const secretsError = new ExternalApiError(
        'SecretsManager',
        'Failed to fetch YouTube API key from Secrets Manager',
        500,
        {
          secretArn,
          originalError: error.message,
        }
      );
      console.error(formatErrorForLogging(secretsError, { secretArn }));
      // Fall through to environment variable
    }
  }

  // Fallback to environment variable ONLY in local development (not production)
  if (process.env.NODE_ENV !== 'production') {
    if (envKey) {
      cachedApiKey = envKey;
      cachedApiSourceKey = currentSourceKey;
      return cachedApiKey;
    }
  }

  const configError = new ValidationError(
    'YouTube API key not configured in Secrets Manager or environment',
    { secretArn }
  );
  console.error(formatErrorForLogging(configError));
  throw configError;
}

// Rate limiting helper
async function throttle(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch with retry logic and rate limit handling
async function fetchYouTubeAPI(url: string, retryCount = 0, maxRetries = 3): Promise<Response> {
  const response = await fetch(url);
  if (!response) {
    const noResponseError = new ExternalApiError('YouTube', 'No response from YouTube API', 502, { url });
    console.error(formatErrorForLogging(noResponseError, { url }));
    throw noResponseError;
  }
  const status: number | undefined = typeof (response as any)?.status === 'number'
    ? (response as any).status
    : undefined;
  const statusText: string = (response as any)?.statusText ?? 'Unknown error';
  const headers = (response as any)?.headers;
  const getHeader = typeof headers?.get === 'function'
    ? (name: string) => headers.get(name)
    : () => null;

  // Handle rate limiting (429 Too Many Requests)
  if (status === 429) {
    const retryAfter = getHeader('Retry-After');
    if (retryAfter) {
      const waitTime = parseInt(retryAfter) * 1000;
      console.log(`Rate limited. Waiting ${waitTime}ms before retry...`);
      await throttle(waitTime);
    }

    const rateLimitError = new ExternalApiError(
      'YouTube',
      'YouTube API error: rate limit exceeded',
      429,
      { url, retryAfter }
    );
    console.error(formatErrorForLogging(rateLimitError, { url, retryAfter }));
    throw rateLimitError;
  }

  if (!response.ok) {
    if (status && status >= 500 && retryCount < maxRetries) {
      const waitTime = Math.pow(2, retryCount + 1) * 1000;
      console.log(`API error ${status}. Waiting ${waitTime}ms before retry ${retryCount + 1}/${maxRetries}...`);
      await throttle(waitTime);
      return fetchYouTubeAPI(url, retryCount + 1, maxRetries);
    }

    const apiError = new ExternalApiError(
      'YouTube',
      `YouTube API error: ${statusText}`,
      status ?? 500,
      { url, status, statusText }
    );
    console.error(formatErrorForLogging(apiError, { url, status, statusText }));
    throw apiError;
  }

  // Attach fallbacks for missing properties to simplify downstream handling
  if (typeof (response as any).status !== 'number') {
    (response as any).status = status ?? 500;
  }
  if ((response as any).statusText == null) {
    (response as any).statusText = statusText;
  }
  if (!(response as any).headers && headers) {
    (response as any).headers = headers;
  }

  return response;
}

interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnailUrl: string;
}

interface ChannelInfo {
  type: 'channel' | 'playlist';
  id: string | null;
}

function extractChannelIdOrPlaylistId(url: string): ChannelInfo {
  // Check for playlist first
  const playlistMatch = url.match(/[?&]list=([^&]+)/);
  if (playlistMatch) {
    return { type: 'playlist', id: playlistMatch[1] };
  }

  // Support various YouTube channel URL formats
  const channelPatterns = [
    /youtube\.com\/channel\/([^/?]+)/,
    /youtube\.com\/c\/([^/?]+)/,
    /youtube\.com\/user\/([^/?]+)/,
    /youtube\.com\/@([^/?]+)/,
  ];

  for (const pattern of channelPatterns) {
    const match = url.match(pattern);
    if (match) {
      return { type: 'channel', id: match[1] };
    }
  }

  return { type: 'channel', id: null };
}

async function fetchChannelVideos(channelIdentifier: string, lastSyncAt?: Date): Promise<YouTubeVideo[]> {
  const apiKey = await getYouTubeApiKey();

  try {

    // Step 1: Get channel ID if we have a username/handle
    let channelId = channelIdentifier;

    // If it looks like a username/handle, resolve to channel ID
    if (!channelIdentifier.startsWith('UC')) {
      const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=id&forUsername=${channelIdentifier}&key=${apiKey}`;
      const channelResponse = await fetchYouTubeAPI(channelUrl);

      if (!channelResponse.ok) {
        const apiError = new ExternalApiError(
          'YouTube',
          `Failed to resolve channel ID: ${channelResponse.statusText}`,
          channelResponse.status,
          { channelIdentifier, statusText: channelResponse.statusText }
        );
        console.error(formatErrorForLogging(apiError, { channelIdentifier }));
        throw apiError;
      }

      const channelData = await channelResponse.json();
      if (channelData.items && channelData.items.length > 0) {
        channelId = channelData.items[0].id;
      }

      // Rate limit protection between API calls
      await throttle(300);
    }

    // Step 2: Get uploads playlist ID
    const channelDetailsUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${apiKey}`;
    const channelDetailsResponse = await fetchYouTubeAPI(channelDetailsUrl);

    if (!channelDetailsResponse.ok) {
      const apiError = new ExternalApiError(
        'YouTube',
        `Failed to fetch channel details: ${channelDetailsResponse.statusText}`,
        channelDetailsResponse.status,
        { channelId, statusText: channelDetailsResponse.statusText }
      );
      console.error(formatErrorForLogging(apiError, { channelId }));
      throw apiError;
    }

    const channelDetails = await channelDetailsResponse.json();
    if (!channelDetails.items || channelDetails.items.length === 0) {
      const notFoundError = new ValidationError(
        'Channel not found',
        { channelId, channelIdentifier }
      );
      console.error(formatErrorForLogging(notFoundError, { channelId, channelIdentifier }));
      throw notFoundError;
    }

    const uploadsPlaylistId = channelDetails.items[0].contentDetails.relatedPlaylists.uploads;

    // Rate limit protection between API calls
    await throttle(300);

    // Step 3: Get videos from uploads playlist with pagination
    return await fetchPlaylistVideos(uploadsPlaylistId, apiKey, lastSyncAt);
  } catch (error: any) {
    // Re-throw if already an ApiError
    if (error.code) {
      throw error;
    }

    const wrappedError = new ExternalApiError(
      'YouTube',
      `YouTube API error: ${error.message}`,
      500,
      { channelIdentifier, originalError: error.message }
    );
    console.error(formatErrorForLogging(wrappedError, { channelIdentifier }));
    throw wrappedError;
  }
}

async function fetchPlaylistVideos(playlistId: string, apiKey: string, lastSyncAt?: Date): Promise<YouTubeVideo[]> {
  const videos: YouTubeVideo[] = [];
  let pageToken: string | undefined;
  let shouldContinue = true;

  while (shouldContinue) {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('key', apiKey);
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const videosResponse = await fetchYouTubeAPI(url.toString());

    if (!videosResponse.ok) {
      const apiError = new ExternalApiError(
        'YouTube',
        `Failed to fetch playlist videos: ${videosResponse.statusText}`,
        videosResponse.status,
        { playlistId, statusText: videosResponse.statusText, pageToken }
      );
      console.error(formatErrorForLogging(apiError, { playlistId, pageToken }));
      throw apiError;
    }

    const videosData = await videosResponse.json();

    // Process items in this page
    let foundOldContent = false;
    for (const item of videosData.items || []) {
      const publishedAt = new Date(item.snippet.publishedAt);

      // Filter by lastSyncAt if provided
      if (lastSyncAt && publishedAt <= lastSyncAt) {
        foundOldContent = true;
        continue;
      }

      videos.push({
        id: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        publishedAt: item.snippet.publishedAt,
        thumbnailUrl: item.snippet.thumbnails?.default?.url || '',
      });
    }

    // Check if we should continue paginating
    pageToken = videosData.nextPageToken;
    shouldContinue = !!pageToken && !foundOldContent;

    // Rate limit protection between pagination requests (minimum 500ms as specified)
    if (shouldContinue) {
      await throttle(500);
    }
  }

  return videos;
}

async function sendToQueue(channelId: string, userId: string, video: YouTubeVideo): Promise<void> {
  // Explicitly type the message as ContentProcessorMessage
  const message: ContentProcessorMessage = {
    userId,
    channelId,
    title: video.title,
    description: video.description,
    contentType: ContentType.YOUTUBE,
    url: `https://www.youtube.com/watch?v=${video.id}`,
    publishDate: video.publishedAt,
    metadata: {
      videoId: video.id,
      thumbnailUrl: video.thumbnailUrl,
    },
  };

  try {
    const queueUrl = resolveQueueUrl();
    const commandInput = {
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        contentType: {
          DataType: 'String',
          StringValue: ContentType.YOUTUBE,
        },
        channelId: {
          DataType: 'String',
          StringValue: channelId,
        },
      },
    };
    const command = createSendMessageCommand(commandInput);
    await sqsClient.send(command);
  } catch (error: any) {
    const sqsError = new ExternalApiError('SQS', `Failed to send message to queue`, 500, {
      channelId,
      userId,
      videoId: video.id,
      queueUrl: resolveQueueUrl(),
      originalError: error.message,
    });
    console.error(formatErrorForLogging(sqsError, { channelId, userId, videoId: video.id }));
    throw sqsError;
  }
}

export const handler = async (
  _event: ScheduledEvent,
  context: Context
): Promise<void> => {
  console.log('Starting YouTube Channel scraper');

  const pool = await getDatabasePool();
  const channelRepository = new ChannelRepository(pool);

  try {
    // Get all enabled YouTube channels
    const channels = await channelRepository.findActiveByType(ChannelType.YOUTUBE);

    console.log(`Found ${channels.length} active YouTube channels`);

    let totalProcessed = 0;
    let totalErrors = 0;

    for (const channel of channels) {
      try {
        console.log(`Processing channel: ${channel.id} (${channel.url})`);

        const channelInfo = extractChannelIdOrPlaylistId(channel.url);
        if (!channelInfo.id) {
          const validationError = new ValidationError(
            'Invalid YouTube channel or playlist URL',
            { channelId: channel.id, url: channel.url }
          );
          console.error(formatErrorForLogging(validationError, { channelId: channel.id, url: channel.url }));
          throw validationError;
        }

        let videos: YouTubeVideo[];

        // Handle playlist URLs differently - fetch directly from playlist
        if (channelInfo.type === 'playlist') {
          console.log(`Detected playlist URL, fetching from playlist ID: ${channelInfo.id}`);
          const apiKey = await getYouTubeApiKey();
          videos = await fetchPlaylistVideos(channelInfo.id, apiKey, channel.lastSyncAt);
        } else {
          // Regular channel processing
          videos = await fetchChannelVideos(channelInfo.id, channel.lastSyncAt);
        }

        console.log(`Found ${videos.length} new videos for channel ${channel.id}`);

        // Send each video to the processing queue
        for (const video of videos) {
          try {
            await sendToQueue(channel.id, channel.userId, video);
            totalProcessed++;
          } catch (error: any) {
            console.error(formatErrorForLogging(error, { channelId: channel.id, videoId: video.id }));
            totalErrors++;
          }
        }

        // Update sync status
        await channelRepository.updateSyncStatus(channel.id, 'success');
      } catch (error: any) {
        console.error(formatErrorForLogging(error, { channelId: channel.id, channelUrl: channel.url }));
        const statusMessage = error?.code === 'THROTTLING_ERROR'
          ? 'YouTube API error: rate limit exceeded'
          : error.message || 'Unknown error';

        await channelRepository.updateSyncStatus(
          channel.id,
          'error',
          statusMessage
        );
        totalErrors++;
      }
    }

    console.log(
      `YouTube scraper completed. Processed: ${totalProcessed}, Errors: ${totalErrors}`
    );
  } catch (error: any) {
    console.error(formatErrorForLogging(error, { source: 'youtube-scraper-handler' }));
    throw error;
  }
};
