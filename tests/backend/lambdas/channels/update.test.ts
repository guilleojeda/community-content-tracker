import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/channels/update';
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

describe('Update Channel Lambda', () => {
  let mockChannelRepo: jest.Mocked<ChannelRepository>;
  let testUserId: string;
  let testChannelId: string;
  let mockContext: Context;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool.query.mockReset();

    testUserId = 'user-123';
    testChannelId = 'channel-123';
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

  const createEvent = (channelId: string, body: any, userId: string = testUserId): APIGatewayProxyEvent => {
    return {
      pathParameters: {
        id: channelId,
      },
      body: JSON.stringify(body),
      requestContext: {
        authorizer: {
          userId,
        },
      },
    } as any;
  };

  it('should update channel name', async () => {
    const existingChannel = {
      id: testChannelId,
      userId: testUserId,
      channelType: ChannelType.BLOG,
      url: 'https://example.com/feed',
      name: 'Old Name',
      enabled: true,
      syncFrequency: 'daily' as const,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedChannel = {
      ...existingChannel,
      name: 'New Name',
      updatedAt: new Date(),
    };

    mockChannelRepo.findById.mockResolvedValue(existingChannel);
    mockChannelRepo.update.mockResolvedValue(updatedChannel);

    const event = createEvent(testChannelId, { name: 'New Name' });
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.channel.name).toBe('New Name');
  });

  it('should update channel enabled status', async () => {
    const existingChannel = {
      id: testChannelId,
      userId: testUserId,
      channelType: ChannelType.BLOG,
      url: 'https://example.com/feed',
      enabled: true,
      syncFrequency: 'daily' as const,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedChannel = {
      ...existingChannel,
      enabled: false,
      updatedAt: new Date(),
    };

    mockChannelRepo.findById.mockResolvedValue(existingChannel);
    mockChannelRepo.update.mockResolvedValue(updatedChannel);

    const event = createEvent(testChannelId, { enabled: false });
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.channel.enabled).toBe(false);
  });

  it('should update sync frequency', async () => {
    const existingChannel = {
      id: testChannelId,
      userId: testUserId,
      channelType: ChannelType.BLOG,
      url: 'https://example.com/feed',
      enabled: true,
      syncFrequency: 'daily' as const,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedChannel = {
      ...existingChannel,
      syncFrequency: 'weekly' as const,
      updatedAt: new Date(),
    };

    mockChannelRepo.findById.mockResolvedValue(existingChannel);
    mockChannelRepo.update.mockResolvedValue(updatedChannel);

    const event = createEvent(testChannelId, { syncFrequency: 'weekly' });
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.channel.syncFrequency).toBe('weekly');
  });

  it('should update metadata', async () => {
    const existingChannel = {
      id: testChannelId,
      userId: testUserId,
      channelType: ChannelType.BLOG,
      url: 'https://example.com/feed',
      enabled: true,
      syncFrequency: 'daily' as const,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedChannel = {
      ...existingChannel,
      metadata: { platform: 'medium', customField: 'value' },
      updatedAt: new Date(),
    };

    mockChannelRepo.findById.mockResolvedValue(existingChannel);
    mockChannelRepo.update.mockResolvedValue(updatedChannel);

    const event = createEvent(testChannelId, {
      metadata: { platform: 'medium', customField: 'value' },
    });
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.channel.metadata).toEqual({ platform: 'medium', customField: 'value' });
  });

  it('should return 404 for non-existent channel', async () => {
    mockChannelRepo.findById.mockResolvedValue(null);

    const event = createEvent('00000000-0000-0000-0000-000000000000', { name: 'Test' });
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('should return 403 when updating another user channel', async () => {
    const existingChannel = {
      id: testChannelId,
      userId: 'different-user-id',
      channelType: ChannelType.BLOG,
      url: 'https://example.com/feed',
      enabled: true,
      syncFrequency: 'daily' as const,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockChannelRepo.findById.mockResolvedValue(existingChannel);

    const event = createEvent(testChannelId, { name: 'Test' }, testUserId);
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(403);

    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('PERMISSION_DENIED');
  });

  it('should return 401 when user is not authenticated', async () => {
    const event = {
      pathParameters: {
        id: testChannelId,
      },
      body: JSON.stringify({ name: 'Test' }),
      requestContext: {},
    } as any;

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(401);
  });

  it('should return 400 for invalid sync frequency', async () => {
    const existingChannel = {
      id: testChannelId,
      userId: testUserId,
      channelType: ChannelType.BLOG,
      url: 'https://example.com/feed',
      enabled: true,
      syncFrequency: 'daily' as const,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockChannelRepo.findById.mockResolvedValue(existingChannel);

    const event = createEvent(testChannelId, { syncFrequency: 'invalid' });
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
