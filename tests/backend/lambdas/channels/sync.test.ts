import { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Set environment variables BEFORE importing handler (handler reads them at module load time)
process.env.BLOG_SCRAPER_FUNCTION_NAME = 'blog-scraper';
process.env.YOUTUBE_SCRAPER_FUNCTION_NAME = 'youtube-scraper';
process.env.GITHUB_SCRAPER_FUNCTION_NAME = 'github-scraper';

import { handler } from '../../../../src/backend/lambdas/channels/sync';
import { ChannelRepository } from '../../../../src/backend/repositories/ChannelRepository';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

// Mock dependencies
jest.mock('../../../../src/backend/repositories/ChannelRepository');
jest.mock('@aws-sdk/client-lambda');
jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  })),
}));

// Mock database service
jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn().mockResolvedValue({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  }),
  closeDatabasePool: jest.fn().mockResolvedValue(undefined),
}));

const mockChannelRepository = ChannelRepository as jest.MockedClass<typeof ChannelRepository>;
const mockLambdaClient = LambdaClient as jest.MockedClass<typeof LambdaClient>;

describe('Channel Sync Lambda', () => {
  let mockContext: Context;
  let mockFindById: jest.Mock;
  let mockSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {} as Context;
    mockFindById = jest.fn();
    mockSend = jest.fn();

    mockChannelRepository.prototype.findById = mockFindById;
    mockLambdaClient.prototype.send = mockSend;
  });

  const createEvent = (channelId: string, userId: string): APIGatewayProxyEvent => ({
    httpMethod: 'POST',
    path: `/channels/${channelId}/sync`,
    pathParameters: { id: channelId },
    requestContext: {
      authorizer: {
        claims: {
          sub: userId,
        },
      },
    } as any,
    body: null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '',
  });

  describe('Success Cases', () => {
    it('should trigger blog scraper sync successfully', async () => {
      const userId = 'user-123';
      const channelId = 'channel-456';

      mockFindById.mockResolvedValue({
        id: channelId,
        userId,
        channelType: 'blog',
        url: 'https://example.com/feed',
        enabled: true,
      });

      mockSend.mockResolvedValue({ StatusCode: 202 });

      const event = createEvent(channelId, userId);
      const result = await handler(event, mockContext);

      if (result.statusCode !== 200) {
        console.log('Error response:', result.body);
      }
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('sync triggered');
      expect(body.channelId).toBe(channelId);
      expect(mockSend).toHaveBeenCalledWith(expect.any(InvokeCommand));
    });

    it('should trigger YouTube scraper sync successfully', async () => {
      const userId = 'user-123';
      const channelId = 'channel-789';

      mockFindById.mockResolvedValue({
        id: channelId,
        userId,
        channelType: 'youtube',
        url: 'https://youtube.com/@example',
        enabled: true,
      });

      mockSend.mockResolvedValue({ StatusCode: 202 });

      const event = createEvent(channelId, userId);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('sync triggered');
    });

    it('should trigger GitHub scraper sync successfully', async () => {
      const userId = 'user-123';
      const channelId = 'channel-abc';

      mockFindById.mockResolvedValue({
        id: channelId,
        userId,
        channelType: 'github',
        url: 'https://github.com/org/repo',
        enabled: true,
      });

      mockSend.mockResolvedValue({ StatusCode: 202 });

      const event = createEvent(channelId, userId);
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
    });
  });

  describe('Error Cases', () => {
    it('should return 404 if channel not found', async () => {
      mockFindById.mockResolvedValue(null);

      const event = createEvent('nonexistent', 'user-123');
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 403 if user does not own channel', async () => {
      mockFindById.mockResolvedValue({
        id: 'channel-456',
        userId: 'other-user',
        channelType: 'blog',
        url: 'https://example.com/feed',
        enabled: true,
      });

      const event = createEvent('channel-456', 'user-123');
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
    });

    it('should return 400 if channel is disabled', async () => {
      mockFindById.mockResolvedValue({
        id: 'channel-456',
        userId: 'user-123',
        channelType: 'blog',
        url: 'https://example.com/feed',
        enabled: false,
      });

      const event = createEvent('channel-456', 'user-123');
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 500 if Lambda invocation fails', async () => {
      mockFindById.mockResolvedValue({
        id: 'channel-456',
        userId: 'user-123',
        channelType: 'blog',
        url: 'https://example.com/feed',
        enabled: true,
      });

      mockSend.mockRejectedValue(new Error('Lambda error'));

      const event = createEvent('channel-456', 'user-123');
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should return 400 if missing channelId path parameter', async () => {
      const event = createEvent('', 'user-123');
      event.pathParameters = null;

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
