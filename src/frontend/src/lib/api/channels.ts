import {
  Channel,
  CreateChannelRequest,
  UpdateChannelRequest,
  ChannelListResponse,
  TriggerSyncResponse,
} from '@shared/types';
import { getAuthenticatedApiClient } from '@/api/client';

const getClient = () => getAuthenticatedApiClient();

export const channelApi = {
  /**
   * List all channels for the authenticated user
   */
  async listChannels(): Promise<ChannelListResponse> {
    return getClient().listChannels();
  },

  /**
   * Create a new channel
   */
  async createChannel(data: CreateChannelRequest): Promise<Channel> {
    return getClient().createChannel(data);
  },

  /**
   * Update a channel
   */
  async updateChannel(channelId: string, data: UpdateChannelRequest): Promise<Channel> {
    return getClient().updateChannel(channelId, data);
  },

  /**
   * Delete a channel
   */
  async deleteChannel(channelId: string): Promise<void> {
    await getClient().deleteChannel(channelId);
  },

  /**
   * Trigger manual sync for a channel
   */
  async triggerSync(channelId: string): Promise<TriggerSyncResponse> {
    return getClient().triggerChannelSync(channelId);
  },
};
