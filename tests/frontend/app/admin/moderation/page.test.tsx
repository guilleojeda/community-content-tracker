import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import AdminModerationPage from '@/app/admin/moderation/page';

jest.mock('@/api', () => {
  const actual = jest.requireActual('@/api');
  return {
    ...actual,
    apiClient: {
      listFlaggedContent: jest.fn(),
      trackAnalyticsEvents: jest.fn(),
      moderateContent: jest.fn(),
      adminDeleteContent: jest.fn(),
    },
  };
});

jest.mock('@/utils/download', () => ({
  downloadBlob: jest.fn(),
}));

const mockedApiClient = jest.requireMock('@/api').apiClient as jest.Mocked<typeof import('@/api').apiClient>;
const mockedDownload = jest.requireMock('@/utils/download').downloadBlob as jest.MockedFunction<
  typeof import('@/utils/download').downloadBlob
>;

const flaggedItem = {
  id: 'content-1',
  title: 'Flagged Guide',
  description: 'Needs moderation',
  contentType: 'blog',
  visibility: 'public',
  isFlagged: true,
  flaggedAt: new Date().toISOString(),
  flagReason: 'Spam',
  moderationStatus: 'flagged',
  createdAt: new Date().toISOString(),
  urls: ['https://example.com/content'],
  user: {
    id: 'user-42',
    username: 'writer',
    email: 'writer@example.com',
  },
  flaggedBy: 'admin',
};

describe('AdminModerationPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApiClient.listFlaggedContent.mockResolvedValue({
      content: [flaggedItem],
      total: 1,
      limit: 100,
      offset: 0,
    });
    mockedApiClient.trackAnalyticsEvents.mockResolvedValue(undefined);
    mockedApiClient.moderateContent.mockResolvedValue(undefined);
    mockedApiClient.adminDeleteContent.mockResolvedValue(undefined);
    mockedDownload.mockReturnValue(undefined);
  });

  it('renders flagged content and filters by status', async () => {
    render(<AdminModerationPage />);

    await waitFor(() => expect(screen.getByText('Content Moderation')).toBeInTheDocument());
    expect(screen.getByText('Flagged Guide')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Status Filter'), 'flagged');
    expect(screen.getByText('Flagged Guide')).toBeInTheDocument();
  });

  it('approves content and displays success message', async () => {
    render(<AdminModerationPage />);
    await screen.findByText('Flagged Guide');

    const approveButton = screen.getByRole('button', { name: /Approve/i });
    await userEvent.click(approveButton);

    await waitFor(() =>
      expect(mockedApiClient.moderateContent).toHaveBeenCalledWith(
        flaggedItem.id,
        'approve',
        'Admin moderation panel'
      )
    );

    await waitFor(() => expect(screen.getByText(/Content approved successfully/)).toBeInTheDocument());
  });

  it('exports flagged content to CSV', async () => {
    render(<AdminModerationPage />);
    await screen.findByText('Flagged Guide');

    await userEvent.click(screen.getByRole('button', { name: /Export CSV/i }));
    expect(mockedDownload).toHaveBeenCalledWith(expect.any(Blob), 'flagged-content.csv');
  });

  it('removes and deletes content through moderation actions', async () => {
    render(<AdminModerationPage />);
    await screen.findByText('Flagged Guide');

    await userEvent.click(screen.getByRole('button', { name: /Remove/i }));
    await waitFor(() =>
      expect(mockedApiClient.moderateContent).toHaveBeenCalledWith(
        flaggedItem.id,
        'remove',
        'Admin moderation panel'
      )
    );

    await userEvent.click(screen.getByRole('button', { name: /Delete/i }));
    await waitFor(() =>
      expect(mockedApiClient.adminDeleteContent).toHaveBeenCalledWith(
        flaggedItem.id,
        'Removed by admin moderation'
      )
    );
  });

  it('displays empty state when filters produce no results', async () => {
    render(<AdminModerationPage />);
    await waitFor(() => expect(screen.getByText('Flagged Guide')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/Search/i), 'non-existent');
    expect(await screen.findByText(/No content matches the current filters/i)).toBeInTheDocument();
  });

  it('handles load errors gracefully', async () => {
    mockedApiClient.listFlaggedContent.mockRejectedValueOnce('down');

    render(<AdminModerationPage />);
    expect(await screen.findByText(/Failed to load flagged content/i)).toBeInTheDocument();
  });

  it('filters by pending and removed statuses', async () => {
    const pendingItem = {
      ...flaggedItem,
      id: 'pending',
      title: 'Pending Content',
      moderationStatus: 'approved',
      isFlagged: true,
    };
    const removedItem = {
      ...flaggedItem,
      id: 'removed',
      title: 'Removed Content',
      moderationStatus: 'removed',
      isFlagged: false,
    };
    mockedApiClient.listFlaggedContent.mockResolvedValueOnce({
      content: [flaggedItem, pendingItem, removedItem],
      total: 3,
      limit: 100,
      offset: 0,
    });

    render(<AdminModerationPage />);
    await waitFor(() => expect(screen.getByText('Flagged Guide')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText('Status Filter'), 'pending');
    expect(await screen.findByText('Pending Content')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Status Filter'), 'removed');
    expect(screen.getByText('Removed Content')).toBeInTheDocument();
  });

  it('refreshes content via the refresh button', async () => {
    render(<AdminModerationPage />);
    await waitFor(() => expect(screen.getByText('Flagged Guide')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    expect(mockedApiClient.listFlaggedContent).toHaveBeenCalledTimes(2);
  });
});
