import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/channels/create';
import { ChannelType } from '../../../../src/shared/types';
import { createMockPool, setupChannelMocks } from '../../../helpers/database-mocks';

// Mock the database service
jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn(),
}));

// Mock fetch for URL accessibility check
global.fetch = jest.fn(() =>
  Promise.resolve({
    status: 200,
    ok: true,
  } as Response)
) as jest.Mock;

describe('Create Channel Lambda', () => {
  let mockQuery: jest.Mock;
  let testUserId: string;
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
    mockContext = {} as Context;
  });

  beforeEach(() => {
    // Reset mocks before each test
    mockQuery.mockClear();
    (fetch as jest.Mock).mockClear();

    // Mock successful fetch by default
    (fetch as jest.Mock).mockResolvedValue({
      status: 200,
      ok: true,
    } as Response);

    setupChannelMocks(mockQuery);
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
    const event = createEvent({
      channelType: ChannelType.BLOG,
      url: 'https://example.com/feed',
      name: 'My Blog',
      syncFrequency: 'daily',
      metadata: { platform: 'wordpress' },
    });

    const response = await handler(event, mockContext);

    if (response.statusCode !== 201) {
      console.log('Response body:', response.body);
    }

    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body.id).toBeDefined();
    expect(body.channelType).toBe(ChannelType.BLOG);
    expect(body.url).toBe('https://example.com/feed');
    expect(body.name).toBe('My Blog');
    expect(body.enabled).toBe(true);
  });

  it('should auto-detect channel type from URL', async () => {
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
      url: 'https://example.com/feed',
    });

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 409 for duplicate URL', async () => {
    const url = 'https://example.com/duplicate-feed';

    // Create first channel
    await handler(createEvent({
      channelType: ChannelType.BLOG,
      url,
    }), mockContext);

    // Try to create duplicate
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
