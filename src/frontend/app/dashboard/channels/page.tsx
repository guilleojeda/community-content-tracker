'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Channel, CreateChannelRequest } from '@shared/types';
import { channelApi } from '@/lib/api/channels';
import AddChannelForm from './AddChannelForm';
import ChannelList from './ChannelList';

export default function ChannelsPage() {
  const router = useRouter();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    // Check authentication
    const token =
      typeof window !== 'undefined'
        ? localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')
        : null;

    if (!token) {
      router.push('/auth/login');
      return;
    }

    loadChannels();
  }, [router]);

  const loadChannels = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await channelApi.listChannels();
      setChannels(response.channels);
    } catch (err) {
      setError(err instanceof Error ? err.message : /* istanbul ignore next */ 'Failed to load channels');
    } finally {
      setLoading(false);
    }
  };

  const handleAddChannel = async (data: CreateChannelRequest) => {
    try {
      setError(null);
      const newChannel = await channelApi.createChannel(data);
      setChannels([...channels, newChannel]);
      setShowAddForm(false);
      setSuccessMessage('Channel added successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : /* istanbul ignore next */ 'Failed to create channel');
    }
  };

  const handleToggleEnabled = async (channelId: string, enabled: boolean) => {
    try {
      setError(null);
      const updatedChannel = await channelApi.updateChannel(channelId, { enabled });
      setChannels(
        channels.map((c) => (c.id === channelId ? { ...c, enabled: updatedChannel.enabled } : c))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : /* istanbul ignore next */ 'Failed to update channel');
    }
  };

  const handleDeleteChannel = async (channelId: string) => {
    try {
      setError(null);
      await channelApi.deleteChannel(channelId);
      setChannels(channels.filter((c) => c.id !== channelId));
      setSuccessMessage('Channel deleted successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : /* istanbul ignore next */ 'Failed to delete channel');
    }
  };

  const handleSyncChannel = async (channelId: string) => {
    try {
      setError(null);
      const response = await channelApi.triggerSync(channelId);
      setSuccessMessage('Sync started successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
      // Optionally reload channels to get updated sync status
      await loadChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : /* istanbul ignore next */ 'Failed to trigger sync');
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <p className="text-gray-500">Loading channels...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-4">Channels</h1>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded text-red-800">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded text-green-800">
            {successMessage}
          </div>
        )}

        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Add Channel
          </button>
        )}
      </div>

      {showAddForm && (
        <div className="mb-6">
          <AddChannelForm
            onSubmit={handleAddChannel}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      <ChannelList
        channels={channels}
        onToggleEnabled={handleToggleEnabled}
        onDelete={handleDeleteChannel}
        onSync={handleSyncChannel}
      />
    </div>
  );
}
