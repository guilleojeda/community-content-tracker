import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/channels/list';
import { ChannelType } from '../../../../src/shared/types';
import { createMockPool, createMockQueryResult } from '../../../helpers/database-mocks';

// Mock the database service
jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn(),
}));

describe('List Channels Lambda', () => {
  let mockQuery: jest.Mock;
  let testUserId: string;
  let mockContext: Context;

  beforeAll(async () => {
    const { pool, mockQuery: query } = createMockPool();
    mockQuery = query;

    // Mock getDatabasePool to return our mock pool
    const { getDatabasePool } = require('../../../../src/backend/services/database');
    (getDatabasePool as jest.Mock).mockResolvedValue(pool);

    testUserId = 'user-123';
    mockContext = {} as Context;
  });

  beforeEach(() => {
    // Reset mocks before each test
    mockQuery.mockClear();

    // Default mock: return multiple channels
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT') && sql.includes('FROM channels')) {
        return Promise.resolve(createMockQueryResult([
          {
            id: 'channel-1',
            user_id: testUserId,
            channel_type: 'blog',
            url: 'https://blog1.com/feed',
            name: 'Blog 1',
            enabled: true,
            sync_frequency: 'daily',
            metadata: {},
            created_at: new Date(),
            updated_at: new Date(),
          },
          {
            id: 'channel-2',
            user_id: testUserId,
            channel_type: 'youtube',
            url: 'https://youtube.com/channel/123',
            name: 'YouTube Channel',
            enabled: true,
            sync_frequency: 'weekly',
            metadata: {},
            created_at: new Date(),
            updated_at: new Date(),
          },
        ]));
      }
      return Promise.resolve(createMockQueryResult([]));
    });
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
    const event = createEvent();
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.channels).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('should return empty list when user has no channels', async () => {
    // Mock empty result
    mockQuery.mockResolvedValue(createMockQueryResult([]));

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
  });
});
