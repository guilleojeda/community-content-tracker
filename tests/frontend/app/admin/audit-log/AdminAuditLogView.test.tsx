import React from 'react';
import { render, screen, waitFor, fireEvent, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminAuditLogView from '@/app/admin/audit-log/AdminAuditLogView';
import type { AuditLogEntry } from '@/api';

jest.mock('@/lib/api/lazyClient', () => ({
  loadSharedApiClient: jest.fn(),
}));

const mockLoadSharedApiClient = require('@/lib/api/lazyClient')
  .loadSharedApiClient as jest.MockedFunction<typeof import('@/lib/api/lazyClient').loadSharedApiClient>;

type AuditResponse = {
  entries: AuditLogEntry[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
};

const defaultEntry = (): AuditLogEntry => ({
  id: 'entry-1',
  actionType: 'grant_badge',
  createdAt: '2024-03-01T15:00:00.000Z',
  adminUser: {
    id: 'admin-1',
    username: 'auditor',
    email: 'auditor@example.com',
  },
  targetUser: {
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
  },
  details: { badgeType: 'hero' },
  ipAddress: '10.0.0.1',
});

function mockClientWithResponses(...responses: AuditResponse[]) {
  const client = {
    listAuditLog: jest.fn(),
  };
  let callCount = 0;
  client.listAuditLog.mockImplementation(() => {
    const index = Math.min(callCount, Math.max(responses.length - 1, 0));
    callCount += 1;
    return Promise.resolve(responses[index]);
  });

  mockLoadSharedApiClient.mockResolvedValue(client as any);
  return client;
}

describe('AdminAuditLogView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders audit entries and pagination summary', async () => {
    mockClientWithResponses({
      entries: [defaultEntry()],
      pagination: { total: 40, limit: 25, offset: 0, hasMore: true },
    });

    render(<AdminAuditLogView />);

    await waitFor(() => expect(screen.getByText(/audit log/i)).toBeInTheDocument());
    expect(screen.getByText(/auditor \(admin-1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/auditor@example.com/i)).toBeInTheDocument();
    expect(screen.getByText(/alice \(user-1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Badge: hero/i)).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Next/i })).toBeEnabled();
  });

  it('applies filters and reloads entries', async () => {
    const client = mockClientWithResponses(
      {
        entries: [defaultEntry()],
        pagination: { total: 1, limit: 25, offset: 0, hasMore: false },
      },
      {
        entries: [
          {
            ...defaultEntry(),
            id: 'entry-2',
            actionType: 'revoke_badge',
            details: { reason: 'policy violation' },
          },
        ],
        pagination: { total: 1, limit: 25, offset: 0, hasMore: false },
      }
    );

    render(<AdminAuditLogView />);

    await waitFor(() => expect(client.listAuditLog).toHaveBeenCalledTimes(1));

    await userEvent.selectOptions(screen.getByLabelText(/Action Type/i), 'grant_badge');
    fireEvent.change(screen.getByLabelText(/Admin User ID/i), { target: { value: 'admin-2' } });
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2024-01-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2024-01-31' } });

    await userEvent.click(screen.getByRole('button', { name: /Apply Filters/i }));

    await waitFor(() =>
      expect(client.listAuditLog).toHaveBeenLastCalledWith({
        actionType: 'grant_badge',
        adminUserId: 'admin-2',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        limit: 25,
        offset: 0,
      })
    );

    expect(screen.getByText(/policy violation/i)).toBeInTheDocument();
  });

  it('pages through history using pagination controls', async () => {
    const client = mockClientWithResponses(
      {
        entries: [defaultEntry()],
        pagination: { total: 60, limit: 25, offset: 0, hasMore: true },
      },
      {
        entries: [
          {
            ...defaultEntry(),
            id: 'entry-3',
            actionType: 'flag_content',
            details: { contentTitle: 'Suspicious post' },
          },
        ],
        pagination: { total: 60, limit: 25, offset: 25, hasMore: true },
      }
    );

    render(<AdminAuditLogView />);

    await waitFor(() => expect(client.listAuditLog).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() =>
      expect(client.listAuditLog).toHaveBeenLastCalledWith({
        limit: 25,
        offset: 25,
      })
    );

    expect(screen.getByText(/Suspicious post/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Previous/i })).toBeEnabled();
  });

  it('shows empty state when no audit entries exist', async () => {
    const client = mockClientWithResponses({
      entries: [],
      pagination: { total: 0, limit: 25, offset: 0, hasMore: false },
    });

    render(<AdminAuditLogView />);

    await waitFor(() => expect(client.listAuditLog).toHaveBeenCalled());
    const loadingRow = screen.queryByText(/Loading audit log/i);
    if (loadingRow) {
      await waitForElementToBeRemoved(() => loadingRow);
    }
    expect(await screen.findByText(/No audit entries found for the selected filters/i)).toBeInTheDocument();
  });

  it('renders error message when loading fails', async () => {
    const client = {
      listAuditLog: jest.fn().mockRejectedValue(new Error('network down')),
    };
    mockLoadSharedApiClient.mockResolvedValue(client as any);

    render(<AdminAuditLogView />);

    await waitFor(() => expect(screen.getByText(/network down/i)).toBeInTheDocument());
  });

  it('uses default error text when audit log rejects with non-error', async () => {
    const client = {
      listAuditLog: jest.fn().mockRejectedValue('boom'),
    };
    mockLoadSharedApiClient.mockResolvedValue(client as any);

    render(<AdminAuditLogView />);

    await waitFor(() => expect(screen.getByText(/Failed to load audit log/i)).toBeInTheDocument());
  });

  it('renders fallback labels for unknown admin and target data', async () => {
    mockClientWithResponses({
      entries: [
        {
          ...defaultEntry(),
          adminUser: {
            id: 'admin-unknown',
            username: '',
            email: '',
          },
          targetUser: null,
          details: null,
          ipAddress: '',
        },
      ],
      pagination: { total: 1, limit: 25, offset: 0, hasMore: false },
    });

    render(<AdminAuditLogView />);

    expect(await screen.findByText(/Unknown \(admin-unknown\)/i)).toBeInTheDocument();
    const placeholderCells = screen.getAllByText('—');
    expect(placeholderCells.length).toBeGreaterThanOrEqual(2);
  });

  it('clears filters and reloads baseline parameters', async () => {
    const client = mockClientWithResponses(
      {
        entries: [defaultEntry()],
        pagination: { total: 10, limit: 25, offset: 0, hasMore: false },
      },
      {
        entries: [],
        pagination: { total: 0, limit: 25, offset: 0, hasMore: false },
      }
    );

    render(<AdminAuditLogView />);
    await waitFor(() => expect(client.listAuditLog).toHaveBeenCalledTimes(1));

    await userEvent.selectOptions(screen.getByLabelText(/Action Type/i), 'flag_content');
    fireEvent.change(screen.getByLabelText(/Admin User ID/i), { target: { value: 'admin-42' } });
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2024-02-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2024-02-29' } });

    const initialCalls = client.listAuditLog.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /Clear/i }));

    await waitFor(() => expect(client.listAuditLog.mock.calls.length).toBeGreaterThan(initialCalls));
    expect(client.listAuditLog).toHaveBeenLastCalledWith({
      actionType: undefined,
      adminUserId: undefined,
      startDate: undefined,
      endDate: undefined,
      limit: 25,
      offset: 0,
    });

    expect((screen.getByLabelText(/Action Type/i) as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText(/Admin User ID/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/Start Date/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/End Date/i) as HTMLInputElement).value).toBe('');
  });

  it('summarizes bulk operations and fallback detail fields', async () => {
    mockClientWithResponses({
      entries: [
        {
          ...defaultEntry(),
          id: 'bulk',
          actionType: 'bulk_badge',
          details: { operation: 'grant' },
        },
        {
          ...defaultEntry(),
          id: 'json',
          actionType: 'set_aws_employee',
          details: { custom: 'value' },
        },
        {
          ...defaultEntry(),
          id: 'none',
          actionType: 'delete_content',
          details: null,
        },
      ],
      pagination: { total: 3, limit: 25, offset: 0, hasMore: false },
    });

    render(<AdminAuditLogView />);

    expect(await screen.findByText(/grant \(\)/i)).toBeInTheDocument();
    expect(screen.getByText(/{"custom":"value"}/i)).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
