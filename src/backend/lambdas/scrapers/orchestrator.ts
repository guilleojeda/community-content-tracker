import { ScheduledEvent, Context } from 'aws-lambda';
import { Pool } from 'pg';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { ChannelRepository } from '../../repositories/ChannelRepository';
import { ChannelType } from '../../../shared/types';
import { getDatabasePool } from '../../services/database';
import { ExternalApiError, ValidationError, formatErrorForLogging } from '../../../shared/errors';

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const cloudWatchClient = new CloudWatchClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Validate required environment variables at module load
function validateEnvironment(): void {
  const required = ['BLOG_SCRAPER_FUNCTION_NAME', 'YOUTUBE_SCRAPER_FUNCTION_NAME', 'GITHUB_SCRAPER_FUNCTION_NAME'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.warn(`Missing scraper function names: ${missing.join(', ')} - some scrapers will not be invoked`);
  }
}

validateEnvironment();

const BLOG_SCRAPER_FUNCTION = process.env.BLOG_SCRAPER_FUNCTION_NAME;
const YOUTUBE_SCRAPER_FUNCTION = process.env.YOUTUBE_SCRAPER_FUNCTION_NAME;
const GITHUB_SCRAPER_FUNCTION = process.env.GITHUB_SCRAPER_FUNCTION_NAME;
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';

// Lambda global scope - database pool persists across invocations
let pool: Pool | null = null;

async function publishMetric(metricName: string, value: number, unit: StandardUnit = StandardUnit.Count): Promise<void> {
  try {
    await cloudWatchClient.send(new PutMetricDataCommand({
      Namespace: 'CommunityContentHub/ScraperOrchestrator',
      MetricData: [
        {
          MetricName: metricName,
          Value: value,
          Unit: unit,
          Timestamp: new Date(),
          Dimensions: [
            {
              Name: 'Environment',
              Value: ENVIRONMENT,
            },
          ],
        },
      ],
    }));
  } catch (error: any) {
    console.error(formatErrorForLogging(error, { metricName, context: 'publishMetric' }));
    // Don't fail the main process if metrics fail
  }
}

interface ScraperResult {
  scraper: string;
  success: boolean;
  error?: string;
}

async function invokeScraper(functionName: string, retries = 2): Promise<ScraperResult> {
  let lastError: any;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        const backoffDelay = Math.pow(2, attempt) * 1000;
        console.log(`Retry attempt ${attempt}/${retries} for ${functionName} after ${backoffDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }

      console.log(`Invoking scraper: ${functionName} (attempt ${attempt + 1}/${retries + 1})`);

      const response = await lambdaClient.send(new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event', // Async invocation
      }));

      if (response.StatusCode === 202) {
        return {
          scraper: functionName,
          success: true,
        };
      } else {
        const apiError = new ExternalApiError(
          'Lambda',
          `Unexpected status code: ${response.StatusCode}`,
          response.StatusCode || 500,
          { functionName, statusCode: response.StatusCode }
        );
        console.error(formatErrorForLogging(apiError, { functionName, attempt }));
        lastError = apiError;
      }
    } catch (error: any) {
      const lambdaError = new ExternalApiError(
        'Lambda',
        `Failed to invoke scraper: ${error.message}`,
        error.$metadata?.httpStatusCode || 500,
        { functionName, attempt, originalError: error.message }
      );
      console.error(formatErrorForLogging(lambdaError, { functionName, attempt }));
      lastError = lambdaError;
    }
  }

  return {
    scraper: functionName,
    success: false,
    error: lastError.message || 'Unknown error',
  };
}

export const handler = async (
  event: ScheduledEvent,
  context: Context
): Promise<void> => {
  const startTime = Date.now();
  console.log('Starting scraper orchestration');
  console.log('Event:', JSON.stringify(event));

  // Initialize database connection in global scope for reuse
  if (!pool) {
    pool = await getDatabasePool();
  }

  const channelRepository = new ChannelRepository(pool);

  const results: ScraperResult[] = [];

  try {
    // Query for active channels that need daily sync
    console.log('Querying for active channels...');
    const activeChannels = await channelRepository.findAllActiveForSync('daily');
    console.log(`Found ${activeChannels.length} active channels for daily sync`);

    // Group channels by type
    const channelsByType = activeChannels.reduce((acc, channel) => {
      if (!acc[channel.channelType]) {
        acc[channel.channelType] = [];
      }
      acc[channel.channelType].push(channel);
      return acc;
    }, {} as Record<ChannelType, typeof activeChannels>);

    console.log(`Channel distribution: Blog=${channelsByType[ChannelType.BLOG]?.length || 0}, YouTube=${channelsByType[ChannelType.YOUTUBE]?.length || 0}, GitHub=${channelsByType[ChannelType.GITHUB]?.length || 0}`);

    // Build list of scrapers to invoke based on active channels
    const scrapersToInvoke: Array<{ name: string; label: string; type: ChannelType }> = [];

    if (channelsByType[ChannelType.BLOG]?.length > 0 && BLOG_SCRAPER_FUNCTION) {
      scrapersToInvoke.push({ name: BLOG_SCRAPER_FUNCTION, label: 'Blog RSS', type: ChannelType.BLOG });
    }

    if (channelsByType[ChannelType.YOUTUBE]?.length > 0 && YOUTUBE_SCRAPER_FUNCTION) {
      scrapersToInvoke.push({ name: YOUTUBE_SCRAPER_FUNCTION, label: 'YouTube', type: ChannelType.YOUTUBE });
    }

    if (channelsByType[ChannelType.GITHUB]?.length > 0 && GITHUB_SCRAPER_FUNCTION) {
      scrapersToInvoke.push({ name: GITHUB_SCRAPER_FUNCTION, label: 'GitHub', type: ChannelType.GITHUB });
    }

    console.log(`Invoking ${scrapersToInvoke.length} scrapers based on active channels`);

    // Rate limiting delays per channel type (in milliseconds)
    // Different APIs have different rate limit requirements
    const SCRAPER_DELAYS: Record<ChannelType, number> = {
      [ChannelType.YOUTUBE]: 2000,  // YouTube has strict quotas, 2 second delay
      [ChannelType.GITHUB]: 1000,   // GitHub rate limits, 1 second delay
      [ChannelType.BLOG]: 500        // RSS feeds are less restrictive, 0.5 second delay
    };

    // Invoke scrapers sequentially with rate limiting
    // This prevents overwhelming external APIs and respects rate limits
    for (let i = 0; i < scrapersToInvoke.length; i++) {
      const scraper = scrapersToInvoke[i];
      console.log(`Invoking scraper ${i + 1}/${scrapersToInvoke.length}: ${scraper.label}`);

      const result = await invokeScraper(scraper.name);
      results.push(result);

      // Add delay between scrapers (except after the last one)
      if (i < scrapersToInvoke.length - 1) {
        const delay = SCRAPER_DELAYS[scraper.type];
        console.log(`Waiting ${delay}ms before next scraper (rate limiting)...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  } catch (error: any) {
    console.error(formatErrorForLogging(error, { context: 'query-channels' }));
    // If we can't query channels, log error but don't throw
    // This prevents orchestrator from retrying unnecessarily
  }

  // Log results
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const executionTime = Date.now() - startTime;

  // Publish CloudWatch metrics
  const successRate = results.length > 0 ? (successful / results.length) * 100 : 0;
  await Promise.all([
    publishMetric('ScrapersInvoked', results.length),
    publishMetric('ScrapersSucceeded', successful),
    publishMetric('ScrapersFailed', failed),
    publishMetric('OrchestrationTime', executionTime, StandardUnit.Milliseconds),
    publishMetric('SuccessRate', successRate, StandardUnit.Percent),
  ]);

  console.log(`Orchestration completed. Successful: ${successful}, Failed: ${failed}, Time: ${executionTime}ms`);

  if (failed > 0) {
    const failedScrapers = results.filter(r => !r.success);
    console.error('Failed scrapers:', failedScrapers);
  }

  // Note: We don't throw errors here to avoid retries of the orchestrator itself
  // Individual scrapers handle their own retries
};
