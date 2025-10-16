'use client';

import React, { useState } from 'react';
import { Channel } from '@shared/types';

interface ChannelListProps {
  channels: Channel[];
  onToggleEnabled: (channelId: string, enabled: boolean) => Promise<void>;
  onDelete: (channelId: string) => Promise<void>;
  onSync: (channelId: string) => Promise<void>;
}

export default function ChannelList({
  channels,
  onToggleEnabled,
  onDelete,
  onSync,
}: ChannelListProps) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return 'Never synced';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString();
  };

  const handleToggle = async (channelId: string, currentEnabled: boolean) => {
    await onToggleEnabled(channelId, !currentEnabled);
  };

  const handleDeleteClick = (channelId: string) => {
    setDeleteConfirmId(channelId);
  };

  const handleDeleteConfirm = async () => {
    if (deleteConfirmId) {
      await onDelete(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmId(null);
  };

  const handleSync = async (channelId: string) => {
    setSyncingId(channelId);
    try {
      await onSync(channelId);
    } finally {
      setSyncingId(null);
    }
  };

  const getStatusBadge = (channel: Channel) => {
    if (!channel.lastSyncStatus) {
      return <span className="px-2 py-1 text-xs rounded bg-gray-200 text-gray-700">Never synced</span>;
    }

    if (channel.lastSyncStatus === 'success') {
      return <span className="px-2 py-1 text-xs rounded bg-green-200 text-green-800">Success</span>;
    }

    return <span className="px-2 py-1 text-xs rounded bg-red-200 text-red-800">Error</span>;
  };

  const getVerificationBadge = (channel: Channel) => {
    const verified = channel.metadata?.verified;

    if (verified === true) {
      return <span className="px-2 py-1 text-xs rounded bg-blue-200 text-blue-800">Verified</span>;
    }

    if (verified === false) {
      return <span className="px-2 py-1 text-xs rounded bg-yellow-200 text-yellow-800">Verification pending</span>;
    }

    return null;
  };

  if (channels.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-lg shadow">
        <p className="text-gray-500 text-lg">No channels yet</p>
        <p className="text-gray-400 text-sm mt-2">Click Add Channel to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {channels.map((channel) => (
        <div key={channel.id} className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between items-start mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-lg font-semibold">
                  {channel.name || channel.url}
                </h3>
                <span className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700">
                  {channel.channelType}
                </span>
                {getVerificationBadge(channel)}
              </div>
              {channel.name && (
                <p className="text-sm text-gray-600">{channel.url}</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={channel.enabled}
                  onChange={() => handleToggle(channel.id, channel.enabled)}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700">Enabled</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
            <div>
              <p className="text-gray-500">Sync Frequency</p>
              <p className="font-medium capitalize">{channel.syncFrequency}</p>
            </div>
            <div>
              <p className="text-gray-500">Last Sync Status</p>
              <div className="mt-1">{getStatusBadge(channel)}</div>
            </div>
          </div>

          {channel.lastSyncAt && (
            <div className="text-sm text-gray-600 mb-4">
              <p>Last synced: {formatDate(channel.lastSyncAt)}</p>
            </div>
          )}

          {channel.lastSyncError && (
            <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
              <p className="text-sm text-red-800">{channel.lastSyncError}</p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => handleSync(channel.id)}
              disabled={syncingId === channel.id}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {syncingId === channel.id ? 'Syncing...' : 'Sync'}
            </button>
            <button
              onClick={() => handleDeleteClick(channel.id)}
              className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-md">
            <h3 className="text-lg font-semibold mb-4">Confirm Delete</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this channel? This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Confirm
              </button>
              <button
                onClick={handleDeleteCancel}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
