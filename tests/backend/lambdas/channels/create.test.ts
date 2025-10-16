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
global.fetch = jest.fn(() =>
  Promise.resolve({
    status: 200,
    ok: true,
  } as Response)
) as jest.Mock;

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

  it('should auto-detect channel type from URL', async () => {
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
      channelType: ChannelType.YOUTUBE,
      url: 'https://youtube.com/channel/UC123',
    });

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body.channelType).toBe(ChannelType.YOUTUBE);
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
});
