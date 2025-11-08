import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/channels/list';
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

describe('List Channels Lambda', () => {
  let mockChannelRepo: jest.Mocked<ChannelRepository>;
  let testUserId: string;
  let mockContext: Context;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool.query.mockReset();

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

  const createEvent = (userId: string = testUserId): APIGatewayProxyEvent => {
    return {
      requestContext: {
        authorizer: {
          userId,
        },
      },
    } as any;
  };

  it('should list all channels for authenticated user', async () => {
    const mockChannels = [
      {
        id: 'channel-1',
        userId: testUserId,
        channelType: ChannelType.BLOG,
        url: 'https://blog1.com/feed',
        name: 'Blog 1',
        enabled: true,
        syncFrequency: 'daily' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'channel-2',
        userId: testUserId,
        channelType: ChannelType.YOUTUBE,
        url: 'https://youtube.com/channel/123',
        name: 'YouTube Channel',
        enabled: true,
        syncFrequency: 'weekly' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    mockChannelRepo.findByUserId.mockResolvedValue(mockChannels);

    const event = createEvent();
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.channels).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('should return empty list when user has no channels', async () => {
    mockChannelRepo.findByUserId.mockResolvedValue([]);

    const event = createEvent();
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.channels).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('should return 401 when user is not authenticated', async () => {
    const event = {
      requestContext: {},
    } as any;

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(401);
  });

  it('should include channel metadata in response', async () => {
    const mockChannels = [
      {
        id: 'channel-1',
        userId: testUserId,
        channelType: ChannelType.BLOG,
        url: 'https://blog1.com/feed',
        name: 'Blog 1',
        enabled: true,
        syncFrequency: 'daily' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSyncAt: new Date('2024-01-02T00:00:00Z'),
        lastSyncStatus: 'success' as const,
        lastSyncError: null,
      },
    ];

    mockChannelRepo.findByUserId.mockResolvedValue(mockChannels);

    const event = createEvent();
    const response = await handler(event, mockContext);

    const body = JSON.parse(response.body);
    const channel = body.channels[0];

    expect(channel).toHaveProperty('id');
    expect(channel).toHaveProperty('channelType');
    expect(channel).toHaveProperty('url');
    expect(channel).toHaveProperty('enabled');
    expect(channel).toHaveProperty('syncFrequency');
    expect(channel).toHaveProperty('createdAt');
    expect(channel).toHaveProperty('lastSyncAt');
    expect(channel).toHaveProperty('lastSyncStatus', 'success');
  });

  it('should serialize last sync timestamps to ISO strings', async () => {
    const lastSyncDate = new Date('2024-01-03T12:34:00Z');
    mockChannelRepo.findByUserId.mockResolvedValue([
      {
        id: 'channel-2',
        userId: testUserId,
        channelType: ChannelType.YOUTUBE,
        url: 'https://youtube.com/channel/123',
        name: 'YT',
        enabled: true,
        syncFrequency: 'daily' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSyncAt: lastSyncDate,
        lastSyncStatus: 'error' as const,
        lastSyncError: 'API quota',
      },
    ]);

    const response = await handler(createEvent(), mockContext);

    expect(response.statusCode).toBe(200);
    const { channels } = JSON.parse(response.body);
    expect(channels[0].lastSyncAt).toBe(lastSyncDate.toISOString());
    expect(channels[0].lastSyncError).toBe('API quota');
  });
});
