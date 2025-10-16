'use client';

import React, { useState } from 'react';
import { ChannelType, CreateChannelRequest } from '@shared/types';

interface AddChannelFormProps {
  onSubmit: (data: CreateChannelRequest) => Promise<void>;
  onCancel: () => void;
}

export default function AddChannelForm({ onSubmit, onCancel }: AddChannelFormProps) {
  const [channelType, setChannelType] = useState<ChannelType>(ChannelType.BLOG);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [syncFrequency, setSyncFrequency] = useState<'daily' | 'weekly' | 'manual'>('daily');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateUrl = (url: string, type: ChannelType): string | null => {
    if (!url) {
      return 'URL is required';
    }

    try {
      new URL(url);
    } catch {
      return 'Invalid URL format';
    }

    if (type === ChannelType.YOUTUBE) {
      if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
        return 'Invalid YouTube URL';
      }
    }

    if (type === ChannelType.GITHUB) {
      if (!url.includes('github.com')) {
        return 'Invalid GitHub URL';
      }
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};

    const urlError = validateUrl(url, channelType);
    if (urlError) {
      newErrors.url = urlError;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);

    try {
      await onSubmit({
        channelType,
        url,
        name: name || undefined,
        syncFrequency,
        metadata: {},
      });
    } catch (error) {
      // Error handling is done in parent component
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white p-6 rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4">Add New Channel</h2>

      <div>
        <label htmlFor="channelType" className="block text-sm font-medium text-gray-700 mb-1">
          Channel Type
        </label>
        <select
          id="channelType"
          value={channelType}
          onChange={(e) => setChannelType(e.target.value as ChannelType)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value={ChannelType.BLOG}>Blog (RSS)</option>
          <option value={ChannelType.YOUTUBE}>YouTube</option>
          <option value={ChannelType.GITHUB}>GitHub</option>
        </select>
      </div>

      <div>
        <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-1">
          URL
        </label>
        <input
          type="url"
          id="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={
            channelType === ChannelType.BLOG
              ? 'https://example.com/rss.xml'
              : channelType === ChannelType.YOUTUBE
              ? 'https://youtube.com/@channel'
              : 'https://github.com/user/repo'
          }
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {errors.url && <p className="mt-1 text-sm text-red-600">{errors.url}</p>}
      </div>

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
          Name (Optional)
        </label>
        <input
          type="text"
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Channel"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label htmlFor="syncFrequency" className="block text-sm font-medium text-gray-700 mb-1">
          Sync Frequency
        </label>
        <select
          id="syncFrequency"
          value={syncFrequency}
          onChange={(e) => setSyncFrequency(e.target.value as 'daily' | 'weekly' | 'manual')}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="manual">Manual</option>
        </select>
      </div>

      <div className="flex gap-2 pt-4">
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
