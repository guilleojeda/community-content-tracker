import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import HomePageContent from '@/app/HomePageContent';

const mockApiClient = {
  getStats: jest.fn(),
};

jest.mock('@/api/client', () => ({
  getPublicApiClient: jest.fn(() => mockApiClient),
}));

jest.mock('next/dynamic', () => () => {
  const mod = require('../../../../src/frontend/app/sections/StatsSection');
  return mod.default || mod;
});

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe('HomePageContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
  });

  it('loads platform stats and renders summary cards', async () => {
    mockApiClient.getStats.mockResolvedValue({
      totalUsers: 120,
      totalContent: 450,
      contentByType: {
        blog: 120,
        youtube: 90,
        github: 60,
        conference_talk: 30,
        podcast: 15,
      },
      recentActivity: {
        last24h: 12,
        last7d: 48,
        last30d: 120,
      },
      topContributors: 15,
    });

    render(<HomePageContent />);

    await waitFor(() => {
      expect(mockApiClient.getStats).toHaveBeenCalled();
      expect(screen.getByText(/platform stats/i)).toBeInTheDocument();
      expect(screen.getByText(/content pieces/i)).toBeInTheDocument();
      expect(screen.getByAltText(/community illustration/i)).toBeInTheDocument();
    });
  });

  it('handles stats load failures gracefully', async () => {
    mockApiClient.getStats.mockRejectedValue(new Error('Network error'));

    render(<HomePageContent />);

    await waitFor(() => {
      expect(mockApiClient.getStats).toHaveBeenCalled();
      expect(screen.getByText('Platform Features')).toBeInTheDocument();
    });
    expect(screen.queryByText(/platform stats/i)).not.toBeInTheDocument();
  });

  it('submits hero search form and navigates to search page', async () => {
    mockApiClient.getStats.mockResolvedValueOnce(null);
    render(<HomePageContent />);

    const input = screen.getByPlaceholderText(/search for aws content/i);
    const button = screen.getByRole('button', { name: /search/i });

    fireEvent.change(input, { target: { value: 'lambda' } });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/search?q=lambda');
    });
  });

  it('shows call-to-action to register', async () => {
    mockApiClient.getStats.mockResolvedValueOnce(null);
    render(<HomePageContent />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /create free account/i })).toBeInTheDocument();
    });
  });
});
