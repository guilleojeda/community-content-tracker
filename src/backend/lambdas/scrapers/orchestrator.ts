import { ScheduledEvent, Context } from 'aws-lambda';
import { Pool } from 'pg';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { ChannelRepository } from '../../repositories/ChannelRepository';
import { ChannelType } from '../../../shared/types';
import { getDatabasePool } from '../../services/database';
import { ExternalApiError, formatErrorForLogging } from '../../../shared/errors';

const REQUIRED_SCRAPER_ENV = [
  'BLOG_SCRAPER_FUNCTION_NAME',
  'YOUTUBE_SCRAPER_FUNCTION_NAME',
  'GITHUB_SCRAPER_FUNCTION_NAME',
];

let lambdaClient: LambdaClient | null = null;
let cloudWatchClient: CloudWatchClient | null = null;
let cachedRegion: string | null = null;

function resolveRegion(): string {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region || region.trim().length === 0) {
    throw new Error('AWS_REGION must be set');
  }
  return region.trim();
}

function resolveEnvironment(): string {
  const environment = process.env.ENVIRONMENT || process.env.NODE_ENV || 'dev';
  return environment.trim().length > 0 ? environment.trim() : 'dev';
}

function resolveScraperFunctions(): {
  blog?: string;
  youtube?: string;
  github?: string;
} {
  const missing = REQUIRED_SCRAPER_ENV.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.warn(`Missing scraper function names: ${missing.join(', ')} - some scrapers will not be invoked`);
  }

  return {
    blog: process.env.BLOG_SCRAPER_FUNCTION_NAME,
    youtube: process.env.YOUTUBE_SCRAPER_FUNCTION_NAME,
    github: process.env.GITHUB_SCRAPER_FUNCTION_NAME,
  };
}

function getAwsClients(region: string): { lambdaClient: LambdaClient; cloudWatchClient: CloudWatchClient } {
  if (!lambdaClient || !cloudWatchClient || cachedRegion !== region) {
    lambdaClient = new LambdaClient({ region });
    cloudWatchClient = new CloudWatchClient({ region });
    cachedRegion = region;
  }

  return { lambdaClient, cloudWatchClient };
}

// Lambda global scope - database pool persists across invocations
let pool: Pool | null = null;

async function publishMetric(
  client: CloudWatchClient,
  environment: string,
  metricName: string,
  value: number,
  unit: StandardUnit = StandardUnit.Count
): Promise<void> {
  try {
    await client.send(new PutMetricDataCommand({
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
              Value: environment,
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

async function invokeScraper(
  client: LambdaClient,
  functionName: string,
  retries = 2
): Promise<ScraperResult> {
  let lastError: any;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        const backoffDelay = Math.pow(2, attempt) * 1000;
        console.log(`Retry attempt ${attempt}/${retries} for ${functionName} after ${backoffDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }

      console.log(`Invoking scraper: ${functionName} (attempt ${attempt + 1}/${retries + 1})`);

      const response = await client.send(new InvokeCommand({
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

  const region = resolveRegion();
  const environment = resolveEnvironment();
  const scraperFunctions = resolveScraperFunctions();
  const { lambdaClient: activeLambdaClient, cloudWatchClient: activeCloudWatchClient } = getAwsClients(region);

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

    if (channelsByType[ChannelType.BLOG]?.length > 0 && scraperFunctions.blog) {
      scrapersToInvoke.push({ name: scraperFunctions.blog, label: 'Blog RSS', type: ChannelType.BLOG });
    }

    if (channelsByType[ChannelType.YOUTUBE]?.length > 0 && scraperFunctions.youtube) {
      scrapersToInvoke.push({ name: scraperFunctions.youtube, label: 'YouTube', type: ChannelType.YOUTUBE });
    }

    if (channelsByType[ChannelType.GITHUB]?.length > 0 && scraperFunctions.github) {
      scrapersToInvoke.push({ name: scraperFunctions.github, label: 'GitHub', type: ChannelType.GITHUB });
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

      const result = await invokeScraper(activeLambdaClient, scraper.name);
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
    publishMetric(activeCloudWatchClient, environment, 'ScrapersInvoked', results.length),
    publishMetric(activeCloudWatchClient, environment, 'ScrapersSucceeded', successful),
    publishMetric(activeCloudWatchClient, environment, 'ScrapersFailed', failed),
    publishMetric(activeCloudWatchClient, environment, 'OrchestrationTime', executionTime, StandardUnit.Milliseconds),
    publishMetric(activeCloudWatchClient, environment, 'SuccessRate', successRate, StandardUnit.Percent),
  ]);

  console.log(`Orchestration completed. Successful: ${successful}, Failed: ${failed}, Time: ${executionTime}ms`);

  if (failed > 0) {
    const failedScrapers = results.filter(r => !r.success);
    console.error('Failed scrapers:', failedScrapers);
  }

  // Note: We don't throw errors here to avoid retries of the orchestrator itself
  // Individual scrapers handle their own retries
};
