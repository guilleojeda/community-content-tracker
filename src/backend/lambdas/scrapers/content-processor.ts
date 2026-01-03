import { SQSEvent, Context } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { ContentRepository } from '../../repositories/ContentRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { ContentProcessorMessage, Visibility } from '../../../shared/types';
import { getDatabasePool } from '../../services/database';
import { ExternalApiError, shouldRetry, formatErrorForLogging } from '../../../shared/errors';

let bedrockClient: BedrockRuntimeClient | null = null;
let cloudWatchClient: CloudWatchClient | null = null;

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} must be set`);
  }
  return value;
};

const resolveBedrockRegion = (): string => {
  return process.env.BEDROCK_REGION || process.env.AWS_REGION || requireEnv('BEDROCK_REGION');
};

const resolveAwsRegion = (): string => {
  return process.env.AWS_REGION || process.env.BEDROCK_REGION || requireEnv('AWS_REGION');
};

const resolveEnvironment = (): string => {
  return process.env.ENVIRONMENT || process.env.NODE_ENV || requireEnv('ENVIRONMENT');
};

const getBedrockModelId = (): string => requireEnv('BEDROCK_MODEL_ID');

const getBedrockClient = (): BedrockRuntimeClient => {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({
      region: resolveBedrockRegion(),
    });
  }
  return bedrockClient;
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

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const modelId = getBedrockModelId();
    const commandInput = {
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: text,
      }),
    };
    const command = new InvokeModelCommand(commandInput);
    if (!(command as any).input) {
      (command as any).input = commandInput;
    }
    const response = await getBedrockClient().send(command);

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return responseBody.embedding;
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
    console.error(formatErrorForLogging(bedrockError, { modelId }));
    // Return empty embedding on error to allow content to still be stored
    return [];
  }
}

async function processContent(message: ContentProcessorMessage, contentRepository: ContentRepository, userRepository: UserRepository): Promise<void> {
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
          return;
        }

        // Update existing content with new embedding
        const embeddingText = `${message.title} ${message.description || ''}`;
        const embedding = await generateEmbedding(embeddingText);

        await contentRepository.updateWithEmbedding(existingContent.id, {
          title: message.title,
          description: message.description,
          publishDate: message.publishDate ? new Date(message.publishDate) : undefined,
          embedding,
          metadata: message.metadata,
        });

        console.log(`Updated existing content: ${existingContent.id}`);
        return;
      }

      // If no publish date, skip to avoid duplicates
      return;
    }

    // Generate embedding for new content
    const embeddingText = `${message.title} ${message.description || ''}`;
    const embedding = await generateEmbedding(embeddingText);

    // Get user's default visibility via repository
    const defaultVisibility = await userRepository.getDefaultVisibility(message.userId);

    // Create new content
    const content = await contentRepository.createContent({
      userId: message.userId,
      title: message.title,
      description: message.description,
      contentType: message.contentType,
      visibility: defaultVisibility as Visibility,
      urls: [message.url],
      publishDate: message.publishDate ? new Date(message.publishDate) : undefined,
      tags: [],
    });

    // Update with embedding
    if (embedding.length > 0) {
      await contentRepository.updateWithEmbedding(content.id, {
        embedding,
        metadata: message.metadata || {},
      });
    }

    console.log(`Created new content: ${content.id}`);
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

  for (const record of event.Records) {
    try {
      const message: ContentProcessorMessage = JSON.parse(record.body);
      await processContent(message, contentRepository, userRepository);
      results.processed++;
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
