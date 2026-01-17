import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { Pool } from 'pg';
import { ChannelRepository } from '../../../../src/backend/repositories/ChannelRepository';
import { ChannelType } from '../../../../src/shared/types';
import { handler as createHandler } from '../../../../src/backend/lambdas/channels/create';
import { handler as listHandler } from '../../../../src/backend/lambdas/channels/list';
import { handler as updateHandler } from '../../../../src/backend/lambdas/channels/update';
import { handler as deleteHandler } from '../../../../src/backend/lambdas/channels/delete';
import {
  setupTestDatabase,
  teardownTestDatabase,
  resetTestData,
  createTestUser,
} from '../../repositories/test-setup';
import * as database from '../../../../src/backend/services/database';
import { LambdaClient } from '@aws-sdk/client-lambda';

jest.mock('@aws-sdk/client-lambda');

describe('Channel Lambdas (integration)', () => {
  let pool: Pool;
  let channelRepository: ChannelRepository;
  let userId: string;
  let syncHandler: (
    event: APIGatewayProxyEvent,
    context: Context
  ) => Promise<{ statusCode: number; body: string }>;
  let mockSend: jest.Mock;

  const createContext = (): Context =>
    ({
      callbackWaitsForEmptyEventLoop: false,
      functionName: 'channels',
      functionVersion: '1',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:channels',
      memoryLimitInMB: '256',
      awsRequestId: 'channels-test',
      logGroupName: '/aws/lambda/channels',
      logStreamName: 'test',
      getRemainingTimeInMillis: () => 30000,
      done: () => {},
      fail: () => {},
      succeed: () => {},
    } as Context);

  const createEvent = (
    method: string,
    path: string,
    user: string,
    body?: Record<string, unknown>,
    pathParameters?: Record<string, string>
  ): APIGatewayProxyEvent =>
    ({
      httpMethod: method,
      path,
      pathParameters: pathParameters ?? null,
      body: body ? JSON.stringify(body) : null,
      headers: { 'Content-Type': 'application/json' },
      multiValueHeaders: {},
      isBase64Encoded: false,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {
        requestId: 'channels-request',
        authorizer: {
          userId: user,
          claims: {
            sub: user,
          },
        },
        identity: {
          sourceIp: '127.0.0.1',
          userAgent: 'integration-test',
        },
      },
      resource: path,
    } as APIGatewayProxyEvent);

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;

    process.env.DATABASE_URL = setup.connectionString;
    process.env.SKIP_URL_ACCESSIBILITY_CHECK = 'true';
    process.env.BLOG_SCRAPER_FUNCTION_NAME = 'blog-scraper';
    process.env.YOUTUBE_SCRAPER_FUNCTION_NAME = 'youtube-scraper';
    process.env.GITHUB_SCRAPER_FUNCTION_NAME = 'github-scraper';

    database.resetDatabaseCache();
    database.setTestDatabasePool(pool);

    channelRepository = new ChannelRepository(pool);

    const mockLambdaClient = LambdaClient as jest.MockedClass<typeof LambdaClient>;
    mockSend = jest.fn();
    mockLambdaClient.prototype.send = mockSend;

    const syncModule = await import('../../../../src/backend/lambdas/channels/sync');
    syncHandler = syncModule.handler;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();
    const user = await createTestUser(pool, {
      username: 'channel-owner',
      isAdmin: false,
    });
    userId = user.id;
    mockSend.mockReset();
  });

  it('creates and lists channels', async () => {
    const createResponse = await createHandler(
      createEvent('POST', '/channels', userId, {
        url: 'https://example.com/feed.xml',
        name: 'Example Blog',
        channelType: ChannelType.BLOG,
        syncFrequency: 'daily',
        metadata: { platform: 'rss' },
      }),
      createContext()
    );

    expect(createResponse.statusCode).toBe(201);
    const createdBody = JSON.parse(createResponse.body);
    expect(createdBody.url).toBe('https://example.com/feed.xml');
    expect(createdBody.channelType).toBe(ChannelType.BLOG);

    const listResponse = await listHandler(
      createEvent('GET', '/channels', userId),
      createContext()
    );

    expect(listResponse.statusCode).toBe(200);
    const listBody = JSON.parse(listResponse.body);
    expect(listBody.total).toBe(1);
    expect(listBody.channels).toHaveLength(1);
    expect(listBody.channels[0].url).toBe('https://example.com/feed.xml');
  });

  it('updates channel attributes', async () => {
    const channel = await channelRepository.create({
      userId,
      channelType: ChannelType.BLOG,
      url: 'https://example.com/blog',
      name: 'Original Blog',
      syncFrequency: 'daily',
      metadata: {},
    });

    const updateResponse = await updateHandler(
      createEvent(
        'PUT',
        `/channels/${channel.id}`,
        userId,
        { name: 'Updated Blog', syncFrequency: 'weekly' },
        { id: channel.id }
      ),
      createContext()
    );

    expect(updateResponse.statusCode).toBe(200);
    const updatedBody = JSON.parse(updateResponse.body);
    expect(updatedBody.name).toBe('Updated Blog');
    expect(updatedBody.syncFrequency).toBe('weekly');

    const refreshed = await channelRepository.findById(channel.id);
    expect(refreshed?.name).toBe('Updated Blog');
    expect(refreshed?.syncFrequency).toBe('weekly');
  });

  it('deletes channels', async () => {
    const channel = await channelRepository.create({
      userId,
      channelType: ChannelType.GITHUB,
      url: 'https://github.com/aws',
      name: 'AWS GitHub',
      syncFrequency: 'manual',
      metadata: {},
    });

    const deleteResponse = await deleteHandler(
      createEvent('DELETE', `/channels/${channel.id}`, userId, undefined, { id: channel.id }),
      createContext()
    );

    expect(deleteResponse.statusCode).toBe(200);
    const deleteBody = JSON.parse(deleteResponse.body);
    expect(deleteBody.message).toBe('Channel deleted successfully');

    const remaining = await channelRepository.findById(channel.id);
    expect(remaining).toBeNull();
  });

  it('triggers manual channel sync', async () => {
    const channel = await channelRepository.create({
      userId,
      channelType: ChannelType.BLOG,
      url: 'https://example.com/sync',
      name: 'Sync Blog',
      syncFrequency: 'manual',
      metadata: {},
    });

    mockSend.mockResolvedValue({ StatusCode: 202 });

    const syncResponse = await syncHandler(
      createEvent('POST', `/channels/${channel.id}/sync`, userId, undefined, {
        id: channel.id,
      }),
      createContext()
    );

    expect(syncResponse.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
