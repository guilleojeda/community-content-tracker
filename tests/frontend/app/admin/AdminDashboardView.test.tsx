import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import AdminDashboardView from '@/app/admin/AdminDashboardView';
import { AdminContextProvider } from '@/app/admin/context';
import type { AdminDashboardStats, SystemHealthStatus } from '@/api';

jest.mock('@/lib/api/lazyClient', () => ({
  loadSharedApiClient: jest.fn(),
}));

const mockedLoadSharedApiClient = require('@/lib/api/lazyClient')
  .loadSharedApiClient as jest.MockedFunction<typeof import('@/lib/api/lazyClient').loadSharedApiClient>;

const adminUser = {
  id: 'admin',
  username: 'Admin User',
  email: 'admin@example.com',
  cognitoSub: 'sub',
  profileSlug: 'admin',
  defaultVisibility: 'public',
  isAdmin: true,
  isAwsEmployee: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderDashboard(): void {
  render(
    <AdminContextProvider value={{ currentUser: adminUser }}>
      <AdminDashboardView />
    </AdminContextProvider>
  );
}

function createStats(overrides: Partial<AdminDashboardStats> = {}): AdminDashboardStats {
  return {
    totalUsers: 2500,
    awsEmployees: 120,
    totalContent: 8400,
    usersByBadgeType: {
      community_builder: 40,
      hero: 12,
      ambassador: 7,
      user_group_leader: 16,
    },
    recentRegistrations: [
      { id: 'user-1', username: 'alice', email: 'alice@example.com', createdAt: new Date().toISOString() },
    ],
    pendingBadgeCandidates: [
      { id: 'user-2', username: 'bob', email: 'bob@example.com', contentCount: 4, createdAt: new Date().toISOString() },
    ],
    quickActions: {
      flaggedContentCount: 3,
      recentAdminActions: 5,
      usersWithoutBadges: 12,
      contentNeedingReview: 8,
    },
    ...overrides,
  };
}

function createHealth(overrides: Partial<SystemHealthStatus> = {}): SystemHealthStatus {
  return {
    database: 'healthy',
    timestamp: new Date().toISOString(),
    connectionPool: undefined,
    lambda: undefined,
    queryPerformance: undefined,
    ...overrides,
  };
}

describe('AdminDashboardView', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('renders loading skeleton while data is fetched', () => {
    mockedLoadSharedApiClient.mockResolvedValue({
      getAdminDashboardStats: () => new Promise(() => {}),
      getAdminSystemHealth: () => new Promise(() => {}),
      trackAnalyticsEvents: jest.fn().mockResolvedValue(undefined),
    } as any);

    renderDashboard();
    expect(document.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('displays error state when dashboard data fails to load', async () => {
    mockedLoadSharedApiClient.mockResolvedValue({
      getAdminDashboardStats: jest.fn().mockRejectedValue(new Error('Service unavailable')),
      getAdminSystemHealth: jest.fn().mockResolvedValue(createHealth()),
      trackAnalyticsEvents: jest.fn().mockResolvedValue(undefined),
    } as any);

    renderDashboard();
    await waitFor(() => expect(screen.getByText(/Unable to load admin dashboard/i)).toBeInTheDocument());
    expect(screen.getByText(/Service unavailable/i)).toBeInTheDocument();
  });

  it('renders dashboard metrics, badges and system health', async () => {
    mockedLoadSharedApiClient.mockResolvedValue({
      getAdminDashboardStats: jest.fn().mockResolvedValue(createStats()),
      getAdminSystemHealth: jest.fn().mockResolvedValue(createHealth()),
      trackAnalyticsEvents: jest.fn().mockResolvedValue(undefined),
    } as any);

    renderDashboard();

    await waitFor(() => expect(screen.getByText(/Platform Overview/i)).toBeInTheDocument());
    expect(screen.getByText('Total Users')).toBeInTheDocument();
    expect(screen.getByText('2,500')).toBeInTheDocument();
    expect(screen.getByText(/Badge Distribution/i)).toBeInTheDocument();
    expect(screen.getByText(/Community builder/i)).toBeInTheDocument();
    expect(screen.getByText(/System Health/i)).toBeInTheDocument();
    expect(screen.getByText(/Signed in as Admin User/i)).toBeInTheDocument();
  });

  it('renders empty states when badge metrics and lists are empty', async () => {
    mockedLoadSharedApiClient.mockResolvedValue({
      getAdminDashboardStats: jest.fn().mockResolvedValue(
        createStats({
          usersByBadgeType: {},
          recentRegistrations: [],
          pendingBadgeCandidates: [],
        })
      ),
      getAdminSystemHealth: jest.fn().mockResolvedValue(createHealth({ database: 'unknown' })),
      trackAnalyticsEvents: jest.fn().mockResolvedValue(undefined),
    } as any);

    renderDashboard();

    await waitFor(() => expect(screen.getByText(/No active badges awarded yet/i)).toBeInTheDocument());
    expect(screen.getByText(/No recent registrations/i)).toBeInTheDocument();
    expect(screen.getByText(/No pending badge candidates/i)).toBeInTheDocument();
    // Unknown system health badge
    expect(screen.getByText(/unknown/i)).toBeInTheDocument();
  });

  it('shows degraded system health details with timestamps', async () => {
    const timestamp = new Date().toISOString();
    mockedLoadSharedApiClient.mockResolvedValue({
      getAdminDashboardStats: jest.fn().mockResolvedValue(createStats()),
      getAdminSystemHealth: jest.fn().mockResolvedValue(
        createHealth({
          database: 'degraded',
          error: 'RDS connection issues',
          timestamp,
        })
      ),
      trackAnalyticsEvents: jest.fn().mockResolvedValue(undefined),
    } as any);

    renderDashboard();

    await waitFor(() => expect(screen.getByText(/Platform Overview/i)).toBeInTheDocument());
    const statusChip = screen.getByText(/degraded/i);
    expect(statusChip).toHaveClass('bg-red-100');
    expect(screen.getByText(/RDS connection issues/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Checked/i).length).toBeGreaterThan(0);
  });

  it('ignores dashboard updates when component unmounts before data resolves', async () => {
    const statsDeferred = createDeferred<AdminDashboardStats>();
    const healthDeferred = createDeferred<SystemHealthStatus>();

    mockedLoadSharedApiClient.mockResolvedValue({
      getAdminDashboardStats: jest.fn().mockReturnValue(statsDeferred.promise),
      getAdminSystemHealth: jest.fn().mockReturnValue(healthDeferred.promise),
      trackAnalyticsEvents: jest.fn().mockResolvedValue(undefined),
    } as any);

    const { unmount } = render(
      <AdminContextProvider value={{ currentUser: adminUser }}>
        <AdminDashboardView />
      </AdminContextProvider>
    );

    unmount();

    await act(async () => {
      statsDeferred.resolve(createStats());
      healthDeferred.resolve(createHealth());
    });

    expect(mockedLoadSharedApiClient).toHaveBeenCalled();
  });

  it('ignores dashboard errors after the component unmounts', async () => {
    const statsDeferred = createDeferred<AdminDashboardStats>();

    mockedLoadSharedApiClient.mockResolvedValue({
      getAdminDashboardStats: jest.fn().mockReturnValue(statsDeferred.promise),
      getAdminSystemHealth: jest.fn().mockResolvedValue(createHealth()),
      trackAnalyticsEvents: jest.fn().mockResolvedValue(undefined),
    } as any);

    const { unmount } = render(
      <AdminContextProvider value={{ currentUser: adminUser }}>
        <AdminDashboardView />
      </AdminContextProvider>
    );

    unmount();

    await act(async () => {
      statsDeferred.reject(new Error('network timeout'));
    });

    expect(mockedLoadSharedApiClient).toHaveBeenCalled();
  });

  it('falls back to unknown error when the API returns no dashboard stats', async () => {
    mockedLoadSharedApiClient.mockResolvedValue({
      getAdminDashboardStats: jest.fn().mockResolvedValue(null),
      getAdminSystemHealth: jest.fn().mockResolvedValue(null),
      trackAnalyticsEvents: jest.fn().mockResolvedValue(undefined),
    } as any);

    renderDashboard();

    await waitFor(() => expect(screen.getByText(/Unable to load admin dashboard/i)).toBeInTheDocument());
    expect(screen.getByText(/Unknown error/i)).toBeInTheDocument();
  });

  it('renders fallback message when API throws a non-Error value', async () => {
    mockedLoadSharedApiClient.mockResolvedValue({
      getAdminDashboardStats: jest.fn().mockRejectedValue('Service exploded'),
      getAdminSystemHealth: jest.fn().mockResolvedValue(createHealth()),
      trackAnalyticsEvents: jest.fn().mockResolvedValue(undefined),
    } as any);

    renderDashboard();

    await waitFor(() => expect(screen.getByText(/Unable to load admin dashboard/i)).toBeInTheDocument());
    expect(screen.getByText(/Failed to load admin dashboard/i)).toBeInTheDocument();
  });

  it('shows anonymous admin message when context user missing and health unavailable', async () => {
    mockedLoadSharedApiClient.mockResolvedValue({
      getAdminDashboardStats: jest.fn().mockResolvedValue(createStats()),
      getAdminSystemHealth: jest.fn().mockResolvedValue(null),
      trackAnalyticsEvents: jest.fn().mockResolvedValue(undefined),
    } as any);

    render(
      <AdminContextProvider value={{ currentUser: null }}>
        <AdminDashboardView />
      </AdminContextProvider>
    );

    await waitFor(() => expect(screen.getByText(/Platform Overview/i)).toBeInTheDocument());
    expect(screen.getByText(/Administrator authenticated/i)).toBeInTheDocument();
    expect(screen.getByText(/Database/i).closest('div')).toHaveTextContent(/unknown/i);
    expect(screen.getByText(/Unavailable/i)).toBeInTheDocument();
  });
});
