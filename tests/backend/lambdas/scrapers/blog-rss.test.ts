import { ScheduledEvent, Context } from 'aws-lambda';
import { ChannelRepository } from '../../../../src/backend/repositories/ChannelRepository';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import Parser from 'rss-parser';

// Create mock functions that will be used
const mockFindActiveByType = jest.fn();
const mockUpdateSyncStatus = jest.fn();
const mockSend = jest.fn();
const mockParseURL = jest.fn();

// Mock dependencies - must be done BEFORE importing handler
jest.mock('../../../../src/backend/repositories/ChannelRepository', () => {
  return {
    ChannelRepository: jest.fn().mockImplementation(() => ({
      findActiveByType: mockFindActiveByType,
      updateSyncStatus: mockUpdateSyncStatus,
    })),
  };
});

jest.mock('@aws-sdk/client-sqs', () => {
  return {
    SQSClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    SendMessageCommand: jest.fn().mockImplementation((input) => ({ input })),
  };
});

jest.mock('rss-parser', () => {
  return jest.fn().mockImplementation(() => ({
    parseURL: mockParseURL,
  }));
});

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  })),
}));

// Import handler AFTER mocks are set up
import { handler } from '../../../../src/backend/lambdas/scrapers/blog-rss';

const mockChannelRepository = ChannelRepository as jest.MockedClass<typeof ChannelRepository>;
const mockSQSClient = SQSClient as jest.MockedClass<typeof SQSClient>;
const mockParser = Parser as jest.MockedClass<typeof Parser>;

describe('Blog RSS Scraper Lambda', () => {
  let mockContext: Context;

  beforeEach(() => {
    jest.clearAllMocks();
    mockContext = {} as Context;
    process.env.CONTENT_PROCESSING_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';
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
    it('should process blog channels and send new posts to queue', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'blog' as const,
          url: 'https://example.com/feed',
          enabled: true,
          lastSyncAt: new Date('2024-01-01'),
        },
      ];

      const mockFeedItems = [
        {
          title: 'New Blog Post',
          link: 'https://example.com/post-1',
          contentSnippet: 'This is a summary',
          isoDate: '2024-01-02T00:00:00Z',
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockParseURL.mockResolvedValue({ items: mockFeedItems });
      mockSend.mockResolvedValue({});
      mockUpdateSyncStatus.mockResolvedValue({});

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockFindActiveByType).toHaveBeenCalledWith('blog');
      expect(mockParseURL).toHaveBeenCalledWith('https://example.com/feed');
      expect(mockSend).toHaveBeenCalledWith(expect.any(SendMessageCommand));
      expect(mockUpdateSyncStatus).toHaveBeenCalledWith('channel-1', 'success');
    });

    it('should filter posts older than lastSyncAt', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'blog' as const,
          url: 'https://example.com/feed',
          enabled: true,
          lastSyncAt: new Date('2024-01-02T00:00:00Z'),
        },
      ];

      const mockFeedItems = [
        {
          title: 'Old Post',
          link: 'https://example.com/post-old',
          isoDate: '2024-01-01T00:00:00Z',
        },
        {
          title: 'New Post',
          link: 'https://example.com/post-new',
          isoDate: '2024-01-03T00:00:00Z',
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockParseURL.mockResolvedValue({ items: mockFeedItems });
      mockSend.mockResolvedValue({});

      const event = createEvent();
      await handler(event, mockContext);

      // Should only send 1 message (the new post)
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle channels with no lastSyncAt (first sync)', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'blog' as const,
          url: 'https://example.com/feed',
          enabled: true,
          lastSyncAt: undefined,
        },
      ];

      const mockFeedItems = [
        { title: 'Post 1', link: 'https://example.com/post-1' },
        { title: 'Post 2', link: 'https://example.com/post-2' },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockParseURL.mockResolvedValue({ items: mockFeedItems });
      mockSend.mockResolvedValue({});

      const event = createEvent();
      await handler(event, mockContext);

      // Should send all posts on first sync
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should skip posts without links', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'blog' as const,
          url: 'https://example.com/feed',
          enabled: true,
        },
      ];

      const mockFeedItems = [
        { title: 'Post without link' },
        { title: 'Post with link', link: 'https://example.com/post-1' },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockParseURL.mockResolvedValue({ items: mockFeedItems });
      mockSend.mockResolvedValue({});

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed RSS feeds gracefully', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'blog' as const,
          url: 'https://example.com/bad-feed',
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockParseURL.mockRejectedValue(new Error('Invalid XML'));

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockUpdateSyncStatus).toHaveBeenCalledWith(
        'channel-1',
        'error',
        expect.stringContaining('Invalid XML')
      );
    });

    it('should handle SQS send failures gracefully', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'blog' as const,
          url: 'https://example.com/feed',
          enabled: true,
        },
      ];

      const mockFeedItems = [
        { title: 'Post 1', link: 'https://example.com/post-1' },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockParseURL.mockResolvedValue({ items: mockFeedItems });
      mockSend.mockRejectedValue(new Error('SQS Error'));

      const event = createEvent();
      await handler(event, mockContext);

      // Should still mark sync as attempted
      expect(mockUpdateSyncStatus).toHaveBeenCalled();
    });

    it('should continue processing other channels if one fails', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'blog' as const,
          url: 'https://example.com/bad-feed',
          enabled: true,
        },
        {
          id: 'channel-2',
          userId: 'user-2',
          channelType: 'blog' as const,
          url: 'https://example.com/good-feed',
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockParseURL
        .mockRejectedValueOnce(new Error('Bad feed'))
        .mockResolvedValueOnce({ items: [{ title: 'Post', link: 'https://example.com/post' }] });
      mockSend.mockResolvedValue({});

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockParseURL).toHaveBeenCalledTimes(2);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('SQS Message Format', () => {
    it('should send correctly formatted messages to SQS', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'blog' as const,
          url: 'https://example.com/feed',
          enabled: true,
        },
      ];

      const mockFeedItems = [
        {
          title: 'Test Post',
          link: 'https://example.com/test-post',
          contentSnippet: 'Test description',
          isoDate: '2024-01-01T00:00:00Z',
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockParseURL.mockResolvedValue({ items: mockFeedItems });
      mockSend.mockResolvedValue({});

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockSend).toHaveBeenCalled();
      const sendCall = mockSend.mock.calls[0][0];
      expect(sendCall).toBeDefined();

      // SendMessageCommand wraps input, so sendCall IS the command with .input property
      const messageInput = sendCall.input || sendCall;
      expect(messageInput.QueueUrl).toBe(process.env.CONTENT_PROCESSING_QUEUE_URL);

      const messageBody = JSON.parse(messageInput.MessageBody);
      expect(messageBody).toMatchObject({
        userId: 'user-1',
        channelId: 'channel-1',
        title: 'Test Post',
        description: 'Test description',
        contentType: 'blog',
        url: 'https://example.com/test-post',
        publishDate: '2024-01-01T00:00:00Z',
      });

      expect(messageInput.MessageAttributes).toHaveProperty('contentType');
      expect(messageInput.MessageAttributes?.contentType?.StringValue).toBe('blog');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty feed items array', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'blog' as const,
          url: 'https://example.com/feed',
          enabled: true,
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockParseURL.mockResolvedValue({ items: [] });

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockSend).not.toHaveBeenCalled();
      expect(mockUpdateSyncStatus).toHaveBeenCalledWith('channel-1', 'success');
    });

    it('should handle no active channels', async () => {
      mockFindActiveByType.mockResolvedValue([]);

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockParseURL).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should handle posts with only pubDate (no isoDate)', async () => {
      const mockChannels = [
        {
          id: 'channel-1',
          userId: 'user-1',
          channelType: 'blog' as const,
          url: 'https://example.com/feed',
          enabled: true,
          lastSyncAt: new Date('2024-01-01'),
        },
      ];

      const mockFeedItems = [
        {
          title: 'Post with pubDate',
          link: 'https://example.com/post',
          pubDate: '2024-01-02T00:00:00Z',
        },
      ];

      mockFindActiveByType.mockResolvedValue(mockChannels);
      mockParseURL.mockResolvedValue({ items: mockFeedItems });
      mockSend.mockResolvedValue({});

      const event = createEvent();
      await handler(event, mockContext);

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});
