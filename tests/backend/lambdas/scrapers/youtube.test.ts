import { ScheduledEvent, Context } from 'aws-lambda';

// Set required environment variables BEFORE importing handler
process.env.CONTENT_PROCESSING_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';
process.env.YOUTUBE_API_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789:secret:youtube-api-key';
process.env.AWS_REGION = 'us-east-1';

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
  const mockFindActiveByType = jest.fn();
  const mockUpdateSyncStatus = jest.fn();

  class MockChannelRepository {
    findActiveByType = mockFindActiveByType;
    updateSyncStatus = mockUpdateSyncStatus;

    static mockFindActiveByType = mockFindActiveByType;
    static mockUpdateSyncStatus = mockUpdateSyncStatus;
  }

  return { ChannelRepository: MockChannelRepository };
});

// Create mock functions for AWS services
const mockSQSSend = jest.fn();
const mockSecretsSend = jest.fn();

jest.mock('@aws-sdk/client-sqs', () => {
  return {
    SQSClient: jest.fn().mockImplementation(() => ({
      send: mockSQSSend,
    })),
    SendMessageCommand: jest.fn().mockImplementation((input) => ({ input })),
  };
});

jest.mock('@aws-sdk/client-secrets-manager', () => {
  return {
    SecretsManagerClient: jest.fn().mockImplementation(() => ({
      send: mockSecretsSend,
    })),
    GetSecretValueCommand: jest.fn().mockImplementation((input) => ({ input })),
  };
});

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  })),
}));

// Mock global fetch
global.fetch = jest.fn();

// Import handler and services AFTER mocks are set up
import { handler } from '../../../../src/backend/lambdas/scrapers/youtube';
import { ChannelRepository } from '../../../../src/backend/repositories/ChannelRepository';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const mockChannelRepository = ChannelRepository as jest.MockedClass<typeof ChannelRepository>;
const mockSQSClient = SQSClient as jest.MockedClass<typeof SQSClient>;
const mockSecretsManagerClient = SecretsManagerClient as jest.MockedClass<typeof SecretsManagerClient>;
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

// Access the mock methods from the mocked class
const mockFindActiveByType = (mockChannelRepository as any).mockFindActiveByType;
const mockUpdateSyncStatus = (mockChannelRepository as any).mockUpdateSyncStatus;

describe('YouTube Scraper Lambda', () => {
  let mockContext: Context;

  beforeEach(() => {
    jest.clearAllMocks();
    mockContext = {} as Context;
    process.env.CONTENT_PROCESSING_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';
    process.env.YOUTUBE_API_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789:secret:youtube-api-key';
    process.env.AWS_REGION = 'us-east-1';

    // Clear cached API key between tests
    delete process.env.YOUTUBE_API_KEY;

    // Debug: Check if mock methods are accessible
    console.log('mockFindActiveByType:', typeof mockFindActiveByType);
    console.log('mockUpdateSyncStatus:', typeof mockUpdateSyncStatus);
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

  const mockYouTubeChannelResponse = (channelId: string) => ({
    items: [
      {
        id: channelId,
        contentDetails: {
          relatedPlaylists: {
            uploads: `UU${channelId.substring(2)}`,
          },
        },
      },
    ],
  });

  const mockYouTubeVideosResponse = (videos: any[]) => ({
    items: videos,
  });

  describe('Success Cases', () => {
    it('should fetch API key from Secrets Manager and process YouTube videos', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxx',
          enabled: true,
          lastSyncAt: new Date('2024-01-01'),
        },
      ];

      const mockVideos = [
        {
          snippet: {
            resourceId: { videoId: 'video-1' },
            title: 'Test Video',
            description: 'Test Description',
            publishedAt: '2024-01-02T00:00:00Z',
            thumbnails: {
              default: { url: 'https://i.ytimg.com/vi/video-1/default.jpg' },
            },
          },
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({
        SecretString: 'test-api-key',
      });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeChannelResponse('UCxxxxxxxxxxxxxx'),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeVideosResponse(mockVideos),
        } as Response);
      mockSQSSend.mockResolvedValue({});
      mockUpdateSyncStatus.mockResolvedValue({});

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockSecretsSend).toHaveBeenCalledWith(expect.any(GetSecretValueCommand));
      expect(mockFindActiveByType).toHaveBeenCalledWith('youtube');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockSQSSend).toHaveBeenCalledWith(expect.any(SendMessageCommand));
      expect(mockUpdateSyncStatus).toHaveBeenCalledWith('channel-1', 'success');
    });

    it('should filter videos by lastSyncAt timestamp', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxx',
          enabled: true,
          lastSyncAt: new Date('2024-01-02T00:00:00Z'),
        },
      ];

      const mockVideos = [
        {
          snippet: {
            resourceId: { videoId: 'old-video' },
            title: 'Old Video',
            description: 'Old',
            publishedAt: '2024-01-01T00:00:00Z',
            thumbnails: { default: { url: 'https://i.ytimg.com/vi/old/default.jpg' } },
          },
        },
        {
          snippet: {
            resourceId: { videoId: 'new-video' },
            title: 'New Video',
            description: 'New',
            publishedAt: '2024-01-03T00:00:00Z',
            thumbnails: { default: { url: 'https://i.ytimg.com/vi/new/default.jpg' } },
          },
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeChannelResponse('UCxxxxxxxxxxxxxx'),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeVideosResponse(mockVideos),
        } as Response);
      mockSQSSend.mockResolvedValue({});

      const event = createEvent();
      await handler(event, mockContext);

      // Should only send 1 message (the new video)
      expect(mockSQSSend).toHaveBeenCalledTimes(1);
      const sendCall = mockSQSSend.mock.calls[0][0];
      const messageBody = JSON.parse(sendCall.input.MessageBody);
      expect(messageBody.metadata.videoId).toBe('new-video');
    });

    it('should handle @username URL format', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/@testchannel',
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [{ id: 'UCresolved' }] }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeChannelResponse('UCresolved'),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeVideosResponse([]),
        } as Response);

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockUpdateSyncStatus).toHaveBeenCalledWith('channel-1', 'success');
    });

    it('should use environment variable API key as fallback', async () => {
      process.env.YOUTUBE_API_KEY = 'env-api-key';
      delete process.env.YOUTUBE_API_SECRET_ARN;

      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxx',
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeChannelResponse('UCxxxxxxxxxxxxxx'),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeVideosResponse([]),
        } as Response);

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockSecretsSend).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('Channel ID Extraction', () => {
    it('should extract channel ID from /channel/ URL format', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxx?feature=xyz',
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeChannelResponse('UCxxxxxxxxxxxxxx'),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeVideosResponse([]),
        } as Response);

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockUpdateSyncStatus).toHaveBeenCalledWith('channel-1', 'success');
    });

    it('should extract channel ID from /c/ URL format', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/c/customname',
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [{ id: 'UCresolved123' }] }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeChannelResponse('UCresolved123'),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeVideosResponse([]),
        } as Response);

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockUpdateSyncStatus).toHaveBeenCalledWith('channel-1', 'success');
    });

    it('should handle invalid channel URL format', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/invalid',
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockUpdateSyncStatus).toHaveBeenCalledWith(
        'channel-1',
        'error',
        'Invalid YouTube channel or playlist URL'
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle YouTube API errors gracefully', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxx',
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      } as Response);

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockUpdateSyncStatus).toHaveBeenCalledWith(
        'channel-1',
        'error',
        expect.stringContaining('YouTube API error')
      );
    });

    it('should detect and handle rate limit errors', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxx',
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      } as Response);

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockUpdateSyncStatus).toHaveBeenCalledWith(
        'channel-1',
        'error',
        expect.stringContaining('YouTube API error')
      );
    });

    it('should handle missing API key gracefully', async () => {
      delete process.env.YOUTUBE_API_SECRET_ARN;
      delete process.env.YOUTUBE_API_KEY;

      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxx',
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockUpdateSyncStatus).toHaveBeenCalledWith(
        'channel-1',
        'error',
        expect.stringContaining('YouTube API key not configured')
      );
    });

    it('should handle SQS send failures gracefully', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxx',
          enabled: true,
        },
      ];

      const mockVideos = [
        {
          snippet: {
            resourceId: { videoId: 'video-1' },
            title: 'Test Video',
            description: 'Test',
            publishedAt: '2024-01-02T00:00:00Z',
            thumbnails: { default: { url: 'https://i.ytimg.com/vi/video-1/default.jpg' } },
          },
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeChannelResponse('UCxxxxxxxxxxxxxx'),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeVideosResponse(mockVideos),
        } as Response);
      mockSQSSend.mockRejectedValue(new Error('SQS Error'));

      const event = createEvent();
      await handler(event, mockContext);

      // Should still mark as attempted (error will be logged)
      expect(mockUpdateSyncStatus).toHaveBeenCalled();
    });

    it('should continue processing other channels if one fails', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCbadchannel',
          enabled: true,
        },
        {
          id: 'channel-2',
          userId: 'user-2',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCgoodchannel',
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          statusText: 'Not Found',
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeChannelResponse('UCgoodchannel'),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeVideosResponse([]),
        } as Response);

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockUpdateSyncStatus).toHaveBeenCalledWith('channel-1', 'error', expect.any(String));
      expect(mockUpdateSyncStatus).toHaveBeenCalledWith('channel-2', 'success');
    });
  });

  describe('SQS Message Format', () => {
    it('should send correctly formatted messages to SQS', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxx',
          enabled: true,
        },
      ];

      const mockVideos = [
        {
          snippet: {
            resourceId: { videoId: 'test-video-123' },
            title: 'Test YouTube Video',
            description: 'This is a test video description',
            publishedAt: '2024-01-02T00:00:00Z',
            thumbnails: {
              default: { url: 'https://i.ytimg.com/vi/test-video-123/default.jpg' },
            },
          },
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeChannelResponse('UCxxxxxxxxxxxxxx'),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeVideosResponse(mockVideos),
        } as Response);
      mockSQSSend.mockResolvedValue({});

      const event = createEvent();
      await handler(event, mockContext);

      const sendCall = mockSQSSend.mock.calls[0][0];
      expect(sendCall.input.QueueUrl).toBe(process.env.CONTENT_PROCESSING_QUEUE_URL);

      const messageBody = JSON.parse(sendCall.input.MessageBody);
      expect(messageBody).toMatchObject({
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Test YouTube Video',
        description: 'This is a test video description',
        contentType: 'youtube',
        url: 'https://www.youtube.com/watch?v=test-video-123',
        publishDate: '2024-01-02T00:00:00Z',
        metadata: {
          videoId: 'test-video-123',
          thumbnailUrl: 'https://i.ytimg.com/vi/test-video-123/default.jpg',
        },
      });

      expect(sendCall.input.MessageAttributes).toHaveProperty('contentType');
      expect(sendCall.input.MessageAttributes?.contentType?.StringValue).toBe('youtube');
      expect(sendCall.input.MessageAttributes).toHaveProperty('channelId');
      expect(sendCall.input.MessageAttributes?.channelId?.StringValue).toBe('channel-1');
    });

    it('should include view count and like count in metadata when available', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxx',
          enabled: true,
        },
      ];

      const mockVideos = [
        {
          snippet: {
            resourceId: { videoId: 'video-with-stats' },
            title: 'Video with Stats',
            description: 'Test',
            publishedAt: '2024-01-02T00:00:00Z',
            thumbnails: { default: { url: 'https://i.ytimg.com/vi/video-with-stats/default.jpg' } },
          },
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeChannelResponse('UCxxxxxxxxxxxxxx'),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeVideosResponse(mockVideos),
        } as Response);
      mockSQSSend.mockResolvedValue({});

      const event = createEvent();
      await handler(event, mockContext);

      const sendCall = mockSQSSend.mock.calls[0][0];
      const messageBody = JSON.parse(sendCall.input.MessageBody);

      expect(messageBody.metadata).toHaveProperty('videoId');
      expect(messageBody.metadata).toHaveProperty('thumbnailUrl');
    });
  });

  describe('Pagination Tests (Sprint 4)', () => {
    it('should paginate through multiple pages (max 50 items per page)', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxx',
          enabled: true,
        },
      ];

      // Generate 80 videos across 2 pages
      const page1Videos = Array.from({ length: 50 }, (_, i) => ({
        snippet: {
          resourceId: { videoId: `video-${i + 1}` },
          title: `Video ${i + 1}`,
          description: `Description ${i + 1}`,
          publishedAt: '2024-01-02T00:00:00Z',
          thumbnails: { default: { url: `https://i.ytimg.com/vi/video-${i + 1}/default.jpg` } },
        },
      }));

      const page2Videos = Array.from({ length: 30 }, (_, i) => ({
        snippet: {
          resourceId: { videoId: `video-${i + 51}` },
          title: `Video ${i + 51}`,
          description: `Description ${i + 51}`,
          publishedAt: '2024-01-02T00:00:00Z',
          thumbnails: { default: { url: `https://i.ytimg.com/vi/video-${i + 51}/default.jpg` } },
        },
      }));

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch
        // Channel details
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeChannelResponse('UCxxxxxxxxxxxxxx'),
        } as Response)
        // Page 1 with nextPageToken
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: page1Videos,
            nextPageToken: 'page2token',
          }),
        } as Response)
        // Page 2 without nextPageToken
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: page2Videos,
          }),
        } as Response);
      mockSQSSend.mockResolvedValue({});

      const event = createEvent();
      await handler(event, mockContext);

      // Verify all 80 videos were sent to queue
      expect(mockSQSSend).toHaveBeenCalledTimes(80);

      // Verify pagination parameters
      const page1Call = (mockFetch as jest.Mock).mock.calls[1][0];
      expect(page1Call).toContain('maxResults=50');
      expect(page1Call).not.toContain('pageToken');

      const page2Call = (mockFetch as jest.Mock).mock.calls[2][0];
      expect(page2Call).toContain('maxResults=50');
      expect(page2Call).toContain('pageToken=page2token');
    });

    it('should enforce 500ms rate limit between pagination requests', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxx',
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch
        // Channel details
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeChannelResponse('UCxxxxxxxxxxxxxx'),
        } as Response)
        // Page 1
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [
              {
                snippet: {
                  resourceId: { videoId: 'video-1' },
                  title: 'Video 1',
                  description: 'Test',
                  publishedAt: '2024-01-02T00:00:00Z',
                  thumbnails: { default: { url: 'https://i.ytimg.com/vi/video-1/default.jpg' } },
                },
              },
            ],
            nextPageToken: 'page2',
          }),
        } as Response)
        // Page 2
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [
              {
                snippet: {
                  resourceId: { videoId: 'video-2' },
                  title: 'Video 2',
                  description: 'Test',
                  publishedAt: '2024-01-02T00:00:00Z',
                  thumbnails: { default: { url: 'https://i.ytimg.com/vi/video-2/default.jpg' } },
                },
              },
            ],
            nextPageToken: 'page3',
          }),
        } as Response)
        // Page 3
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [
              {
                snippet: {
                  resourceId: { videoId: 'video-3' },
                  title: 'Video 3',
                  description: 'Test',
                  publishedAt: '2024-01-02T00:00:00Z',
                  thumbnails: { default: { url: 'https://i.ytimg.com/vi/video-3/default.jpg' } },
                },
              },
            ],
          }),
        } as Response);
      mockSQSSend.mockResolvedValue({});

      const startTime = Date.now();
      const event = createEvent();
      await handler(event, mockContext);
      const duration = Date.now() - startTime;

      // With 2 pagination requests (page 2 and page 3), should take at least 1000ms (2 * 500ms)
      expect(duration).toBeGreaterThanOrEqual(900);
    });

    it('should stop pagination when reaching already-synced content', async () => {
      const lastSyncDate = new Date('2024-01-15T00:00:00Z');
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxx',
          enabled: true,
          lastSyncAt: lastSyncDate,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch
        // Channel details
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeChannelResponse('UCxxxxxxxxxxxxxx'),
        } as Response)
        // Page 1: Mix of new and old content
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [
              {
                snippet: {
                  resourceId: { videoId: 'new-video-1' },
                  title: 'New Video 1',
                  description: 'New content',
                  publishedAt: '2024-01-20T00:00:00Z', // After last sync
                  thumbnails: { default: { url: 'https://i.ytimg.com/vi/new-1/default.jpg' } },
                },
              },
              {
                snippet: {
                  resourceId: { videoId: 'new-video-2' },
                  title: 'New Video 2',
                  description: 'New content',
                  publishedAt: '2024-01-16T00:00:00Z', // After last sync
                  thumbnails: { default: { url: 'https://i.ytimg.com/vi/new-2/default.jpg' } },
                },
              },
              {
                snippet: {
                  resourceId: { videoId: 'old-video-1' },
                  title: 'Old Video 1',
                  description: 'Old content',
                  publishedAt: '2024-01-14T00:00:00Z', // Before last sync
                  thumbnails: { default: { url: 'https://i.ytimg.com/vi/old-1/default.jpg' } },
                },
              },
            ],
            nextPageToken: 'page2token', // Has next page but should stop
          }),
        } as Response);
      mockSQSSend.mockResolvedValue({});

      const event = createEvent();
      await handler(event, mockContext);

      // Should only fetch 2 pages (channel details + page 1), NOT page 2
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Should only send 2 new videos to queue (not the old one)
      expect(mockSQSSend).toHaveBeenCalledTimes(2);

      // Verify correct videos were sent
      const sentVideoIds = mockSQSSend.mock.calls.map((call: any) => {
        const body = JSON.parse(call[0].input.MessageBody);
        return body.metadata.videoId;
      });

      expect(sentVideoIds).toContain('new-video-1');
      expect(sentVideoIds).toContain('new-video-2');
      expect(sentVideoIds).not.toContain('old-video-1');
    });
  });

  describe('Playlist URL Handling (Sprint 4)', () => {
    it('should detect and handle playlist URLs correctly', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/playlist?list=PLtest123',
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              snippet: {
                resourceId: { videoId: 'playlist-video-1' },
                title: 'Playlist Video 1',
                description: 'From playlist',
                publishedAt: '2024-01-02T00:00:00Z',
                thumbnails: { default: { url: 'https://i.ytimg.com/vi/playlist-video-1/default.jpg' } },
              },
            },
          ],
        }),
      } as Response);
      mockSQSSend.mockResolvedValue({});

      const event = createEvent();
      await handler(event, mockContext);

      // Verify playlist API was called (not channel details)
      const fetchCall = (mockFetch as jest.Mock).mock.calls[0][0];
      expect(fetchCall).toContain('playlistId=PLtest123');
      expect(fetchCall).toContain('playlistItems');
      expect(fetchCall).not.toContain('channels');
    });

    it('should prioritize playlist parameter over channel ID', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UC123?list=PLtest456', // Has both
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      } as Response);

      const event = createEvent();
      await handler(event, mockContext);

      // Should prioritize playlist parameter
      const fetchCall = (mockFetch as jest.Mock).mock.calls[0][0];
      expect(fetchCall).toContain('playlistId=PLtest456');
    });

    it('should handle various playlist URL formats', async () => {
      const playlistUrls = [
        'https://www.youtube.com/playlist?list=PLtest123',
        'https://www.youtube.com/watch?v=video123&list=PLtest123',
        'https://youtube.com/playlist?list=PLtest123&feature=share',
      ];

      for (const url of playlistUrls) {
        jest.clearAllMocks();

        const mockChannels = [
          {
            id: 'channel-1',
            userId: 'user-1',
            channelType: 'youtube' as const,
            url,
            enabled: true,
          },
        ];

        mockFindActiveByType.mockResolvedValue(mockChannels);
        mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [] }),
        } as Response);

        const event = createEvent();
        await handler(event, mockContext);

        const fetchCall = (mockFetch as jest.Mock).mock.calls[0][0];
        expect(fetchCall).toContain('playlistId=PLtest123');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty video results', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxx',
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeChannelResponse('UCxxxxxxxxxxxxxx'),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [] }),
        } as Response);

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockSQSSend).not.toHaveBeenCalled();
      expect(mockUpdateSyncStatus).toHaveBeenCalledWith('channel-1', 'success');
    });

    it('should handle no active channels', async () => {
      mockFindActiveByType.mockResolvedValue([]);

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockSQSSend).not.toHaveBeenCalled();
    });

    it('should handle channel not found in YouTube API', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCnonexistent',
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      } as Response);

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockUpdateSyncStatus).toHaveBeenCalledWith(
        'channel-1',
        'error',
        'Channel not found'
      );
    });

    it('should handle videos with missing thumbnail URLs', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'youtube' as const,
          url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxx',
          enabled: true,
        },
      ];

      const mockVideos = [
        {
          snippet: {
            resourceId: { videoId: 'video-no-thumb' },
            title: 'Video without thumbnail',
            description: 'Test',
            publishedAt: '2024-01-02T00:00:00Z',
            thumbnails: {},
          },
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockSecretsSend.mockResolvedValue({ SecretString: 'test-api-key' });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeChannelResponse('UCxxxxxxxxxxxxxx'),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeVideosResponse(mockVideos),
        } as Response);
      mockSQSSend.mockResolvedValue({});

      const event = createEvent();
      await handler(event, mockContext);

      const sendCall = mockSQSSend.mock.calls[0][0];
      const messageBody = JSON.parse(sendCall.input.MessageBody);
      expect(messageBody.metadata.thumbnailUrl).toBe('');
    });
  });
});
