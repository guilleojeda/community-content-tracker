import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/channels/update';
import { createMockPool, setupChannelMocks } from '../../../helpers/database-mocks';

// Mock the database service
jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn(),
}));

describe('Update Channel Lambda', () => {
  let mockQuery: jest.Mock;
  let testUserId: string;
  let testChannelId: string;
  let mockContext: Context;

  beforeAll(async () => {
    const { pool, mockQuery: query } = createMockPool();
    mockQuery = query;

    // Mock getDatabasePool to return our mock pool
    const { getDatabasePool } = require('../../../../src/backend/services/database');
    (getDatabasePool as jest.Mock).mockResolvedValue(pool);

    // Setup channel mocks
    setupChannelMocks(mockQuery);

    testUserId = 'user-123';
    testChannelId = 'channel-123';
    mockContext = {} as Context;
  });

  beforeEach(() => {
    // Reset mocks before each test
    mockQuery.mockClear();
    setupChannelMocks(mockQuery);
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
    const event = createEvent(testChannelId, { name: 'New Name' });
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.name).toBe('New Name');
  });

  it('should update channel enabled status', async () => {
    const event = createEvent(testChannelId, { enabled: false });
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.enabled).toBe(false);
  });

  it('should update sync frequency', async () => {
    const event = createEvent(testChannelId, { syncFrequency: 'weekly' });
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.syncFrequency).toBe('weekly');
  });

  it('should update metadata', async () => {
    const event = createEvent(testChannelId, {
      metadata: { platform: 'medium', customField: 'value' },
    });
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.metadata).toEqual({ platform: 'medium', customField: 'value' });
  });

  it('should return 404 for non-existent channel', async () => {
    const event = createEvent('00000000-0000-0000-0000-000000000000', { name: 'Test' });
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('should return 403 when updating another user channel', async () => {
    const event = createEvent(testChannelId, { name: 'Test' }, 'different-user-id');
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
    const event = createEvent(testChannelId, { syncFrequency: 'invalid' });
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
