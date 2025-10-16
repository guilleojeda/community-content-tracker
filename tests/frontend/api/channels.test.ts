import { channelApi } from '@/lib/api/channels';
import type { Channel, CreateChannelRequest, UpdateChannelRequest, ChannelListResponse } from '@shared/types';
import { ChannelType } from '@shared/types';

jest.mock('@/api/client', () => ({
  getAuthenticatedApiClient: jest.fn(),
}));

describe('channelApi', () => {
  const mockClient = {
    listChannels: jest.fn<Promise<ChannelListResponse>, []>(),
    createChannel: jest.fn<Promise<Channel>, [CreateChannelRequest]>(),
    updateChannel: jest.fn<Promise<Channel>, [string, UpdateChannelRequest]>(),
    deleteChannel: jest.fn<Promise<void>, [string]>(),
    triggerChannelSync: jest.fn<Promise<{ message: string; syncJobId: string }>, [string]>(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    const { getAuthenticatedApiClient } = require('@/api/client');
    (getAuthenticatedApiClient as jest.Mock).mockReturnValue(mockClient);
  });

  it('delegates listChannels to the authenticated API client', async () => {
    const response = { channels: [], total: 0 };
    mockClient.listChannels.mockResolvedValue(response);

    const result = await channelApi.listChannels();

    expect(result).toBe(response);
    expect(mockClient.listChannels).toHaveBeenCalledWith();
  });

  it('delegates createChannel to the authenticated API client', async () => {
    const request: CreateChannelRequest = {
      channelType: ChannelType.BLOG,
      url: 'https://example.com/rss',
    };
    const channel = {
      id: '1',
      ...request,
      userId: 'u1',
      enabled: true,
      metadata: {},
      syncFrequency: 'manual',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Channel;
    mockClient.createChannel.mockResolvedValue(channel);

    const result = await channelApi.createChannel(request);

    expect(result).toBe(channel);
    expect(mockClient.createChannel).toHaveBeenCalledWith(request);
  });

  it('delegates updateChannel to the authenticated API client', async () => {
    const updatePayload: UpdateChannelRequest = { enabled: false };
    const channel = {
      id: '1',
      userId: 'u1',
      channelType: ChannelType.BLOG,
      url: 'a',
      enabled: false,
      metadata: {},
      syncFrequency: 'manual',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Channel;
    mockClient.updateChannel.mockResolvedValue(channel);

    const result = await channelApi.updateChannel('channel-123', updatePayload);

    expect(result).toBe(channel);
    expect(mockClient.updateChannel).toHaveBeenCalledWith('channel-123', updatePayload);
  });

  it('delegates deleteChannel to the authenticated API client', async () => {
    mockClient.deleteChannel.mockResolvedValue();

    await channelApi.deleteChannel('channel-123');

    expect(mockClient.deleteChannel).toHaveBeenCalledWith('channel-123');
  });

  it('delegates triggerSync to the authenticated API client', async () => {
    const response = { message: 'queued', syncJobId: 'job-1' };
    mockClient.triggerChannelSync.mockResolvedValue(response);

    const result = await channelApi.triggerSync('channel-123');

    expect(result).toBe(response);
    expect(mockClient.triggerChannelSync).toHaveBeenCalledWith('channel-123');
  });
});
