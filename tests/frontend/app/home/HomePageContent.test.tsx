import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import HomePageContent from '@/app/HomePageContent';

const mockApiClient = {
  getStats: jest.fn(),
};

jest.mock('@/api/client', () => ({
  getPublicApiClient: jest.fn(() => mockApiClient),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe('HomePageContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    });
  });

  it('handles stats load failures gracefully', async () => {
    mockApiClient.getStats.mockRejectedValue(new Error('Network error'));

    render(<HomePageContent />);

    await waitFor(() => {
      expect(mockApiClient.getStats).toHaveBeenCalled();
      expect(screen.getByText('Platform Features')).toBeInTheDocument();
    });
  });
});
