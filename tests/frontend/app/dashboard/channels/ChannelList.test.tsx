import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChannelList from '@/app/dashboard/channels/ChannelList';
import { Channel, ChannelType } from '@shared/types';

const baseChannel: Channel = {
  id: 'channel-1',
  userId: 'user',
  channelType: ChannelType.BLOG,
  url: 'https://example.com/rss',
  name: 'Example Blog',
  enabled: true,
  lastSyncAt: new Date('2024-01-01T10:00:00Z'),
  lastSyncStatus: 'success',
  syncFrequency: 'daily',
  metadata: {},
  createdAt: new Date('2024-01-01T08:00:00Z'),
  updatedAt: new Date('2024-01-01T10:00:00Z'),
};

describe('ChannelList', () => {
  it('renders empty state when no channels exist', () => {
    render(
      <ChannelList
        channels={[]}
        onToggleEnabled={jest.fn()}
        onDelete={jest.fn()}
        onSync={jest.fn()}
      />
    );

    expect(screen.getByText(/no channels yet/i)).toBeInTheDocument();
  });

  it('renders channel information and status badges', () => {
    const channels: Channel[] = [
      baseChannel,
      {
        ...baseChannel,
        id: 'channel-2',
        channelType: ChannelType.YOUTUBE,
        name: 'Video Channel',
        enabled: false,
        lastSyncStatus: 'error',
        lastSyncError: 'Invalid API key',
        metadata: { verified: false },
      },
      {
        ...baseChannel,
        id: 'channel-3',
        channelType: ChannelType.GITHUB,
        metadata: { verified: true },
        lastSyncAt: undefined,
        lastSyncStatus: undefined,
      },
    ];

    render(
      <ChannelList
        channels={channels}
        onToggleEnabled={jest.fn()}
        onDelete={jest.fn()}
        onSync={jest.fn()}
      />
    );

    expect(screen.getAllByText('Example Blog').length).toBeGreaterThan(0);
    expect(screen.getByText(/verification pending/i)).toBeInTheDocument();
    expect(screen.getByText(/verified/i)).toBeInTheDocument();
    expect(screen.getByText('Invalid API key')).toBeInTheDocument();
    expect(screen.getAllByText(/never synced/i).length).toBeGreaterThan(0);
  });

  it('executes toggle, delete, and sync handlers', async () => {
    const onToggleEnabled = jest.fn().mockResolvedValue(undefined);
    const onDelete = jest.fn().mockResolvedValue(undefined);
    const onSync = jest.fn().mockResolvedValue(undefined);

    render(
      <ChannelList
        channels={[baseChannel]}
        onToggleEnabled={onToggleEnabled}
        onDelete={onDelete}
        onSync={onSync}
      />
    );

    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(onToggleEnabled).toHaveBeenCalledWith('channel-1', false));

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('channel-1'));

    fireEvent.click(screen.getByRole('button', { name: /^sync$/i }));
    await waitFor(() => expect(onSync).toHaveBeenCalledWith('channel-1'));
  });

  it('allows cancelling delete confirmation', async () => {
    const onDelete = jest.fn();

    render(
      <ChannelList
        channels={[baseChannel]}
        onToggleEnabled={jest.fn()}
        onDelete={onDelete}
        onSync={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });

  it('shows syncing indicator while sync promise resolves', async () => {
    let resolveSync: () => void = () => {};
    const onSync = jest.fn(() => new Promise<void>((resolve) => { resolveSync = resolve; }));

    render(
      <ChannelList
        channels={[baseChannel]}
        onToggleEnabled={jest.fn()}
        onDelete={jest.fn()}
        onSync={onSync}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^sync$/i }));
    expect(await screen.findByText(/syncing/i)).toBeInTheDocument();

    resolveSync();
    await waitFor(() => expect(onSync).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: /^sync$/i })).toBeEnabled());
  });
});
