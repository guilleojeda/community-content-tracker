import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/channels/create';
import { ChannelRepository } from '../../../../src/backend/repositories/ChannelRepository';
import { ChannelType } from '../../../../src/shared/types';

// Mock database pool
const mockPool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn(),
  on: jest.fn(),
};

// Mock pg module
jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool),
}));

// Mock ChannelRepository
jest.mock('../../../../src/backend/repositories/ChannelRepository');

// Mock fetch for URL accessibility check
global.fetch = jest.fn() as jest.Mock;

describe('Create Channel Lambda', () => {
  let mockChannelRepo: jest.Mocked<ChannelRepository>;
  let testUserId: string;
  let mockContext: Context;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool.query.mockReset();
    (fetch as jest.Mock).mockClear();

    // Mock successful fetch by default
    (fetch as jest.Mock).mockResolvedValue({
      status: 200,
      ok: true,
    } as Response);

    testUserId = 'user-123';
    mockContext = {} as Context;

    // Create mock repository instance
    mockChannelRepo = {
      create: jest.fn(),
      findByUserIdAndUrl: jest.fn(),
      findById: jest.fn(),
      findByUserId: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as any;

    // Mock the constructor to return our mocked instance
    (ChannelRepository as jest.MockedClass<typeof ChannelRepository>).mockImplementation(() => mockChannelRepo as any);
  });

  const createEvent = (body: any, userId: string = testUserId): APIGatewayProxyEvent => {
    return {
      body: JSON.stringify(body),
      requestContext: {
        authorizer: {
          userId,
        },
      },
    } as any;
  };

  it('should create a new channel successfully', async () => {
    const mockChannel = {
      id: 'channel-123',
      userId: testUserId,
      channelType: ChannelType.BLOG,
      url: 'https://example.com/feed',
      name: 'My Blog',
      enabled: true,
      syncFrequency: 'daily' as const,
      metadata: { platform: 'wordpress' },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockChannelRepo.findByUserIdAndUrl.mockResolvedValue(null);
    mockChannelRepo.create.mockResolvedValue(mockChannel);

    const event = createEvent({
      channelType: ChannelType.BLOG,
      url: 'https://example.com/feed',
      name: 'My Blog',
      syncFrequency: 'daily',
      metadata: { platform: 'wordpress' },
    });

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body.id).toBeDefined();
    expect(body.channelType).toBe(ChannelType.BLOG);
    expect(body.url).toBe('https://example.com/feed');
    expect(body.name).toBe('My Blog');
    expect(body.enabled).toBe(true);
  });

  it('should auto-detect YouTube channel type when not provided', async () => {
    const mockChannel = {
      id: 'channel-123',
      userId: testUserId,
      channelType: ChannelType.YOUTUBE,
      url: 'https://youtube.com/channel/UC123',
      enabled: true,
      syncFrequency: 'daily' as const,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockChannelRepo.findByUserIdAndUrl.mockResolvedValue(null);
    mockChannelRepo.create.mockResolvedValue(mockChannel);

    const event = createEvent({
      url: 'https://youtube.com/channel/UC123',
    });

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body.channelType).toBe(ChannelType.YOUTUBE);
  });

  it('should auto-detect blog channels when URL indicates feed', async () => {
    const mockChannel = {
      id: 'channel-blog',
      userId: testUserId,
      channelType: ChannelType.BLOG,
      url: 'https://blog.example.com/feed',
      enabled: true,
      syncFrequency: 'daily' as const,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockChannelRepo.findByUserIdAndUrl.mockResolvedValue(null);
    mockChannelRepo.create.mockResolvedValue(mockChannel);

    const event = createEvent({
      url: 'https://blog.example.com/feed',
    });

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.channelType).toBe(ChannelType.BLOG);
  });

  it('should auto-detect GitHub channels from repository URLs', async () => {
    const mockChannel = {
      id: 'channel-github',
      userId: testUserId,
      channelType: ChannelType.GITHUB,
      url: 'https://github.com/aws/aws-sdk-js',
      enabled: true,
      syncFrequency: 'daily' as const,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockChannelRepo.findByUserIdAndUrl.mockResolvedValue(null);
    mockChannelRepo.create.mockResolvedValue(mockChannel);

    const event = createEvent({
      url: 'https://github.com/aws/aws-sdk-js',
    });

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.channelType).toBe(ChannelType.GITHUB);
  });

  it('should require explicit channel type when detection fails', async () => {
    mockChannelRepo.findByUserIdAndUrl.mockResolvedValue(null);

    const response = await handler(createEvent({
      url: 'https://content.example.com/articles',
    }), mockContext);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('Could not detect channel type');
  });

  it('should return 400 for invalid channel type', async () => {
    const event = createEvent({
      channelType: 'invalid',
      url: 'https://example.com/feed',
    });

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for missing required fields', async () => {
    const event = createEvent({
      channelType: ChannelType.BLOG,
      // Missing URL
    });

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 409 for duplicate URL', async () => {
    const url = 'https://example.com/duplicate-feed';

    const existingChannel = {
      id: 'existing-channel',
      userId: testUserId,
      channelType: ChannelType.BLOG,
      url,
      enabled: true,
      syncFrequency: 'daily' as const,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockChannelRepo.findByUserIdAndUrl.mockResolvedValue(existingChannel);

    const response = await handler(createEvent({
      channelType: ChannelType.BLOG,
      url,
    }), mockContext);

    expect(response.statusCode).toBe(409);

    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('DUPLICATE_RESOURCE');
  });

  it('should return 401 when user is not authenticated', async () => {
    const event = {
      body: JSON.stringify({
        channelType: ChannelType.BLOG,
        url: 'https://example.com/feed',
      }),
      requestContext: {},
    } as any;

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(401);
  });

  it('should validate URL format', async () => {
    const event = createEvent({
      channelType: ChannelType.BLOG,
      url: 'not-a-valid-url',
    });

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should reject inaccessible URLs', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      status: 500,
      ok: false,
    } as Response);

    const response = await handler(createEvent({
      channelType: ChannelType.BLOG,
      url: 'https://example.com/feed',
    }), mockContext);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.fields.url).toContain('URL returned status 500');
  });

  it('should handle URL accessibility timeouts', async () => {
    (fetch as jest.Mock).mockRejectedValueOnce({ name: 'AbortError' });

    const response = await handler(createEvent({
      channelType: ChannelType.BLOG,
      url: 'https://slow.example.com/feed',
    }), mockContext);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error.details.fields.url).toBe('URL check timed out');
  });
});
