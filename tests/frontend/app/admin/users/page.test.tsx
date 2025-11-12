import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import AdminUsersPage from '@/app/admin/users/page';
import { AdminContextProvider } from '@/app/admin/context';

jest.mock('@/api', () => {
  const actual = jest.requireActual('@/api');
  return {
    ...actual,
    apiClient: {
      listAdminUsers: jest.fn(),
      getAdminUser: jest.fn(),
      listFlaggedContent: jest.fn(),
      grantBadge: jest.fn(),
      revokeBadge: jest.fn(),
      bulkBadges: jest.fn(),
      exportUsersCsv: jest.fn(),
      setAwsEmployee: jest.fn(),
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

const adminContextUser = {
  id: 'admin-1',
  username: 'admin',
  email: 'admin@example.com',
  isAdmin: true,
  isAwsEmployee: true,
  cognitoSub: 'sub',
  profileSlug: 'admin',
  defaultVisibility: 'public',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const listResponse = {
  users: [
    {
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      isAdmin: false,
      isAwsEmployee: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'user-2',
      username: 'bob',
      email: 'bob@example.com',
      isAdmin: true,
      isAwsEmployee: true,
      createdAt: new Date().toISOString(),
    },
  ],
  total: 30,
  limit: 25,
  offset: 0,
};

const detailResponse = {
  user: {
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    isAdmin: false,
    isAwsEmployee: false,
    createdAt: new Date().toISOString(),
  },
  badges: [],
  contentCount: 3,
};

const flaggedContentResponse = {
  content: [
    {
      id: 'content-1',
      title: 'Flagged blog',
      description: 'Needs review',
      contentType: 'blog',
      visibility: 'public',
      isFlagged: true,
      flaggedAt: new Date().toISOString(),
      flagReason: 'Spam',
      moderationStatus: 'flagged',
      createdAt: new Date().toISOString(),
      urls: ['https://example.com/blog'],
      user: {
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
      },
      flaggedBy: 'moderator',
    },
    {
      id: 'content-2',
      title: 'Missing metadata post',
      description: 'No reason provided',
      contentType: 'video',
      visibility: 'private',
      isFlagged: true,
      flaggedAt: undefined,
      flagReason: undefined,
      moderationStatus: 'flagged',
      createdAt: new Date().toISOString(),
      urls: ['https://example.com/video'],
      user: {
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
      },
      flaggedBy: 'moderator',
    },
  ],
  total: 2,
  limit: 100,
  offset: 0,
};

function renderUsersPage(): void {
  render(
    <AdminContextProvider value={{ currentUser: adminContextUser }}>
      <AdminUsersPage />
    </AdminContextProvider>
  );
}

describe('AdminUsersPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedApiClient.listAdminUsers.mockResolvedValue(listResponse);
    mockedApiClient.getAdminUser.mockResolvedValue(detailResponse);
    mockedApiClient.listFlaggedContent.mockResolvedValue(flaggedContentResponse);
    mockedApiClient.grantBadge.mockResolvedValue({
      success: true,
      data: { badgeId: 'badge-1', userId: 'user-1', badgeType: 'hero' },
    });
    mockedApiClient.exportUsersCsv.mockResolvedValue({ blob: new Blob(['csv']), filename: 'users.csv' });
    mockedDownload.mockReturnValue(undefined);
  });

  it('displays user list and allows selecting a user to view details', async () => {
    renderUsersPage();

    await waitFor(() => expect(screen.getByText('User Management')).toBeInTheDocument());

    const aliceRow = await screen.findByRole('row', { name: /alice/i });
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(listResponse.users.length + 1); // header + rows
    await userEvent.click(aliceRow);

    await waitFor(() => expect(screen.getByText(/Content pieces:/)).toBeInTheDocument());
    expect(screen.getByText(/alice@example.com/)).toBeInTheDocument();
    expect(mockedApiClient.getAdminUser).toHaveBeenCalledWith('user-1');
    expect(mockedApiClient.listFlaggedContent).toHaveBeenCalled();
  });

  it('handles badge grant workflow through the modal', async () => {
    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /alice/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('row', { name: /alice/i }));
    await waitFor(() => expect(screen.getByText(/Content pieces:/)).toBeInTheDocument());

    const grantButton = screen.getByRole('button', { name: /Grant Badge/i });
    await userEvent.click(grantButton);

    const modal = await screen.findByRole('dialog');
    const badgeSelect = within(modal).getByLabelText(/Badge Type/i);
    await userEvent.selectOptions(badgeSelect, 'hero');

    const reasonField = within(modal).getByLabelText(/Reason/i);
    await userEvent.type(reasonField, 'Outstanding work');

    await userEvent.click(within(modal).getByRole('button', { name: /Confirm/i }));

    await waitFor(() =>
      expect(mockedApiClient.grantBadge).toHaveBeenCalledWith({
        userId: 'user-1',
        badgeType: 'hero',
        reason: 'Outstanding work',
      })
    );
  });

  it('shows user detail fetch errors when API fails', async () => {
    mockedApiClient.getAdminUser.mockRejectedValueOnce(new Error('Detail unavailable'));

    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /alice/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('row', { name: /alice/i }));

    expect(await screen.findByText(/Detail unavailable/i)).toBeInTheDocument();
  });

  it('uses default message when user detail rejection is not an Error', async () => {
    mockedApiClient.getAdminUser.mockRejectedValueOnce('oops');

    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /alice/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('row', { name: /alice/i }));

    expect(await screen.findByText(/Failed to load user details/i)).toBeInTheDocument();
  });

  it('exports user list to CSV', async () => {
    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /Export CSV/i })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: /Export CSV/i }));

    await waitFor(() => expect(mockedApiClient.exportUsersCsv).toHaveBeenCalledTimes(1));
    expect(mockedDownload).toHaveBeenCalledWith(expect.any(Blob), 'users.csv');
    expect(mockedApiClient.trackAnalyticsEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'export',
        metadata: expect.objectContaining({ type: 'user_list', exportFormat: 'csv' }),
      })
    );
  });

  it('falls back to default export error message for non-error rejections', async () => {
    mockedApiClient.exportUsersCsv.mockRejectedValueOnce('nope');

    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /Export CSV/i })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: /Export CSV/i }));

    expect(await screen.findByText(/Failed to export user list/i)).toBeInTheDocument();
  });

  it('toggles AWS employee status for the selected user', async () => {
    mockedApiClient.setAwsEmployee.mockResolvedValueOnce({ success: true });

    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /alice/i })).toBeInTheDocument());

    const aliceRow = screen.getByRole('row', { name: /alice/i });
    await userEvent.click(aliceRow);

    const toggleButton = await screen.findByRole('button', { name: /Mark as AWS Employee/i });
    await userEvent.click(toggleButton);

    await waitFor(() =>
      expect(mockedApiClient.setAwsEmployee).toHaveBeenCalledWith('user-1', {
        isAwsEmployee: true,
        reason: 'Toggled by admin admin',
      })
    );

    await waitFor(() => expect(mockedApiClient.listAdminUsers).toHaveBeenCalledTimes(2));
    expect(mockedApiClient.getAdminUser).toHaveBeenCalledWith('user-1');
  });

  it('performs bulk badge operations for selected users', async () => {
    mockedApiClient.bulkBadges.mockResolvedValueOnce({
      summary: { successful: 2, failed: 0, total: 2 },
      failed: [],
    } as any);

    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    const selectAll = screen.getByRole('checkbox', { name: /Select all users/i });
    await userEvent.click(selectAll);

    await userEvent.click(screen.getByRole('button', { name: /Bulk Grant/i }));

    const modal = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(modal).getByLabelText(/Badge Type/i), 'hero');
    await userEvent.click(within(modal).getByRole('button', { name: /Confirm/i }));

    await waitFor(() =>
      expect(mockedApiClient.bulkBadges).toHaveBeenCalledWith({
        operation: 'grant',
        userIds: ['user-1', 'user-2'],
        badgeType: 'hero',
        reason: undefined,
      })
    );
    await waitFor(() =>
      expect(screen.getByText(/Bulk badge operation completed successfully\./i)).toBeInTheDocument()
    );
  });

  it('applies search filters and supports clearing them', async () => {
    renderUsersPage();
    await waitFor(() => expect(screen.getByLabelText(/Search/i)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/Search/i), 'builder');
    await userEvent.selectOptions(screen.getByLabelText(/Badge Filter/i), 'hero');

    await userEvent.click(screen.getByRole('button', { name: /Apply/i }));

    await waitFor(() => {
      expect(mockedApiClient.listAdminUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({
          search: 'builder',
          badgeType: 'hero',
          limit: 25,
          offset: 0,
        })
      );
    });

  await userEvent.click(screen.getByRole('button', { name: /Clear/i }));

  await waitFor(() => {
    expect(mockedApiClient.listAdminUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: undefined,
        badgeType: undefined,
        limit: 25,
        offset: 0,
      })
    );
  });
  expect((screen.getByLabelText(/Search/i) as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText(/Badge Filter/i) as HTMLSelectElement).value).toBe('');
});

  it('shows empty state when no users match filters', async () => {
    mockedApiClient.listAdminUsers.mockResolvedValueOnce({ ...listResponse, users: [], total: 0 });

    renderUsersPage();

    expect(await screen.findByText(/No users found for the given filters/i)).toBeInTheDocument();
  });

  it('displays API errors when user list request fails', async () => {
    mockedApiClient.listAdminUsers.mockRejectedValueOnce(new Error('Database offline'));

    renderUsersPage();

    expect(await screen.findByText(/Database offline/i)).toBeInTheDocument();
  });

  it('falls back to generic error text when user list rejects non-error values', async () => {
    mockedApiClient.listAdminUsers.mockRejectedValueOnce('boom');

    renderUsersPage();

    expect(await screen.findByText(/Failed to load users/i)).toBeInTheDocument();
  });

  it('surfaces export errors without crashing the page', async () => {
    mockedApiClient.exportUsersCsv.mockRejectedValueOnce(new Error('Export failed'));

    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /Export CSV/i })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: /Export CSV/i }));

    expect(await screen.findByText(/Export failed/i)).toBeInTheDocument();
    expect(mockedDownload).not.toHaveBeenCalled();
  });

  it('shows failure message when AWS employee toggle fails', async () => {
    mockedApiClient.setAwsEmployee.mockRejectedValueOnce(new Error('Permission denied'));

    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /alice/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('row', { name: /alice/i }));
    const toggleButton = await screen.findByRole('button', { name: /Mark as AWS Employee/i });
    await userEvent.click(toggleButton);

    expect(await screen.findByText(/Permission denied/i)).toBeInTheDocument();
  });

  it('falls back to default AWS employee error message when rejection is non-error', async () => {
    mockedApiClient.setAwsEmployee.mockRejectedValueOnce('denied');

    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /alice/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('row', { name: /alice/i }));
    const toggleButton = await screen.findByRole('button', { name: /Mark as AWS Employee/i });
    await userEvent.click(toggleButton);

    expect(await screen.findByText(/Failed to update AWS employee status/i)).toBeInTheDocument();
  });

  it('allows toggling individual user selections via checkboxes', async () => {
    renderUsersPage();
    await waitFor(() => expect(screen.getByLabelText(/Select alice/i)).toBeInTheDocument());

    const checkbox = screen.getByLabelText(/Select alice/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    await userEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    await userEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it('allows revoking a badge through the modal', async () => {
    mockedApiClient.getAdminUser.mockResolvedValueOnce({
      ...detailResponse,
      badges: [
        {
          badgeType: 'hero',
          awardedAt: new Date().toISOString(),
        },
      ],
    });

    renderUsersPage();
    await waitFor(() => screen.getByRole('row', { name: /alice/i }));

    await userEvent.click(screen.getByRole('row', { name: /alice/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Revoke Badge/i })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: /Revoke Badge/i }));

    const modal = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(modal).getByLabelText(/Badge Type/i), 'hero');
    await userEvent.click(within(modal).getByRole('button', { name: /Confirm/i }));

    await waitFor(() =>
      expect(mockedApiClient.revokeBadge).toHaveBeenCalledWith({
        userId: 'user-1',
        badgeType: 'hero',
        reason: undefined,
      })
    );
  });

  it('notifies when bulk badge action is confirmed without selections', async () => {
    mockedApiClient.bulkBadges.mockResolvedValueOnce({ failed: [], summary: { successful: 0, failed: 0, total: 0 } } as any);

    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Select all users/i })).toBeInTheDocument());

    const selectAll = screen.getByRole('checkbox', { name: /Select all users/i });
    await userEvent.click(selectAll);

    await userEvent.click(screen.getByRole('button', { name: /Bulk Grant/i }));

    const modal = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(modal).getByLabelText(/Badge Type/i), 'hero');

    await userEvent.click(screen.getByRole('checkbox', { name: /Select all users/i }));

    await userEvent.click(within(modal).getByRole('button', { name: /Confirm/i }));

    await waitFor(() =>
      expect(screen.getByText(/Select at least one user for bulk badge updates\./i)).toBeInTheDocument()
    );
    expect(mockedApiClient.bulkBadges).not.toHaveBeenCalled();
  });

  it('surfaces partial failure details for bulk revoke operations', async () => {
    mockedApiClient.bulkBadges.mockResolvedValueOnce({
      summary: { successful: 1, failed: 1, total: 2 },
      failed: [{ userId: 'user-2', success: false, error: 'Badge not found' }],
    } as any);

    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Select all users/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('checkbox', { name: /Select all users/i }));
    const userActions = screen.getByRole('heading', { name: /Users/i }).closest('section')!;
    await userEvent.click(within(userActions).getByRole('button', { name: /Bulk Revoke/i }));

    const modal = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(modal).getByLabelText(/Badge Type/i), 'hero');
    await userEvent.click(within(modal).getByRole('button', { name: /Confirm/i }));

    await waitFor(() => expect(mockedApiClient.bulkBadges).toHaveBeenCalled());
    expect(mockedApiClient.listAdminUsers).toHaveBeenCalledTimes(2);
  });

  it('handles bulk badge operation failures gracefully', async () => {
    mockedApiClient.bulkBadges.mockRejectedValueOnce('API unavailable');

    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Select all users/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('checkbox', { name: /Select all users/i }));
    const userActions = screen.getByRole('heading', { name: /Users/i }).closest('section')!;
    await userEvent.click(within(userActions).getByRole('button', { name: /Bulk Grant/i }));

    const modal = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(modal).getByLabelText(/Badge Type/i), 'hero');
    await userEvent.click(within(modal).getByRole('button', { name: /Confirm/i }));

    const initialCallCount = mockedApiClient.listAdminUsers.mock.calls.length;

    await waitFor(() => expect(mockedApiClient.bulkBadges).toHaveBeenCalled());
    expect(mockedApiClient.listAdminUsers.mock.calls.length).toBe(initialCallCount);
  });

  it('applies moderation actions for flagged content', async () => {
    mockedApiClient.moderateContent.mockResolvedValue(undefined as unknown as any);

    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /alice/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('row', { name: /alice/i }));
    const flaggedItem = await screen.findByText('Flagged blog');
    const flaggedCard = flaggedItem.closest('li')!;

    await userEvent.click(within(flaggedCard).getByRole('button', { name: /Approve/i }));
    await userEvent.click(within(flaggedCard).getByRole('button', { name: /Remove/i }));

    expect(mockedApiClient.moderateContent).toHaveBeenCalledWith('content-1', 'approve');
    expect(mockedApiClient.moderateContent).toHaveBeenCalledWith('content-1', 'remove');
  });

  it('shows empty flagged content state when no items exist', async () => {
    mockedApiClient.listFlaggedContent.mockResolvedValueOnce({ ...flaggedContentResponse, content: [], total: 0 });

    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /alice/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('row', { name: /alice/i }));

    expect(await screen.findByText(/No flagged content for this user/i)).toBeInTheDocument();
  });

  it('surfaces moderation errors when approve/remove fail', async () => {
    mockedApiClient.moderateContent.mockRejectedValueOnce(new Error('Approve denied'));

    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /alice/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('row', { name: /alice/i }));
    const flaggedItem = await screen.findByText('Flagged blog');
    const flaggedCard = flaggedItem.closest('li')!;

    await userEvent.click(within(flaggedCard).getByRole('button', { name: /Approve/i }));
    expect(await screen.findByText(/Failed to approve content/i)).toBeInTheDocument();

    mockedApiClient.moderateContent.mockRejectedValueOnce('Removal denied');
    await userEvent.click(within(flaggedCard).getByRole('button', { name: /Remove/i }));
    expect(await screen.findByText(/Failed to remove content/i)).toBeInTheDocument();
  });

  it('supports pagination controls', async () => {
    mockedApiClient.listAdminUsers
      .mockResolvedValueOnce({ ...listResponse, offset: 0 })
      .mockResolvedValueOnce({ ...listResponse, offset: 25 })
      .mockResolvedValueOnce({ ...listResponse, offset: 0 });

    renderUsersPage();
    const usersSection = screen.getByRole('heading', { name: /Users/i }).closest('section')!;
    const usersNext = within(usersSection).getByRole('button', { name: /Next/i });
    const usersPrev = within(usersSection).getByRole('button', { name: /Previous/i });

    await waitFor(() => expect(usersNext).toBeEnabled());

    await userEvent.click(usersNext);
    await waitFor(() => {
      const lastCall = mockedApiClient.listAdminUsers.mock.calls.at(-1)?.[0] ?? {};
      expect(lastCall.offset).toBe(25);
      expect(lastCall.limit).toBe(25);
    });

    await userEvent.click(usersPrev);
    await waitFor(() => {
      const lastCall = mockedApiClient.listAdminUsers.mock.calls.at(-1)?.[0] ?? {};
      expect(lastCall.offset).toBe(0);
    });
  });

  it('surfaces selection requirement when opening bulk modal with no badge type', async () => {
    mockedApiClient.bulkBadges.mockResolvedValueOnce({ failed: [], summary: { successful: 0, failed: 0, total: 0 } } as any);

    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Select all users/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('checkbox', { name: /Select all users/i }));
    const userActions = screen.getByRole('heading', { name: /Users/i }).closest('section')!;
    await userEvent.click(within(userActions).getByRole('button', { name: /Bulk Grant/i }));

    const modal = await screen.findByRole('dialog');
    await userEvent.click(within(modal).getByRole('button', { name: /Confirm/i }));

    await waitFor(() => expect(mockedApiClient.bulkBadges).not.toHaveBeenCalled());
    expect(await screen.findByText(/Badge type is required\./i)).toBeInTheDocument();
  });

  it('prevents badge actions when the selected user disappears during refresh', async () => {
    mockedApiClient.listAdminUsers
      .mockResolvedValueOnce(listResponse)
      .mockResolvedValueOnce({ ...listResponse, users: [], total: 0 });

    renderUsersPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /alice/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('row', { name: /alice/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Grant Badge/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /Grant Badge/i }));

    const modal = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(modal).getByLabelText(/Badge Type/i), 'hero');

    await userEvent.click(screen.getByRole('button', { name: /Clear/i }));
    await waitFor(() => expect(mockedApiClient.listAdminUsers).toHaveBeenCalledTimes(2));

    await userEvent.click(within(modal).getByRole('button', { name: /Confirm/i }));

    expect(mockedApiClient.grantBadge).not.toHaveBeenCalled();
    expect(await screen.findByText(/Select a user before updating badges/i)).toBeInTheDocument();
  });
});
