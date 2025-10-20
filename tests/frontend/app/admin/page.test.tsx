import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import AdminDashboardPage from '@/app/admin/page';
import { AdminContextProvider } from '@/app/admin/context';
import userEvent from '@testing-library/user-event';

jest.mock('@/api', () => {
  const actual = jest.requireActual('@/api');
  return {
    ...actual,
    apiClient: {
      getAdminDashboardStats: jest.fn(),
      getAdminSystemHealth: jest.fn(),
      trackAnalyticsEvents: jest.fn(),
    },
  };
});

const mockedApiClient = jest.requireMock('@/api').apiClient as jest.Mocked<typeof import('@/api').apiClient>;

const adminUser = {
  id: 'admin-1',
  username: 'adminuser',
  email: 'admin@example.com',
  isAdmin: true,
  isAwsEmployee: true,
  defaultVisibility: 'public',
  cognitoSub: 'sub',
  profileSlug: 'admin',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function renderWithContext(): void {
  render(
    <AdminContextProvider value={{ currentUser: adminUser }}>
      <AdminDashboardPage />
    </AdminContextProvider>
  );
}

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders key metrics and quick actions when data loads successfully', async () => {
    mockedApiClient.getAdminDashboardStats.mockResolvedValue({
      totalUsers: 42,
      awsEmployees: 5,
      totalContent: 120,
      usersByBadgeType: { hero: 3, ambassador: 2 },
      recentRegistrations: [
        { id: 'user-1', username: 'newbie', email: 'new@example.com', createdAt: new Date().toISOString() },
      ],
      pendingBadgeCandidates: [
        { id: 'user-2', username: 'writer', email: 'writer@example.com', contentCount: 7, createdAt: new Date().toISOString() },
      ],
      quickActions: {
        flaggedContentCount: 2,
        recentAdminActions: 4,
        usersWithoutBadges: 6,
        contentNeedingReview: 3,
      },
    });

    mockedApiClient.getAdminSystemHealth.mockResolvedValue({
      database: 'healthy',
      timestamp: new Date().toISOString(),
    });

    mockedApiClient.trackAnalyticsEvents.mockResolvedValue(undefined);

    renderWithContext();

    await waitFor(() => expect(screen.getByText('Platform Overview')).toBeInTheDocument());

    expect(screen.getByText('Total Users')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('AWS Employees')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();

    const quickActions = screen.getByText('Quick Actions').closest('section')!;
    expect(within(quickActions).getByText('Flagged Content')).toBeInTheDocument();
    expect(within(quickActions).getByText('2')).toBeInTheDocument();
    expect(within(quickActions).getByText('Content Needing Review')).toBeInTheDocument();
    expect(within(quickActions).getByText('3')).toBeInTheDocument();

    expect(mockedApiClient.trackAnalyticsEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'page_view',
        metadata: expect.objectContaining({ page: '/admin', role: 'admin' }),
      })
    );
  });

  it('shows error banner when the dashboard data fails to load', async () => {
    mockedApiClient.getAdminDashboardStats.mockRejectedValue(new Error('boom'));
    mockedApiClient.getAdminSystemHealth.mockResolvedValue({
      database: 'healthy',
      timestamp: new Date().toISOString(),
    });

    renderWithContext();

    await waitFor(() => expect(screen.getByText(/Unable to load admin dashboard/)).toBeInTheDocument());
  });

  it('navigates to quick action targets when links are clicked', async () => {
    mockedApiClient.getAdminDashboardStats.mockResolvedValue({
      totalUsers: 10,
      awsEmployees: 1,
      totalContent: 20,
      usersByBadgeType: {},
      recentRegistrations: [],
      pendingBadgeCandidates: [],
      quickActions: {
        flaggedContentCount: 2,
        recentAdminActions: 1,
        usersWithoutBadges: 4,
        contentNeedingReview: 1,
      },
    });
    mockedApiClient.getAdminSystemHealth.mockResolvedValue({
      database: 'healthy',
      timestamp: new Date().toISOString(),
    });
    mockedApiClient.trackAnalyticsEvents.mockResolvedValue(undefined);

    renderWithContext();

    await waitFor(() => expect(screen.getByText('Quick Actions')).toBeInTheDocument());

    const user = userEvent.setup();
    const quickActions = screen.getByText('Quick Actions').closest('section')!;
    const moderationLink = within(quickActions).getByRole('link', { name: /content needing review/i });

    expect(moderationLink).toHaveAttribute('href', '/admin/moderation');
    await user.click(moderationLink);
  });
});
