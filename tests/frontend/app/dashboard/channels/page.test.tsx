import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import ChannelsPage from '@/app/dashboard/channels/page';
import type { Channel } from '@shared/types';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@/lib/api/channels', () => ({
  channelApi: {
    listChannels: jest.fn(),
    createChannel: jest.fn(),
    updateChannel: jest.fn(),
    deleteChannel: jest.fn(),
    triggerSync: jest.fn(),
  },
}));

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'sessionStorage', { value: localStorageMock });

const { channelApi: mockChannelApi } = require('@/lib/api/channels');

const defaultChannels: Channel[] = [
  {
    id: 'channel-1',
    userId: 'user-1',
    channelType: 'blog',
    url: 'https://example.com/blog/rss',
    name: 'My Blog',
    enabled: true,
    lastSyncAt: new Date('2024-01-15T10:30:00Z'),
    lastSyncStatus: 'success',
    syncFrequency: 'daily',
    metadata: {},
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-15T10:30:00Z'),
  },
  {
    id: 'channel-2',
    userId: 'user-1',
    channelType: 'youtube',
    url: 'https://youtube.com/@example',
    name: 'My Channel',
    enabled: false,
    lastSyncAt: new Date('2024-01-10T08:00:00Z'),
    lastSyncStatus: 'error',
    lastSyncError: 'Invalid API key',
    syncFrequency: 'weekly',
    metadata: {},
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-10T08:00:00Z'),
  },
];

describe('ChannelsPage', () => {
  const mockPush = jest.fn();
  const mockRouter = { push: mockPush };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    localStorageMock.clear();
    localStorageMock.setItem('accessToken', 'mock-token');
    mockChannelApi.listChannels.mockResolvedValue({ channels: defaultChannels, total: 2 });
  });

  describe('initial load', () => {
    it('renders channel list heading and button', async () => {
      render(<ChannelsPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /channels/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /add channel/i })).toBeInTheDocument();
        expect(mockChannelApi.listChannels).toHaveBeenCalled();
      });
    });

    it('shows empty state when no channels exist', async () => {
      mockChannelApi.listChannels.mockResolvedValueOnce({ channels: [], total: 0 });

      render(<ChannelsPage />);

      await waitFor(() => {
        expect(screen.getByText(/no channels yet/i)).toBeInTheDocument();
        expect(screen.getByText(/add channel to get started/i)).toBeInTheDocument();
      });
    });
  });

  describe('authentication guard', () => {
    it('redirects to login when missing token', async () => {
      localStorageMock.clear();

      render(<ChannelsPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/auth/login');
      });
    });
  });

  describe('channel lifecycle', () => {
    it('creates channel through form submission', async () => {
      mockChannelApi.createChannel.mockResolvedValue({
        ...defaultChannels[0],
        id: 'channel-3',
        url: 'https://github.com/user/repo',
        channelType: 'github',
      });

      render(<ChannelsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add channel/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /add channel/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /add new channel/i })).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'https://github.com/user/repo' } });
      fireEvent.change(screen.getByLabelText(/channel type/i), { target: { value: 'github' } });
      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockChannelApi.createChannel).toHaveBeenCalledWith(
          expect.objectContaining({
            url: 'https://github.com/user/repo',
            channelType: 'github',
          }),
        );
        expect(screen.getByText(/channel added successfully/i)).toBeInTheDocument();
      });
    });

    it('allows cancelling the add channel form', async () => {
      render(<ChannelsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add channel/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /add channel/i }));
      await waitFor(() => expect(screen.getByRole('heading', { name: /add new channel/i })).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /add new channel/i })).not.toBeInTheDocument();
      });
    });

    it('toggles channel enabled state', async () => {
      mockChannelApi.updateChannel.mockResolvedValue({
        ...defaultChannels[0],
        enabled: false,
      });

      render(<ChannelsPage />);

      await waitFor(() => {
        expect(screen.getByText('My Blog')).toBeInTheDocument();
      });

      const toggle = screen.getAllByRole('checkbox')[0];
      fireEvent.click(toggle);

      await waitFor(() => {
        expect(mockChannelApi.updateChannel).toHaveBeenCalledWith('channel-1', { enabled: false });
      });
    });

    it('deletes channel', async () => {
      mockChannelApi.deleteChannel.mockResolvedValue();

      render(<ChannelsPage />);

      await waitFor(() => {
        expect(screen.getByText('My Blog')).toBeInTheDocument();
      });

      fireEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

      await waitFor(() => {
        expect(mockChannelApi.deleteChannel).toHaveBeenCalledWith('channel-1');
        expect(screen.getByText(/channel deleted successfully/i)).toBeInTheDocument();
      });
    });

    it('renders verification badges for verified channels', async () => {
      mockChannelApi.listChannels.mockResolvedValueOnce({
        channels: [
          {
            ...defaultChannels[0],
            metadata: { verified: true },
          },
        ],
        total: 1,
      });

      render(<ChannelsPage />);

      await waitFor(() => {
        expect(screen.getByText(/verified/i)).toBeInTheDocument();
      });
    });

    it('renders verification pending badge when metadata indicates review', async () => {
      mockChannelApi.listChannels.mockResolvedValueOnce({
        channels: [
          {
            ...defaultChannels[0],
            metadata: { verified: false },
          },
        ],
        total: 1,
      });

      render(<ChannelsPage />);

      await waitFor(() => {
        expect(screen.getByText(/verification pending/i)).toBeInTheDocument();
      });
    });

    it('triggers manual sync', async () => {
      mockChannelApi.triggerSync.mockResolvedValue({ message: 'queued', syncJobId: 'job-1' });
      mockChannelApi.listChannels.mockResolvedValueOnce({ channels: defaultChannels, total: 2 });
      mockChannelApi.listChannels.mockResolvedValueOnce({ channels: defaultChannels, total: 2 });

      render(<ChannelsPage />);

      await waitFor(() => {
        expect(screen.getByText('My Blog')).toBeInTheDocument();
      });

      fireEvent.click(screen.getAllByRole('button', { name: /sync/i })[0]);

      await waitFor(() => {
        expect(mockChannelApi.triggerSync).toHaveBeenCalledWith('channel-1');
        expect(screen.getByText(/sync started successfully/i)).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('displays list load errors', async () => {
      mockChannelApi.listChannels.mockRejectedValueOnce(new Error('Failed to load channels'));

      render(<ChannelsPage />);

      await waitFor(() => {
        expect(screen.getByText(/failed to load channels/i)).toBeInTheDocument();
      });
    });

    it('displays create errors', async () => {
      mockChannelApi.createChannel.mockRejectedValue(new Error('Failed to create channel'));

      render(<ChannelsPage />);

      await waitFor(() => {
        fireEvent.click(screen.getByRole('button', { name: /add channel/i }));
      });

      fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'https://example.com/rss' } });
      fireEvent.change(screen.getByLabelText(/channel type/i), { target: { value: 'blog' } });
      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(screen.getByText(/failed to create channel/i)).toBeInTheDocument();
      });
    });

    it('displays update errors', async () => {
      mockChannelApi.updateChannel.mockRejectedValueOnce(new Error('Failed to update channel'));

      render(<ChannelsPage />);

      await waitFor(() => expect(screen.getByText('My Blog')).toBeInTheDocument());

      fireEvent.click(screen.getAllByRole('checkbox')[0]);

      await waitFor(() => {
        expect(screen.getByText(/failed to update channel/i)).toBeInTheDocument();
      });
    });

    it('displays delete errors', async () => {
      mockChannelApi.deleteChannel.mockRejectedValueOnce(new Error('Failed to delete channel'));

      render(<ChannelsPage />);
      await waitFor(() => expect(screen.getByText('My Blog')).toBeInTheDocument());

      fireEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);
      await waitFor(() => screen.getByRole('button', { name: /confirm/i }));
      fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

      await waitFor(() => {
        expect(screen.getByText(/failed to delete channel/i)).toBeInTheDocument();
      });
    });

    it('displays sync errors', async () => {
      mockChannelApi.triggerSync.mockRejectedValueOnce(new Error('Failed to trigger sync'));

      render(<ChannelsPage />);
      await waitFor(() => expect(screen.getByText('My Blog')).toBeInTheDocument());

      fireEvent.click(screen.getAllByRole('button', { name: /sync/i })[0]);

      await waitFor(() => {
        expect(screen.getByText(/failed to trigger sync/i)).toBeInTheDocument();
      });
    });
  });
});
