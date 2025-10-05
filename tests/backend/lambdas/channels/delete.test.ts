import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/channels/delete';
import { createMockPool, setupChannelMocks } from '../../../helpers/database-mocks';

// Mock the database service
jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn(),
}));

describe('Delete Channel Lambda', () => {
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

  const createEvent = (channelId: string, userId: string = testUserId): APIGatewayProxyEvent => {
    return {
      pathParameters: {
        id: channelId,
      },
      requestContext: {
        authorizer: {
          userId,
        },
      },
    } as any;
  };

  it('should delete channel successfully', async () => {
    const event = createEvent(testChannelId);
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.message).toBe('Channel deleted successfully');
  });

  it('should return 404 for non-existent channel', async () => {
    const event = createEvent('00000000-0000-0000-0000-000000000000');
    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('should return 403 when deleting another user channel', async () => {
    const event = createEvent(testChannelId, 'different-user-id');
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
      requestContext: {},
    } as any;

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(401);
  });
});
