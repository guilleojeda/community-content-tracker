import { ScheduledEvent, Context } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { ChannelRepository } from '../../repositories/ChannelRepository';
import { ChannelType, ContentType, ContentProcessorMessage } from '../../../shared/types';
import { getDatabasePool } from '../../services/database';
import { ExternalApiError, ThrottlingError, ValidationError, formatErrorForLogging } from '../../../shared/errors';

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Validate required environment variables at module load
function validateEnvironment(): void {
  const required = ['CONTENT_PROCESSING_QUEUE_URL'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

validateEnvironment();

const QUEUE_URL = process.env.CONTENT_PROCESSING_QUEUE_URL as string;
const YOUTUBE_API_SECRET_ARN = process.env.YOUTUBE_API_SECRET_ARN;

// Cache for API key to avoid repeated Secrets Manager calls
let cachedApiKey: string | null = null;

async function getYouTubeApiKey(): Promise<string> {
  // Return cached key if available
  if (cachedApiKey) {
    return cachedApiKey;
  }

  // Try to get from Secrets Manager first
  if (YOUTUBE_API_SECRET_ARN) {
    try {
      const response = await secretsClient.send(new GetSecretValueCommand({
        SecretId: YOUTUBE_API_SECRET_ARN,
      }));

      if (response.SecretString) {
        cachedApiKey = response.SecretString;
        return cachedApiKey;
      }
    } catch (error: any) {
      const secretsError = new ExternalApiError(
        'SecretsManager',
        'Failed to fetch YouTube API key from Secrets Manager',
        500,
        {
          secretArn: YOUTUBE_API_SECRET_ARN,
          originalError: error.message,
        }
      );
      console.error(formatErrorForLogging(secretsError, { secretArn: YOUTUBE_API_SECRET_ARN }));
      // Fall through to environment variable
    }
  }

  // Fallback to environment variable ONLY in local development (not production)
  if (process.env.NODE_ENV !== 'production') {
    const envKey = process.env.YOUTUBE_API_KEY;
    if (envKey) {
      cachedApiKey = envKey;
      return cachedApiKey;
    }
  }

  const configError = new ValidationError(
    'YouTube API key not configured in Secrets Manager or environment',
    { secretArn: YOUTUBE_API_SECRET_ARN }
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

  // Handle rate limiting (429 Too Many Requests)
  if (response.status === 429) {
    if (retryCount >= maxRetries) {
      const retryAfter = response.headers.get('Retry-After');
      const resetAt = retryAfter ? new Date(Date.now() + parseInt(retryAfter) * 1000) : undefined;
      const rateLimitError = new ThrottlingError('YouTube', resetAt);
      console.error(formatErrorForLogging(rateLimitError, { url, retryCount, maxRetries }));
      throw rateLimitError;
    }

    const retryAfter = response.headers.get('Retry-After');
    const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, retryCount + 1) * 1000;

    console.log(`Rate limited. Waiting ${waitTime}ms before retry ${retryCount + 1}/${maxRetries}...`);
    await throttle(waitTime);

    return fetchYouTubeAPI(url, retryCount + 1, maxRetries);
  }

  // Handle other errors with exponential backoff
  if (!response.ok && retryCount < maxRetries) {
    const waitTime = Math.pow(2, retryCount + 1) * 1000;
    console.log(`API error ${response.status}. Waiting ${waitTime}ms before retry ${retryCount + 1}/${maxRetries}...`);
    await throttle(waitTime);
    return fetchYouTubeAPI(url, retryCount + 1, maxRetries);
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
    /youtube\.com\/channel\/([^\/\?]+)/,
    /youtube\.com\/c\/([^\/\?]+)/,
    /youtube\.com\/user\/([^\/\?]+)/,
    /youtube\.com\/@([^\/\?]+)/,
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
    let uploadsPlaylistId: string;

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

    uploadsPlaylistId = channelDetails.items[0].contentDetails.relatedPlaylists.uploads;

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
      `Error fetching YouTube videos: ${error.message}`,
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
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: QUEUE_URL,
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
    }));
  } catch (error: any) {
    const sqsError = new ExternalApiError('SQS', `Failed to send message to queue`, 500, {
      channelId,
      userId,
      videoId: video.id,
      queueUrl: QUEUE_URL,
      originalError: error.message,
    });
    console.error(formatErrorForLogging(sqsError, { channelId, userId, videoId: video.id }));
    throw sqsError;
  }
}

export const handler = async (
  event: ScheduledEvent,
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
        await channelRepository.updateSyncStatus(
          channel.id,
          'error',
          error.message || 'Unknown error'
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
