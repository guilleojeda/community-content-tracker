import { ScheduledEvent, Context } from 'aws-lambda';
import { ChannelType } from '../../../../src/shared/types';

// Mock database pool FIRST
const mockPool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn(),
  on: jest.fn(),
};

jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn().mockResolvedValue(mockPool),
  closeDatabasePool: jest.fn(),
  setTestDatabasePool: jest.fn(),
  resetDatabaseCache: jest.fn(),
}));

// Mock ChannelRepository with class pattern
jest.mock('../../../../src/backend/repositories/ChannelRepository', () => {
  const mockFindAllActiveForSync = jest.fn();

  class MockChannelRepository {
    findAllActiveForSync = mockFindAllActiveForSync;

    static mockFindAllActiveForSync = mockFindAllActiveForSync;
  }

  return { ChannelRepository: MockChannelRepository };
});

// Create shared mock functions that will be used across tests
const mockLambdaSend = jest.fn();
const mockCloudWatchSend = jest.fn();

jest.mock('@aws-sdk/client-lambda', () => {
  const actual = jest.requireActual('@aws-sdk/client-lambda');
  return {
    ...actual,
    LambdaClient: jest.fn(() => ({
      send: mockLambdaSend,
    })),
  };
});

jest.mock('@aws-sdk/client-cloudwatch', () => {
  const actual = jest.requireActual('@aws-sdk/client-cloudwatch');
  return {
    ...actual,
    CloudWatchClient: jest.fn(() => ({
      send: mockCloudWatchSend,
    })),
  };
});
jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  })),
}));

// Set environment variables BEFORE importing handler
// (handler reads these at module load time)
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.CONTENT_PROCESSING_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';
process.env.BLOG_SCRAPER_FUNCTION_NAME = 'blog-scraper-function';
process.env.YOUTUBE_SCRAPER_FUNCTION_NAME = 'youtube-scraper-function';
process.env.GITHUB_SCRAPER_FUNCTION_NAME = 'github-scraper-function';
process.env.ENVIRONMENT = 'test';
process.env.AWS_REGION = 'us-east-1';

// Mock setTimeout to execute immediately but track delays for testing
const setTimeoutDelays: number[] = [];
global.setTimeout = ((callback: any, delay?: number) => {
  setTimeoutDelays.push(delay || 0);
  // Execute callback synchronously for fast test execution
  Promise.resolve().then(callback);
  return 0 as any;
}) as any;

// Import handler and services AFTER mocks and env vars are set up
import { handler } from '../../../../src/backend/lambdas/scrapers/orchestrator';
import { ChannelRepository } from '../../../../src/backend/repositories/ChannelRepository';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { CloudWatchClient, StandardUnit } from '@aws-sdk/client-cloudwatch';

const mockChannelRepository = ChannelRepository as jest.MockedClass<typeof ChannelRepository>;
const mockLambdaClient = LambdaClient as jest.MockedClass<typeof LambdaClient>;
const mockCloudWatchClientClass = CloudWatchClient as jest.MockedClass<typeof CloudWatchClient>;

// Access the mock methods from the mocked class
const mockFindAllActiveForSync = (mockChannelRepository as any).mockFindAllActiveForSync;

describe('Scraper Orchestrator Lambda', () => {
  let mockContext: Context;

  // Helper function to run handler (setTimeout is already mocked globally)
  const runHandlerWithTimers = async (event: ScheduledEvent) => {
    return await handler(event, mockContext);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    setTimeoutDelays.length = 0; // Clear delay tracking
    mockContext = {} as Context;
    mockLambdaClient.mockImplementation(() => ({ send: mockLambdaSend }) as any);
    mockCloudWatchClientClass.mockImplementation(() => ({ send: mockCloudWatchSend }) as any);
  });

  const createEvent = (): ScheduledEvent => ({
    'detail-type': 'Scheduled Event',
    source: 'aws.events',
    time: '2024-01-01T00:00:00Z',
    detail: {},
    account: '123456789',
    region: 'us-east-1',
    resources: [],
    id: 'test-event-id',
    version: '0',
  });

  describe('Success Cases', () => {
    it('should invoke all three scrapers when channels of all types exist', async () => {
      // Mock channels for all three types
      mockFindAllActiveForSync.mockResolvedValue([
        { id: '1', channelType: ChannelType.BLOG, userId: 'user1', url: 'https://blog.com/feed', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', channelType: ChannelType.YOUTUBE, userId: 'user1', url: 'https://youtube.com/channel/123', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '3', channelType: ChannelType.GITHUB, userId: 'user1', url: 'https://github.com/user/repo', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
      ]);

      mockLambdaSend.mockResolvedValue({ StatusCode: 202 });
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent();
      await runHandlerWithTimers(event);

      // Verify channels were queried
      expect(mockFindAllActiveForSync).toHaveBeenCalledWith('daily');

      // Should invoke all 3 scrapers
      expect(mockLambdaSend).toHaveBeenCalledTimes(3);

      // Verify each scraper was invoked with correct parameters
      const calls = mockLambdaSend.mock.calls;
      const functionNames = calls.map(call => call[0].input.FunctionName);

      expect(functionNames).toContain('blog-scraper-function');
      expect(functionNames).toContain('youtube-scraper-function');
      expect(functionNames).toContain('github-scraper-function');

      // All should use async invocation
      calls.forEach(call => {
        expect(call[0].input.InvocationType).toBe('Event');
      });
    });

    it('should only invoke scrapers for channel types that exist', async () => {
      // Only blog channels exist
      mockFindAllActiveForSync.mockResolvedValue([
        { id: '1', channelType: ChannelType.BLOG, userId: 'user1', url: 'https://blog.com/feed', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', channelType: ChannelType.BLOG, userId: 'user2', url: 'https://blog2.com/feed', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
      ]);

      mockLambdaSend.mockResolvedValue({ StatusCode: 202 });
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent();
      await runHandlerWithTimers(event);

      // Should only invoke blog scraper
      expect(mockLambdaSend).toHaveBeenCalledTimes(1);
      expect(mockLambdaSend.mock.calls[0][0].input.FunctionName).toBe('blog-scraper-function');
    });

    it('should publish success metrics to CloudWatch', async () => {
      mockFindAllActiveForSync.mockResolvedValue([
        { id: '1', channelType: ChannelType.BLOG, userId: 'user1', url: 'https://blog.com/feed', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', channelType: ChannelType.YOUTUBE, userId: 'user1', url: 'https://youtube.com/channel/123', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '3', channelType: ChannelType.GITHUB, userId: 'user1', url: 'https://github.com/user/repo', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
      ]);

      mockLambdaSend.mockResolvedValue({ StatusCode: 202 });
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent();
      await runHandlerWithTimers(event);

      // Should publish 5 metrics
      expect(mockCloudWatchSend).toHaveBeenCalledTimes(5);

      // Verify specific metrics
      const metricCalls = mockCloudWatchSend.mock.calls;
      const metricNames = metricCalls.map(call => call[0].input.MetricData[0].MetricName);

      expect(metricNames).toContain('ScrapersInvoked');
      expect(metricNames).toContain('ScrapersSucceeded');
      expect(metricNames).toContain('ScrapersFailed');
      expect(metricNames).toContain('OrchestrationTime');
      expect(metricNames).toContain('SuccessRate');

      // Check specific values
      const scrapersInvokedMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'ScrapersInvoked'
      );
      expect(scrapersInvokedMetric[0].input.MetricData[0].Value).toBe(3);

      const successMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'ScrapersSucceeded'
      );
      expect(successMetric[0].input.MetricData[0].Value).toBe(3);

      const failedMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'ScrapersFailed'
      );
      expect(failedMetric[0].input.MetricData[0].Value).toBe(0);

      const successRateMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'SuccessRate'
      );
      expect(successRateMetric[0].input.MetricData[0].Value).toBe(100);
      expect(successRateMetric[0].input.MetricData[0].Unit).toBe(StandardUnit.Percent);

      const orchTimeMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'OrchestrationTime'
      );
      expect(orchTimeMetric[0].input.MetricData[0].Unit).toBe(StandardUnit.Milliseconds);
    });

    it('should include correct namespace and dimensions in metrics', async () => {
      mockFindAllActiveForSync.mockResolvedValue([
        { id: '1', channelType: ChannelType.BLOG, userId: 'user1', url: 'https://blog.com/feed', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
      ]);

      mockLambdaSend.mockResolvedValue({ StatusCode: 202 });
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent();
      await runHandlerWithTimers(event);

      const metricCalls = mockCloudWatchSend.mock.calls;
      metricCalls.forEach(call => {
        expect(call[0].input.Namespace).toBe('CommunityContentHub/ScraperOrchestrator');
        expect(call[0].input.MetricData[0].Dimensions).toEqual([
          {
            Name: 'Environment',
            Value: 'test',
          },
        ]);
      });
    });
  });

  describe('Error Handling', () => {
    it('should continue when one scraper fails', async () => {
      mockFindAllActiveForSync.mockResolvedValue([
        { id: '1', channelType: ChannelType.BLOG, userId: 'user1', url: 'https://blog.com/feed', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', channelType: ChannelType.YOUTUBE, userId: 'user1', url: 'https://youtube.com/channel/123', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '3', channelType: ChannelType.GITHUB, userId: 'user1', url: 'https://github.com/user/repo', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
      ]);

      mockLambdaSend
        .mockResolvedValueOnce({ StatusCode: 202 }) // blog succeeds
        .mockRejectedValueOnce(new Error('YouTube scraper error')) // youtube fails attempt 1
        .mockRejectedValueOnce(new Error('YouTube scraper error')) // youtube retry 1
        .mockRejectedValueOnce(new Error('YouTube scraper error')) // youtube retry 2
        .mockResolvedValueOnce({ StatusCode: 202 }); // github succeeds
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent();
      await runHandlerWithTimers(event);

      // Should invoke blog (1) + youtube attempts (3) + github (1) = 5 total
      expect(mockLambdaSend).toHaveBeenCalledTimes(5);

      // Verify metrics reflect partial failure
      const metricCalls = mockCloudWatchSend.mock.calls;

      const successMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'ScrapersSucceeded'
      );
      expect(successMetric[0].input.MetricData[0].Value).toBe(2);

      const failedMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'ScrapersFailed'
      );
      expect(failedMetric[0].input.MetricData[0].Value).toBe(1);

      const successRateMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'SuccessRate'
      );
      expect(Math.abs(successRateMetric[0].input.MetricData[0].Value - 66.67)).toBeLessThan(0.1);
    });

    it('should handle unexpected status codes', async () => {
      mockFindAllActiveForSync.mockResolvedValue([
        { id: '1', channelType: ChannelType.BLOG, userId: 'user1', url: 'https://blog.com/feed', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', channelType: ChannelType.YOUTUBE, userId: 'user1', url: 'https://youtube.com/channel/123', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '3', channelType: ChannelType.GITHUB, userId: 'user1', url: 'https://github.com/user/repo', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
      ]);

      mockLambdaSend.mockResolvedValue({ StatusCode: 500 }); // Unexpected status
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent();
      await runHandlerWithTimers(event);

      // Verify metrics show failures
      const metricCalls = mockCloudWatchSend.mock.calls;

      const failedMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'ScrapersFailed'
      );
      expect(failedMetric[0].input.MetricData[0].Value).toBe(3);

      const successRateMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'SuccessRate'
      );
      expect(successRateMetric[0].input.MetricData[0].Value).toBe(0);
    });

    it('should not throw errors when all scrapers fail', async () => {
      mockFindAllActiveForSync.mockResolvedValue([
        { id: '1', channelType: ChannelType.BLOG, userId: 'user1', url: 'https://blog.com/feed', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', channelType: ChannelType.YOUTUBE, userId: 'user1', url: 'https://youtube.com/channel/123', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '3', channelType: ChannelType.GITHUB, userId: 'user1', url: 'https://github.com/user/repo', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
      ]);

      mockLambdaSend.mockRejectedValue(new Error('Scraper invocation failed'));
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent();

      // Should not throw - orchestrator handles errors gracefully
      await expect(runHandlerWithTimers(event)).resolves.not.toThrow();

      // Verify all scrapers were attempted with retries
      // 3 scrapers × 3 attempts (initial + 2 retries) = 9 total calls
      expect(mockLambdaSend).toHaveBeenCalledTimes(9);
    });

    it('should continue if CloudWatch metrics fail', async () => {
      mockFindAllActiveForSync.mockResolvedValue([
        { id: '1', channelType: ChannelType.BLOG, userId: 'user1', url: 'https://blog.com/feed', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', channelType: ChannelType.YOUTUBE, userId: 'user1', url: 'https://youtube.com/channel/123', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '3', channelType: ChannelType.GITHUB, userId: 'user1', url: 'https://github.com/user/repo', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
      ]);

      mockLambdaSend.mockResolvedValue({ StatusCode: 202 });
      mockCloudWatchSend.mockRejectedValue(new Error('CloudWatch error'));

      const event = createEvent();

      // Should not throw even if metrics fail
      await expect(handler(event, mockContext)).resolves.not.toThrow();

      // Verify scrapers were still invoked
      expect(mockLambdaSend).toHaveBeenCalledTimes(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle no scrapers configured (all env vars missing)', async () => {
      const originalEnv = {
        blog: process.env.BLOG_SCRAPER_FUNCTION_NAME,
        youtube: process.env.YOUTUBE_SCRAPER_FUNCTION_NAME,
        github: process.env.GITHUB_SCRAPER_FUNCTION_NAME,
      };
      mockFindAllActiveForSync.mockResolvedValue([
        { id: '1', channelType: ChannelType.BLOG, userId: 'user1', url: 'https://blog.com/feed', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', channelType: ChannelType.YOUTUBE, userId: 'user1', url: 'https://youtube.com/channel/123', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '3', channelType: ChannelType.GITHUB, userId: 'user1', url: 'https://github.com/user/repo', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
      ]);

      delete process.env.BLOG_SCRAPER_FUNCTION_NAME;
      delete process.env.YOUTUBE_SCRAPER_FUNCTION_NAME;
      delete process.env.GITHUB_SCRAPER_FUNCTION_NAME;

      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent();
      await runHandlerWithTimers(event);

      // Should not invoke any scrapers
      expect(mockLambdaSend).not.toHaveBeenCalled();

      // Should still publish metrics (all zeros)
      const metricCalls = mockCloudWatchSend.mock.calls;
      const invokedMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'ScrapersInvoked'
      );
      expect(invokedMetric[0].input.MetricData[0].Value).toBe(0);

      if (originalEnv.blog === undefined) {
        delete process.env.BLOG_SCRAPER_FUNCTION_NAME;
      } else {
        process.env.BLOG_SCRAPER_FUNCTION_NAME = originalEnv.blog;
      }
      if (originalEnv.youtube === undefined) {
        delete process.env.YOUTUBE_SCRAPER_FUNCTION_NAME;
      } else {
        process.env.YOUTUBE_SCRAPER_FUNCTION_NAME = originalEnv.youtube;
      }
      if (originalEnv.github === undefined) {
        delete process.env.GITHUB_SCRAPER_FUNCTION_NAME;
      } else {
        process.env.GITHUB_SCRAPER_FUNCTION_NAME = originalEnv.github;
      }
    });

    it('should handle partial scraper configuration', async () => {
      const originalEnv = {
        youtube: process.env.YOUTUBE_SCRAPER_FUNCTION_NAME,
      };
      mockFindAllActiveForSync.mockResolvedValue([
        { id: '1', channelType: ChannelType.BLOG, userId: 'user1', url: 'https://blog.com/feed', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', channelType: ChannelType.YOUTUBE, userId: 'user1', url: 'https://youtube.com/channel/123', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '3', channelType: ChannelType.GITHUB, userId: 'user1', url: 'https://github.com/user/repo', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
      ]);

      delete process.env.YOUTUBE_SCRAPER_FUNCTION_NAME;
      mockLambdaSend.mockResolvedValue({ StatusCode: 202 });
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent();
      await runHandlerWithTimers(event);

      // Should only invoke 2 scrapers (blog and github)
      expect(mockLambdaSend).toHaveBeenCalledTimes(2);

      // Verify metrics
      const metricCalls = mockCloudWatchSend.mock.calls;
      const invokedMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'ScrapersInvoked'
      );
      expect(invokedMetric[0].input.MetricData[0].Value).toBe(2);

      if (originalEnv.youtube === undefined) {
        delete process.env.YOUTUBE_SCRAPER_FUNCTION_NAME;
      } else {
        process.env.YOUTUBE_SCRAPER_FUNCTION_NAME = originalEnv.youtube;
      }
    });

    it('should handle mixed success/failure scenarios', async () => {
      mockFindAllActiveForSync.mockResolvedValue([
        { id: '1', channelType: ChannelType.BLOG, userId: 'user1', url: 'https://blog.com/feed', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', channelType: ChannelType.YOUTUBE, userId: 'user1', url: 'https://youtube.com/channel/123', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '3', channelType: ChannelType.GITHUB, userId: 'user1', url: 'https://github.com/user/repo', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
      ]);

      mockLambdaSend
        .mockResolvedValueOnce({ StatusCode: 202 }) // blog succeeds
        .mockResolvedValueOnce({ StatusCode: 500 }) // youtube gets unexpected status
        .mockRejectedValueOnce(new Error('Network error')); // github throws error
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent();
      await runHandlerWithTimers(event);

      const metricCalls = mockCloudWatchSend.mock.calls;

      const successMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'ScrapersSucceeded'
      );
      expect(successMetric[0].input.MetricData[0].Value).toBe(1);

      const failedMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'ScrapersFailed'
      );
      expect(failedMetric[0].input.MetricData[0].Value).toBe(2);

      const successRateMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'SuccessRate'
      );
      expect(Math.abs(successRateMetric[0].input.MetricData[0].Value - 33.33)).toBeLessThan(0.1);
    });

    it('should handle default environment values', async () => {
      const originalEnvironment = process.env.ENVIRONMENT;
      mockFindAllActiveForSync.mockResolvedValue([
        { id: '1', channelType: ChannelType.BLOG, userId: 'user1', url: 'https://blog.com/feed', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
      ]);

      delete process.env.ENVIRONMENT;
      process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';

      mockLambdaSend.mockResolvedValue({ StatusCode: 202 });
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent();
      await runHandlerWithTimers(event);

      // Should use default environment value
      const metricCalls = mockCloudWatchSend.mock.calls;
      metricCalls.forEach(call => {
        expect(call[0].input.MetricData[0].Dimensions).toEqual([
          {
            Name: 'Environment',
            Value: 'test', // Default value from NODE_ENV in test runs
          },
        ]);
      });

      if (originalEnvironment === undefined) {
        delete process.env.ENVIRONMENT;
      } else {
        process.env.ENVIRONMENT = originalEnvironment;
      }
    });
  });

  describe('Sequential Execution with Rate Limiting', () => {
    it('should invoke scrapers sequentially with delays to respect rate limits', async () => {
      mockFindAllActiveForSync.mockResolvedValue([
        { id: '1', channelType: ChannelType.BLOG, userId: 'user1', url: 'https://blog.com/feed', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', channelType: ChannelType.YOUTUBE, userId: 'user1', url: 'https://youtube.com/channel/123', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
        { id: '3', channelType: ChannelType.GITHUB, userId: 'user1', url: 'https://github.com/user/repo', enabled: true, syncFrequency: 'daily' as const, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
      ]);

      const invocationTimes: number[] = [];

      mockLambdaSend.mockImplementation(async () => {
        invocationTimes.push(Date.now());
        await new Promise(resolve => setTimeout(resolve, 10)); // Simulate delay
        return { StatusCode: 202 };
      });
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent();
      await runHandlerWithTimers(event);

      // Verify all 3 scrapers were invoked
      expect(mockLambdaSend).toHaveBeenCalledTimes(3);

      // Verify rate limiting delays were used
      // The orchestrator should have called setTimeout with specific delays based on channel type
      // Blog: 500ms, YouTube: 2000ms (delays happen between invocations)
      // Expected delays: [500, 2000] (first delay after Blog, second after YouTube, no delay after GitHub)
      const rateLimitingDelays = setTimeoutDelays.filter(d => d >= 500); // Filter out mock implementation delays
      expect(rateLimitingDelays.length).toBe(2); // 2 delays between 3 scrapers
      expect(rateLimitingDelays).toContain(500);  // Blog rate limiting delay
      expect(rateLimitingDelays).toContain(2000); // YouTube rate limiting delay
    });
  });

  describe('Database Query Scenarios', () => {
    it('should not invoke any scrapers when no active channels exist', async () => {
      mockFindAllActiveForSync.mockResolvedValue([]);
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent();
      await runHandlerWithTimers(event);

      // Should not invoke any scrapers
      expect(mockLambdaSend).not.toHaveBeenCalled();

      // Should still publish metrics (all zeros)
      const metricCalls = mockCloudWatchSend.mock.calls;
      const invokedMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'ScrapersInvoked'
      );
      expect(invokedMetric[0].input.MetricData[0].Value).toBe(0);
    });

    it('should handle database query errors gracefully', async () => {
      mockFindAllActiveForSync.mockRejectedValue(new Error('Database connection error'));
      mockCloudWatchSend.mockResolvedValue({});

      const event = createEvent();

      // Should not throw even if database query fails
      await expect(handler(event, mockContext)).resolves.not.toThrow();

      // Should not invoke any scrapers
      expect(mockLambdaSend).not.toHaveBeenCalled();

      // Should still publish metrics (all zeros)
      const metricCalls = mockCloudWatchSend.mock.calls;
      const invokedMetric = metricCalls.find(
        call => call[0].input?.MetricData?.[0]?.MetricName === 'ScrapersInvoked'
      );
      expect(invokedMetric[0].input.MetricData[0].Value).toBe(0);
    });
  });
});
