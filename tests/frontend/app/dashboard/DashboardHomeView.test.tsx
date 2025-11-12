import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import DashboardHomeView from '@/app/dashboard/DashboardHomeView';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

jest.mock('@/lib/api/lazyClient', () => ({
  loadAuthenticatedApiClient: jest.fn(),
}));

const mockedLoadAuthenticatedApiClient = require('@/lib/api/lazyClient')
  .loadAuthenticatedApiClient as jest.MockedFunction<typeof import('@/lib/api/lazyClient').loadAuthenticatedApiClient>;

const exampleUser = {
  id: 'user-1',
  username: 'builder',
  email: 'builder@example.com',
  profileSlug: 'builder',
  defaultVisibility: 'public',
  cognitoSub: 'sub',
  isAdmin: false,
  isAwsEmployee: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const badges = [
  { id: 'badge-1', badgeType: 'hero', awardedAt: new Date().toISOString() },
] as any;

const content = [
  {
    id: 'content-1',
    title: 'Serverless 101',
    description: 'Guide',
    contentType: 'blog',
    visibility: 'public',
    publishDate: '2024-01-01T00:00:00.000Z',
    captureDate: '2024-01-02T00:00:00.000Z',
    metrics: { views: 150, likes: 10 },
    tags: ['aws'],
    urls: [],
    createdAt: new Date('2024-01-02').toISOString(),
    updatedAt: new Date('2024-01-02').toISOString(),
  },
  {
    id: 'content-2',
    title: 'AWS CDK Deep Dive',
    description: 'Video',
    contentType: 'youtube',
    visibility: 'aws_only',
    publishDate: '2024-01-05T00:00:00.000Z',
    captureDate: '2024-01-05T00:00:00.000Z',
    metrics: { views: 200, likes: 25, shares: 5 },
    tags: ['cdk'],
    urls: [],
    createdAt: new Date('2024-01-05').toISOString(),
    updatedAt: new Date('2024-01-05').toISOString(),
  },
] as any;

function renderDashboard(): void {
  render(<DashboardHomeView />);
}

describe('DashboardHomeView', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    localStorage.clear();
  });

  it('redirects to login when no token is available', () => {
    pushMock.mockClear();
    renderDashboard();
    expect(pushMock).toHaveBeenCalledWith('/auth/login');
  });

  it('shows error when fetching current user fails', async () => {
    localStorage.setItem('accessToken', 'token');
    mockedLoadAuthenticatedApiClient.mockResolvedValue({
      getCurrentUser: jest.fn().mockRejectedValue(new Error('Unauthorized')),
      getUserBadges: jest.fn(),
      listContent: jest.fn(),
    } as any);

    renderDashboard();
    await waitFor(() => expect(screen.getByText('Unauthorized')).toBeInTheDocument());
  });

  it('surfaces badge fetch errors', async () => {
    localStorage.setItem('accessToken', 'token');
    mockedLoadAuthenticatedApiClient.mockResolvedValue({
      getCurrentUser: jest.fn().mockResolvedValue(exampleUser),
      getUserBadges: jest.fn().mockRejectedValue(new Error('Badge service down')),
      listContent: jest.fn(),
    } as any);

    renderDashboard();
    await waitFor(() => expect(screen.getByText('Badge service down')).toBeInTheDocument());
  });

  it('surfaces content fetch errors', async () => {
    localStorage.setItem('accessToken', 'token');
    mockedLoadAuthenticatedApiClient.mockResolvedValue({
      getCurrentUser: jest.fn().mockResolvedValue(exampleUser),
      getUserBadges: jest.fn().mockResolvedValue(badges),
      listContent: jest.fn().mockRejectedValue(new Error('timeout')),
    } as any);

    renderDashboard();
    await waitFor(() => expect(screen.getByText('timeout')).toBeInTheDocument());
  });

  it('uses fallback message when badge service rejects with non-error payloads', async () => {
    localStorage.setItem('accessToken', 'token');
    mockedLoadAuthenticatedApiClient.mockResolvedValue({
      getCurrentUser: jest.fn().mockResolvedValue(exampleUser),
      getUserBadges: jest.fn().mockRejectedValue('bad-request'),
      listContent: jest.fn(),
    } as any);

    renderDashboard();
    await waitFor(() => expect(screen.getByText('Failed to fetch badges')).toBeInTheDocument());
  });

  it('renders metrics when data loads successfully', async () => {
    localStorage.setItem('accessToken', 'token');
    mockedLoadAuthenticatedApiClient.mockResolvedValue({
      getCurrentUser: jest.fn().mockResolvedValue(exampleUser),
      getUserBadges: jest.fn().mockResolvedValue(badges),
      listContent: jest.fn().mockResolvedValue({ content }),
    } as any);

    renderDashboard();
    await waitFor(() => expect(screen.getByText('Recent Content')).toBeInTheDocument());
    expect(screen.getAllByText(/Serverless 101|AWS CDK Deep Dive/).length).toBeGreaterThan(0);
    const totalViewsCard = screen.getByText('Total Views').closest('div');
    expect(totalViewsCard).toBeTruthy();
    expect(totalViewsCard).toHaveTextContent('350');
    expect(screen.getAllByText(/Analytics/i).length).toBeGreaterThan(0);
  });

  it('shows network error when authenticated client cannot be loaded', async () => {
    localStorage.setItem('accessToken', 'token');
    mockedLoadAuthenticatedApiClient.mockRejectedValue('fatal');

    renderDashboard();
    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
  });

  it('surfaces raw error message when authenticated client load rejects with Error', async () => {
    localStorage.setItem('accessToken', 'token');
    mockedLoadAuthenticatedApiClient.mockRejectedValue(new Error('client boom'));

    renderDashboard();
    await waitFor(() => expect(screen.getByText('client boom')).toBeInTheDocument());
  });

  it('shows empty visibility panel state when no content exists', async () => {
    localStorage.setItem('accessToken', 'token');
    mockedLoadAuthenticatedApiClient.mockResolvedValue({
      getCurrentUser: jest.fn().mockResolvedValue(exampleUser),
      getUserBadges: jest.fn().mockResolvedValue(badges),
      listContent: jest.fn().mockResolvedValue({ content: [] }),
    } as any);

    renderDashboard();
    await waitFor(() => expect(screen.getByText('Visibility Distribution')).toBeInTheDocument());
    expect(screen.getByText('No data to display')).toBeInTheDocument();
  });

  it('ignores invalid metrics and sorts unknown metrics alphabetically', async () => {
    localStorage.setItem('accessToken', 'token');
    const quirkyContent = [
      {
        ...content[0],
        metrics: {
          views: 100,
          applause: 4,
          claps: 6,
          downloads: Number.POSITIVE_INFINITY,
          invalid: 'not-a-number',
        },
      },
      {
        ...content[1],
        metrics: undefined,
      },
    ];

    mockedLoadAuthenticatedApiClient.mockResolvedValue({
      getCurrentUser: jest.fn().mockResolvedValue(exampleUser),
      getUserBadges: jest.fn().mockResolvedValue([]),
      listContent: jest.fn().mockResolvedValue({ content: quirkyContent }),
    } as any);

    renderDashboard();
    await waitFor(() => expect(screen.getByTestId('total-engagement-card')).toBeInTheDocument());

    const totalCard = screen.getByTestId('total-engagement-card');
    expect(totalCard).toHaveTextContent('110');

    const metricTerms = within(totalCard).getAllByRole('term');
    expect(metricTerms[0]).toHaveTextContent('views');
    expect(metricTerms[1]).toHaveTextContent('applause');
    expect(metricTerms[2]).toHaveTextContent('claps');

    expect(screen.queryByText(/invalid/i)).not.toBeInTheDocument();
  });
});
