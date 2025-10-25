import {
  Channel,
  CreateChannelRequest,
  UpdateChannelRequest,
  ChannelListResponse,
  TriggerSyncResponse,
} from '@shared/types';
import { loadAuthenticatedApiClient } from '@/lib/api/lazyClient';

export const channelApi = {
  /**
   * List all channels for the authenticated user
   */
  async listChannels(): Promise<ChannelListResponse> {
    const client = await loadAuthenticatedApiClient();
    return client.listChannels();
  },

  /**
   * Create a new channel
   */
  async createChannel(data: CreateChannelRequest): Promise<Channel> {
    const client = await loadAuthenticatedApiClient();
    return client.createChannel(data);
  },

  /**
   * Update a channel
   */
  async updateChannel(channelId: string, data: UpdateChannelRequest): Promise<Channel> {
    const client = await loadAuthenticatedApiClient();
    return client.updateChannel(channelId, data);
  },

  /**
   * Delete a channel
   */
  async deleteChannel(channelId: string): Promise<void> {
    const client = await loadAuthenticatedApiClient();
    await client.deleteChannel(channelId);
  },

  /**
   * Trigger manual sync for a channel
   */
  async triggerSync(channelId: string): Promise<TriggerSyncResponse> {
    const client = await loadAuthenticatedApiClient();
    return client.triggerChannelSync(channelId);
  },
};
