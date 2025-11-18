import { ScheduledEvent, Context } from 'aws-lambda';
import { SQSClient } from '@aws-sdk/client-sqs';
import Parser from 'rss-parser';
import { getDatabasePool } from '../../services/database';
import { ChannelRepository } from '../../repositories/ChannelRepository';
import { ChannelType, ContentType, ContentProcessorMessage } from '../../../shared/types';
import { ParsingError, ExternalApiError, formatErrorForLogging } from '../../../shared/errors';
import { createSendMessageCommand } from '../../utils/sqs';

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const parser = new Parser();

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

interface RSSItem {
  title?: string;
  link?: string;
  contentSnippet?: string;
  pubDate?: string;
  isoDate?: string;
}

async function parseRSSFeed(url: string): Promise<RSSItem[]> {
  try {
    const feed = await parser.parseURL(url);
    return feed.items || [];
  } catch (error: any) {
    const parsingError = new ParsingError(
      'RSS',
      `Failed to parse RSS feed: ${url} - ${error?.message || 'Invalid XML'}`,
      {
        url,
        originalError: error?.message,
      }
    );
    console.error(formatErrorForLogging(parsingError, { url }));
    throw parsingError;
  }
}

function filterNewPosts(posts: RSSItem[], lastSyncAt?: Date): RSSItem[] {
  if (!lastSyncAt) {
    return posts;
  }

  return posts.filter(post => {
    const postDate = post.isoDate || post.pubDate;
    if (!postDate) {
      return true; // Include posts without dates
    }

    const publishDate = new Date(postDate);
    return publishDate > lastSyncAt;
  });
}

async function sendToQueue(channelId: string, userId: string, post: RSSItem): Promise<void> {
  // Explicitly type the message as ContentProcessorMessage
  const message: ContentProcessorMessage = {
    userId,
    channelId,
    title: post.title || 'Untitled',
    description: post.contentSnippet,
    contentType: ContentType.BLOG,
    url: post.link || '',
    publishDate: post.isoDate || post.pubDate,
    metadata: {
      source: 'rss',
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
          StringValue: ContentType.BLOG,
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
    const sqsError = new ExternalApiError('SQS', 'Failed to send message to queue', 500, {
      channelId,
      userId,
      queueUrl: resolveQueueUrl(),
      originalError: error?.message,
    });
    console.error(formatErrorForLogging(sqsError, { channelId, userId }));
    throw sqsError;
  }
}

export const handler = async (
  _event: ScheduledEvent,
  context: Context
): Promise<void> => {
  console.log('Starting Blog RSS scraper');

  try {
    // Initialize database connection
    const pool = await getDatabasePool();
    const channelRepository = new ChannelRepository(pool);

    // Get all enabled blog channels
    const channels = await channelRepository.findActiveByType(ChannelType.BLOG);

    console.log(`Found ${channels.length} active blog channels`);

    let totalProcessed = 0;
    let totalErrors = 0;

    for (const channel of channels) {
      try {
        console.log(`Processing channel: ${channel.id} (${channel.url})`);

        // Parse RSS feed
        const posts = await parseRSSFeed(channel.url);

        // Filter new posts since last sync
        const newPosts = filterNewPosts(posts, channel.lastSyncAt);

        console.log(`Found ${newPosts.length} new posts for channel ${channel.id}`);

        // Send each new post to the processing queue
        for (const post of newPosts) {
          if (!post.link) {
            console.warn(`Skipping post without link in channel ${channel.id}`);
            continue;
          }

          try {
            await sendToQueue(channel.id, channel.userId, post);
            totalProcessed++;
          } catch (error) {
            console.error(`Error sending post to queue:`, error);
            totalErrors++;
          }
        }

        // Update sync status
        await channelRepository.updateSyncStatus(channel.id, 'success');
      } catch (error: any) {
        console.error(`Error processing channel ${channel.id}:`, error);
        await channelRepository.updateSyncStatus(
          channel.id,
          'error',
          error.message || 'Unknown error'
        );
        totalErrors++;
      }
    }

    console.log(
      `Blog RSS scraper completed. Processed: ${totalProcessed}, Errors: ${totalErrors}`
    );
  } catch (error: any) {
    console.error('Fatal error in Blog RSS scraper:', error);
    throw error;
  }
};
