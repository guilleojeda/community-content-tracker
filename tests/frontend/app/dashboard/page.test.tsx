import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import DashboardPage from '@/app/dashboard/page';
import { BadgeType, ContentType, Visibility } from '@shared/types';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@/api/client', () => ({
  getAuthenticatedApiClient: jest.fn(),
}));

jest.mock('recharts', () => ({
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ children }: any) => <div data-testid="pie">{children}</div>,
  Cell: () => <div data-testid="cell" />,
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
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

describe('DashboardPage', () => {
  const mockPush = jest.fn();
  const mockRouter = { push: mockPush };

  const { getAuthenticatedApiClient } = require('@/api/client');

  const mockApiClient = {
    getCurrentUser: jest.fn(),
    getUserBadges: jest.fn(),
    listContent: jest.fn(),
  };

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    username: 'testuser',
    profileSlug: 'testuser',
    defaultVisibility: Visibility.PUBLIC,
    isAdmin: false,
    isAwsEmployee: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockBadges = [
    {
      id: 'badge-1',
      userId: 'user-1',
      badgeType: BadgeType.COMMUNITY_BUILDER,
      awardedAt: new Date('2024-02-01'),
      createdAt: new Date('2024-02-01'),
      updatedAt: new Date('2024-02-01'),
    },
    {
      id: 'badge-2',
      userId: 'user-1',
      badgeType: BadgeType.HERO,
      awardedAt: new Date('2024-03-01'),
      createdAt: new Date('2024-03-01'),
      updatedAt: new Date('2024-03-01'),
    },
  ];

  const mockContent = {
    content: [
      {
        id: 'content-1',
        userId: 'user-1',
        title: 'My First Blog Post',
        description: 'A great blog post',
        contentType: ContentType.BLOG,
        visibility: Visibility.PUBLIC,
        publishDate: new Date('2024-01-15'),
        captureDate: new Date('2024-01-15'),
        metrics: { views: 100, likes: 50 },
        tags: ['aws', 'serverless'],
        isClaimed: true,
        urls: [{ id: 'url-1', url: 'https://example.com/blog' }],
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15'),
      },
      {
        id: 'content-2',
        userId: 'user-1',
        title: 'YouTube Tutorial',
        contentType: ContentType.YOUTUBE,
        visibility: Visibility.AWS_COMMUNITY,
        publishDate: new Date('2024-02-01'),
        captureDate: new Date('2024-02-01'),
        metrics: { views: 500 },
        tags: ['tutorial'],
        isClaimed: true,
        urls: [{ id: 'url-2', url: 'https://youtube.com/watch?v=123' }],
        createdAt: new Date('2024-02-01'),
        updatedAt: new Date('2024-02-01'),
      },
      {
        id: 'content-3',
        userId: 'user-1',
        title: 'GitHub Repository',
        contentType: ContentType.GITHUB,
        visibility: Visibility.AWS_ONLY,
        captureDate: new Date('2024-03-01'),
        metrics: { stars: 25 },
        tags: [],
        isClaimed: true,
        urls: [{ id: 'url-3', url: 'https://github.com/user/repo' }],
        createdAt: new Date('2024-03-01'),
        updatedAt: new Date('2024-03-01'),
      },
      {
        id: 'content-4',
        userId: 'user-1',
        title: 'Conference Talk',
        contentType: ContentType.CONFERENCE_TALK,
        visibility: Visibility.PRIVATE,
        captureDate: new Date('2024-03-15'),
        metrics: {},
        tags: ['conference'],
        isClaimed: true,
        urls: [{ id: 'url-4', url: 'https://example.com/talk' }],
        createdAt: new Date('2024-03-15'),
        updatedAt: new Date('2024-03-15'),
      },
      {
        id: 'content-5',
        userId: 'user-1',
        title: 'Podcast Episode',
        contentType: ContentType.PODCAST,
        visibility: Visibility.PUBLIC,
        captureDate: new Date('2024-04-01'),
        metrics: { downloads: 200 },
        tags: ['podcast'],
        isClaimed: true,
        urls: [{ id: 'url-5', url: 'https://podcast.com/ep1' }],
        createdAt: new Date('2024-04-01'),
        updatedAt: new Date('2024-04-01'),
      },
    ],
    total: 5,
  };

  const setHappyPathResponses = () => {
    mockApiClient.getCurrentUser.mockResolvedValue(mockUser);
    mockApiClient.getUserBadges.mockResolvedValue(mockBadges);
    mockApiClient.listContent.mockResolvedValue(mockContent);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (getAuthenticatedApiClient as jest.Mock).mockReturnValue(mockApiClient);
    localStorageMock.clear();
    localStorageMock.setItem('accessToken', 'mock-token');
    setHappyPathResponses();
  });

  describe('loading state', () => {
    it('renders skeletons while requests are in-flight', async () => {
      mockApiClient.getCurrentUser.mockReturnValue(new Promise(() => {}));
      mockApiClient.getUserBadges.mockReturnValue(new Promise(() => {}));
      mockApiClient.listContent.mockReturnValue(new Promise(() => {}));

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByTestId('stats-skeleton')).toBeInTheDocument();
        expect(screen.getByTestId('content-list-skeleton')).toBeInTheDocument();
      });
    });
  });

  describe('stats overview', () => {
    it('shows total content and engagement numbers', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Total Engagement')).toBeInTheDocument();
        expect(screen.getByText('875')).toBeInTheDocument();
        expect(screen.getByText('Total Content')).toBeInTheDocument();
        expect(screen.getByText('5')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /total views/i })).toBeInTheDocument();
        expect(screen.getAllByText('600').length).toBeGreaterThan(0);
        const engagementCard = screen.getByTestId('total-engagement-card');
        expect(within(engagementCard).getByText(/views/i)).toBeInTheDocument();
        expect(within(engagementCard).getByText(/likes/i)).toBeInTheDocument();
        // Only top 3 metrics are shown in engagement breakdown
        // With the mock data: views (600), likes (50), stars (25) are the top 3
        expect(within(engagementCard).getByText(/stars/i)).toBeInTheDocument();
      });
    });

    it('handles missing engagement metrics gracefully', async () => {
      mockApiClient.listContent.mockResolvedValueOnce({
        content: [
          {
            ...mockContent.content[0],
            metrics: {},
          },
        ],
        total: 1,
      });

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByTestId('total-engagement-card')).toBeInTheDocument();
        expect(screen.getAllByText('0').length).toBeGreaterThan(0);
        expect(screen.getByText(/no engagement data yet/i)).toBeInTheDocument();
      });
    });

    it('keeps custom engagement metrics after prioritized ones', async () => {
      mockApiClient.listContent.mockResolvedValueOnce({
        content: [
          {
            ...mockContent.content[0],
            metrics: { stars: 12, custom_metric: 7 },
          },
        ],
        total: 1,
      });

      render(<DashboardPage />);

      await waitFor(() => {
        const engagementCard = screen.getByTestId('total-engagement-card');
        expect(within(engagementCard).getByText(/stars/i)).toBeInTheDocument();
        expect(within(engagementCard).getByText(/custom metric/i)).toBeInTheDocument();
      });
    });
  });

  describe('recent content list', () => {
    it('renders recent items with types and visibilities', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Recent Content')).toBeInTheDocument();
        expect(screen.getByText('My First Blog Post')).toBeInTheDocument();
        expect(screen.getByText('YouTube Tutorial')).toBeInTheDocument();
        expect(screen.getByText('blog')).toBeInTheDocument();
        expect(screen.getByText('aws_only')).toBeInTheDocument();
      });
    });

    it('limits list to five entries', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        const items = screen.getAllByTestId('content-item');
        expect(items.length).toBeLessThanOrEqual(5);
      });
    });
  });

  describe('visibility chart', () => {
    it('displays chart with visibility distribution', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Visibility Distribution')).toBeInTheDocument();
        expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
      });
    });
  });

  describe('badges section', () => {
    it('shows AWS program badges and AWS employee indicator', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('AWS Badges')).toBeInTheDocument();
        expect(screen.getByText('Community Builder')).toBeInTheDocument();
        expect(screen.getByText('AWS Hero')).toBeInTheDocument();
        expect(screen.getByText('AWS Employee')).toBeInTheDocument();
      });
    });

    it('omits AWS employee ribbon for non-employees', async () => {
      mockApiClient.getCurrentUser.mockResolvedValueOnce({ ...mockUser, isAwsEmployee: false });

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.queryByText('AWS Employee')).not.toBeInTheDocument();
      });
    });

    it('renders empty state when no badges exist', async () => {
      mockApiClient.getCurrentUser.mockResolvedValueOnce({ ...mockUser, isAwsEmployee: false });
      mockApiClient.getUserBadges.mockResolvedValueOnce([]);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('AWS Badges')).toBeInTheDocument();
        expect(screen.getByText('No badges yet')).toBeInTheDocument();
      });
    });
  });

  describe('quick actions', () => {
    it('links to content and channel management UIs', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText('Quick Actions')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /add content/i })).toHaveAttribute('href', '/dashboard/content');
        expect(screen.getByRole('link', { name: /manage channels/i })).toHaveAttribute('href', '/dashboard/channels');
      });
    });
  });

  describe('error handling', () => {
    it('surface user fetch errors', async () => {
      mockApiClient.getCurrentUser.mockRejectedValueOnce(new Error('Failed to fetch user'));

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(/failed to fetch user/i)).toBeInTheDocument();
      });
    });

    it('surface badge fetch errors', async () => {
      mockApiClient.getUserBadges.mockRejectedValueOnce(new Error('Failed to fetch badges'));

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(/failed to fetch badges/i)).toBeInTheDocument();
      });
    });

    it('surface content fetch errors', async () => {
      mockApiClient.listContent.mockRejectedValueOnce(new Error('Failed to fetch content'));

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(/failed to fetch content/i)).toBeInTheDocument();
      });
    });
  });

  describe('authentication guard', () => {
    it('redirects to login when no token present', async () => {
      localStorageMock.clear();

      render(<DashboardPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/auth/login');
      });
    });
  });

  describe('empty states', () => {
    it('shows empty content messaging when API returns no content', async () => {
      mockApiClient.listContent.mockResolvedValueOnce({ content: [], total: 0 });

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(/no content yet/i)).toBeInTheDocument();
        expect(screen.getByText(/get started by adding your first content/i)).toBeInTheDocument();
      });
    });
  });
});
