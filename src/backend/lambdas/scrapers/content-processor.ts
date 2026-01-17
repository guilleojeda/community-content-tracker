import { SQSEvent, Context } from 'aws-lambda';
import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { ContentRepository } from '../../repositories/ContentRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { ContentProcessorMessage, Visibility } from '../../../shared/types';
import { getDatabasePool } from '../../services/database';
import { getEmbeddingService } from '../../services/EmbeddingService';
import { ExternalApiError, shouldRetry, formatErrorForLogging } from '../../../shared/errors';

let cloudWatchClient: CloudWatchClient | null = null;

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} must be set`);
  }
  return value;
};

const resolveAwsRegion = (): string => {
  return process.env.AWS_REGION || process.env.BEDROCK_REGION || requireEnv('AWS_REGION');
};

const resolveEnvironment = (): string => {
  return process.env.ENVIRONMENT || process.env.NODE_ENV || requireEnv('ENVIRONMENT');
};

const getCloudWatchClient = (): CloudWatchClient => {
  if (!cloudWatchClient) {
    cloudWatchClient = new CloudWatchClient({
      region: resolveAwsRegion(),
    });
  }
  return cloudWatchClient;
};

async function publishMetric(metricName: string, value: number, unit: StandardUnit = StandardUnit.Count): Promise<void> {
  try {
    const environment = resolveEnvironment();
    const commandInput = {
      Namespace: 'CommunityContentHub/ContentProcessor',
      MetricData: [
        {
          MetricName: metricName,
          Value: value,
          Unit: unit,
          Timestamp: new Date(),
          Dimensions: [
            {
              Name: 'Environment',
              Value: environment,
            },
          ],
        },
      ],
    };
    const command = new PutMetricDataCommand(commandInput);
    if (!(command as any).input) {
      (command as any).input = commandInput;
    }
    await getCloudWatchClient().send(command);
  } catch (error: any) {
    console.error(formatErrorForLogging(error, { metricName, context: 'publishMetric' }));
    // Don't fail the main process if metrics fail
  }
}

const buildEmbeddingText = (message: ContentProcessorMessage): string => {
  const title = message.title?.trim() || '';
  const description = message.description?.trim() || '';
  return `${title} ${description}`.trim();
};

async function generateEmbeddingsForTexts(texts: string[]): Promise<Map<string, number[]>> {
  const embeddingService = getEmbeddingService();
  const uniqueTexts = Array.from(new Set(texts.filter((text) => text.trim().length > 0)));

  const results = await Promise.all(
    uniqueTexts.map(async (text) => {
      try {
        const embedding = await embeddingService.generateEmbedding(text);
        return { text, embedding };
      } catch (error: any) {
        const modelId = process.env.BEDROCK_MODEL_ID || 'unknown';
        const bedrockError = new ExternalApiError(
          'Bedrock',
          `Failed to generate embedding: ${error.message}`,
          error.$metadata?.httpStatusCode || 500,
          {
            modelId,
            textLength: text.length,
            originalError: error.message,
          }
        );
        console.error(formatErrorForLogging(bedrockError, { modelId, context: 'batch-embedding' }));
        return { text, embedding: [] };
      }
    })
  );

  return results.reduce((map, { text, embedding }) => {
    map.set(text, embedding);
    return map;
  }, new Map<string, number[]>());
}

type ContentAction =
  | { type: 'skip'; message: ContentProcessorMessage }
  | { type: 'update'; message: ContentProcessorMessage; contentId: string; embeddingText: string }
  | { type: 'create'; message: ContentProcessorMessage; embeddingText: string };

async function planContentAction(
  message: ContentProcessorMessage,
  contentRepository: ContentRepository
): Promise<ContentAction> {
  try {
    console.log(`Processing content: ${message.title} (${message.url})`);

    // Check for duplicate URL
    const existingContent = await contentRepository.findByUrl(message.url);

    if (existingContent) {
      console.log(`Content already exists for URL: ${message.url}`);

      // Check if content has been updated (based on publishDate)
      if (message.publishDate) {
        const messageDate = new Date(message.publishDate);
        const existingDate = existingContent.publishDate;

        if (existingDate && messageDate <= existingDate) {
          console.log('Content has not been updated, skipping');
          return { type: 'skip', message };
        }

        // Update existing content with new embedding
        const embeddingText = buildEmbeddingText(message);
        return { type: 'update', message, contentId: existingContent.id, embeddingText };
      }

      // If no publish date, skip to avoid duplicates
      return { type: 'skip', message };
    }

    // Generate embedding for new content
    const embeddingText = buildEmbeddingText(message);
    return { type: 'create', message, embeddingText };
  } catch (error: any) {
    console.error(formatErrorForLogging(error, {
      userId: message.userId,
      channelId: message.channelId,
      url: message.url,
      context: 'processContent'
    }));
    throw error;
  }
}

export const handler = async (
  event: SQSEvent,
  context: Context
): Promise<void> => {
  const startTime = Date.now();
  console.log(`Processing ${event.Records.length} messages from SQS`);

  // Get database connection (getDatabasePool handles caching internally)
  const pool = await getDatabasePool();

  const contentRepository = new ContentRepository(pool);
  const userRepository = new UserRepository(pool);

  const results = {
    processed: 0,
    failed: 0,
    errors: [] as string[],
  };

  const plannedActions: ContentAction[] = [];

  for (const record of event.Records) {
    try {
      const message: ContentProcessorMessage = JSON.parse(record.body);
      const action = await planContentAction(message, contentRepository);
      plannedActions.push(action);
    } catch (error: any) {
      console.error(formatErrorForLogging(error, {
        recordId: record.messageId,
        context: 'sqs-record-processing'
      }));

      results.failed++;
      results.errors.push(error.message || 'Unknown error');

      // Use shouldRetry to determine if this is a critical error that should go to DLQ
      if (shouldRetry(error)) {
        console.error('Critical error detected - message will be sent to DLQ:', {
          code: error.code,
          message: error.message,
          recordId: record.messageId
        });
        throw error;
      }
    }
  }

  const embeddingTexts = plannedActions
    .filter((action) => action.type !== 'skip')
    .map((action) => action.embeddingText);
  const embeddingsByText = embeddingTexts.length > 0
    ? await generateEmbeddingsForTexts(embeddingTexts)
    : new Map<string, number[]>();

  for (const action of plannedActions) {
    if (action.type === 'skip') {
      results.processed++;
      continue;
    }

    try {
      const embedding = embeddingsByText.get(action.embeddingText) ?? [];

      if (action.type === 'update') {
        const updatePayload: {
          title: string;
          description?: string;
          publishDate?: Date;
          embedding?: number[];
          metadata?: Record<string, any>;
        } = {
          title: action.message.title,
          description: action.message.description,
          publishDate: action.message.publishDate ? new Date(action.message.publishDate) : undefined,
          metadata: action.message.metadata,
        };

        if (embedding.length > 0) {
          updatePayload.embedding = embedding;
        }

        await contentRepository.updateWithEmbedding(action.contentId, updatePayload);
        console.log(`Updated existing content: ${action.contentId}`);
        results.processed++;
        continue;
      }

      const defaultVisibility = await userRepository.getDefaultVisibility(action.message.userId);
      const content = await contentRepository.createContent({
        userId: action.message.userId,
        title: action.message.title,
        description: action.message.description,
        contentType: action.message.contentType,
        visibility: defaultVisibility as Visibility,
        urls: [action.message.url],
        publishDate: action.message.publishDate ? new Date(action.message.publishDate) : undefined,
        tags: [],
      });

      if (embedding.length > 0) {
        await contentRepository.updateWithEmbedding(content.id, {
          embedding,
          metadata: action.message.metadata || {},
        });
      }

      console.log(`Created new content: ${content.id}`);
      results.processed++;
    } catch (error: any) {
      console.error(formatErrorForLogging(error, {
        userId: action.message.userId,
        channelId: action.message.channelId,
        url: action.message.url,
        context: 'processContent'
      }));

      results.failed++;
      results.errors.push(error.message || 'Unknown error');

      if (shouldRetry(error)) {
        console.error('Critical error detected - message will be sent to DLQ:', {
          code: error.code,
          message: error.message,
          context: 'planned-action-processing'
        });
        throw error;
      }
    }
  }

  const processingTime = Date.now() - startTime;

  // Publish CloudWatch metrics
  await Promise.all([
    publishMetric('MessagesProcessed', results.processed),
    publishMetric('MessagesFailed', results.failed),
    publishMetric('ProcessingTime', processingTime, StandardUnit.Milliseconds),
    publishMetric('ProcessingRate', processingTime > 0 ? results.processed / (processingTime / 1000) : 0, StandardUnit.Count_Second),
  ]);

  console.log(
    `Content processor completed. Processed: ${results.processed}, Failed: ${results.failed}, Time: ${processingTime}ms`
  );

  if (results.failed > 0) {
    console.error('Errors:', results.errors);
  }
};
