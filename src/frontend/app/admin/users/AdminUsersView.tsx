'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AdminUserListResponse,
  AdminUserSummary,
  AdminUserDetail,
  FlaggedContentItem,
  AdminBulkBadgeResult,
} from '@/api';
import { BadgeType } from '@shared/types';
import { downloadBlob } from '@/utils/download';
import { useAdminContext } from '../context';

type BadgeActionMode = 'grant' | 'revoke' | 'bulk-grant' | 'bulk-revoke';

const BADGE_LABELS: Record<BadgeType, string> = {
  [BadgeType.COMMUNITY_BUILDER]: 'Community Builder',
  [BadgeType.HERO]: 'Hero',
  [BadgeType.AMBASSADOR]: 'Ambassador',
  [BadgeType.USER_GROUP_LEADER]: 'User Group Leader',
};

const USER_LOST_MESSAGE = 'Selected user is no longer available. Please choose another user.';
const USER_REQUIRED_MESSAGE = 'Select a user before updating badges.';

export default function AdminUsersPage(): JSX.Element {
  const getSharedApiClient = useCallback(async () => {
    const { loadSharedApiClient } = await import('@/lib/api/lazyClient');
    return loadSharedApiClient();
  }, []);

  const { currentUser } = useAdminContext();

  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [pagination, setPagination] = useState({ total: 0, limit: 25, offset: 0 });
  const [search, setSearch] = useState('');
  const [badgeFilter, setBadgeFilter] = useState<BadgeType | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUserDetail | null>(null);
  const [selectedUserLoading, setSelectedUserLoading] = useState(false);
  const [selectedUserContent, setSelectedUserContent] = useState<FlaggedContentItem[]>([]);

  const [badgeModal, setBadgeModal] = useState<{
    open: boolean;
    mode: BadgeActionMode;
    badgeType: BadgeType | '';
    reason: string;
  }>({
    open: false,
    mode: 'grant',
    badgeType: '',
    reason: '',
  });

  const [awsEmployeeUpdating, setAwsEmployeeUpdating] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadUsers = useCallback(
    async (offset = 0) => {
      setLoading(true);
      setError(null);
      try {
        const client = await getSharedApiClient();
        const response: AdminUserListResponse = await client.listAdminUsers({
          search: search || undefined,
          badgeType: badgeFilter || undefined,
          limit: pagination.limit,
          offset,
        });
        setUsers(response.users);
        setPagination(prev => ({
          ...prev,
          total: response.total,
          offset: response.offset,
        }));

        let selectionCleared = false;
        setSelectedUser(prev => {
          if (prev && !response.users.some(user => user.id === prev.user.id)) {
            selectionCleared = true;
            return null;
          }
          return prev;
        });
        if (selectionCleared) {
          setSelectedUserContent([]);
          setActionMessage(USER_LOST_MESSAGE);
        }

        setSelectedUserIds(prev =>
          prev.filter(id => response.users.some(user => user.id === id))
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load users');
      } finally {
        setLoading(false);
      }
    },
    [getSharedApiClient, search, badgeFilter, pagination.limit]
  );

  useEffect(() => {
    loadUsers(0);
  }, [loadUsers]);

  const loadUserDetails = useCallback(
    async (userId: string, options?: { preserveActionMessage?: boolean }) => {
      setSelectedUserLoading(true);
      if (!options?.preserveActionMessage) {
        setActionMessage(null);
      }
      try {
        const client = await getSharedApiClient();
        const detail = await client.getAdminUser(userId);
        setSelectedUser(detail);

        // fetch flagged content for this user
        const flaggedContent = await client.listFlaggedContent({ limit: 100, offset: 0 });
        setSelectedUserContent(
          flaggedContent.content.filter(content => content.user.id === userId)
        );
      } catch (err) {
        setActionMessage(err instanceof Error ? err.message : 'Failed to load user details');
      } finally {
        setSelectedUserLoading(false);
      }
    },
    [getSharedApiClient]
  );

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    loadUsers(0);
  };

  const toggleSelectAll = () => {
    if (selectedUserIds.length === users.length) {
      setSelectedUserIds([]);
    } else {
      setSelectedUserIds(users.map(user => user.id));
    }
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const openBadgeModal = (mode: BadgeActionMode, badgeType?: BadgeType) => {
    setBadgeModal({
      open: true,
      mode,
      badgeType: badgeType ?? '',
      reason: '',
    });
  };

  const closeBadgeModal = () => {
    setBadgeModal(prev => ({ ...prev, open: false, reason: '', badgeType: '' }));
  };

  const handleBadgeAction = async () => {
    if (!badgeModal.badgeType) {
      setActionMessage('Badge type is required.');
      return;
    }

    try {
      const client = await getSharedApiClient();
      if (badgeModal.mode === 'grant') {
        if (!selectedUser) {
          setActionMessage(USER_REQUIRED_MESSAGE);
          return;
        }
        await client.grantBadge({
          userId: selectedUser.user.id,
          badgeType: badgeModal.badgeType,
          reason: badgeModal.reason || undefined,
        });
        setActionMessage('Badge granted successfully.');
        await loadUserDetails(selectedUser.user.id, { preserveActionMessage: true });
      } else if (badgeModal.mode === 'revoke') {
        if (!selectedUser) {
          setActionMessage(USER_REQUIRED_MESSAGE);
          return;
        }
        await client.revokeBadge({
          userId: selectedUser.user.id,
          badgeType: badgeModal.badgeType,
          reason: badgeModal.reason || undefined,
        });
        setActionMessage('Badge revoked successfully.');
        await loadUserDetails(selectedUser.user.id, { preserveActionMessage: true });
      } else {
        if (selectedUserIds.length === 0) {
          setActionMessage('Select at least one user for bulk badge updates.');
          return;
        }

        const result: AdminBulkBadgeResult = await client.bulkBadges({
          operation: badgeModal.mode === 'bulk-grant' ? 'grant' : 'revoke',
          userIds: selectedUserIds,
          badgeType: badgeModal.badgeType,
          reason: badgeModal.reason || undefined,
        });

        const failedCount = result.failed.length;
        if (failedCount > 0) {
          setActionMessage(
            `${result.summary.successful} succeeded, ${failedCount} failed. Review audit log for details.`
          );
        } else {
          setActionMessage('Bulk badge operation completed successfully.');
        }

        await loadUsers(pagination.offset);
        if (selectedUser && selectedUserIds.includes(selectedUser.user.id)) {
          await loadUserDetails(selectedUser.user.id, { preserveActionMessage: true });
        }
      }
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Badge operation failed');
    } finally {
      closeBadgeModal();
    }
  };

  const handleExportUsers = async () => {
    try {
      const client = await getSharedApiClient();
      const { blob, filename } = await client.exportUsersCsv();
      downloadBlob(blob, filename ?? 'users.csv');
      setActionMessage('User export generated successfully.');
      client
        .trackAnalyticsEvents({
          eventType: 'export',
          metadata: {
            type: 'user_list',
            exportFormat: 'csv',
          },
        })
        .catch(() => {});
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Failed to export user list');
    }
  };

  const toggleAwsEmployee = async (user: AdminUserDetail['user']) => {
    setAwsEmployeeUpdating(true);
    setActionMessage(null);
    try {
      const client = await getSharedApiClient();
      await client.setAwsEmployee(user.id, {
        isAwsEmployee: !user.isAwsEmployee,
        reason: `Toggled by admin ${currentUser?.username ?? 'system'}`,
      });
      setActionMessage('AWS employee status updated.');
      await loadUsers(pagination.offset);
      await loadUserDetails(user.id, { preserveActionMessage: true });
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Failed to update AWS employee status');
    } finally {
      setAwsEmployeeUpdating(false);
    }
  };

  const handlePageChange = (direction: 'next' | 'prev') => {
    const newOffset =
      direction === 'next'
        ? pagination.offset + pagination.limit
        : Math.max(0, pagination.offset - pagination.limit);
    loadUsers(newOffset);
  };

  const totalPages = Math.ceil(pagination.total / pagination.limit);
  const currentPage = pagination.offset / pagination.limit + 1;

  const badgeOptions = useMemo(() => Object.values(BadgeType), []);

  return (
    <div className="space-y-6">
      <header className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">User Management</h1>
        <p className="mt-1 text-sm text-gray-500">
          Search, filter, and manage community members, badges, and administrative actions.
        </p>
        <form onSubmit={handleSearchSubmit} className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="search" className="block text-sm font-medium text-gray-700">
              Search
            </label>
            <input
              id="search"
              name="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search by username or email"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="badge-filter" className="block text-sm font-medium text-gray-700">
              Badge Filter
            </label>
            <select
              id="badge-filter"
              name="badge-filter"
              value={badgeFilter}
              onChange={event => setBadgeFilter(event.target.value as BadgeType | '')}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All badges</option>
              {badgeOptions.map(badge => (
                <option key={badge} value={badge}>
                  {BADGE_LABELS[badge]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end justify-end space-x-3">
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setBadgeFilter('');
                loadUsers(0);
              }}
              className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            >
              Clear
            </button>
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              Apply
            </button>
          </div>
        </form>
      </header>

      {actionMessage && (
        <div className="rounded border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {actionMessage}
        </div>
      )}

      {error && (
        <div className="rounded border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Users</h2>
            <p className="text-xs text-gray-500">
              {pagination.total.toLocaleString()} total users. Page {currentPage} of {totalPages || 1}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openBadgeModal('grant')}
              disabled={!selectedUser}
              className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Grant Badge
            </button>
            <button
              type="button"
              onClick={() => openBadgeModal('revoke')}
              disabled={!selectedUser}
              className="inline-flex items-center rounded border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Revoke Badge
            </button>
            <button
              type="button"
              onClick={() => openBadgeModal('bulk-grant')}
              disabled={selectedUserIds.length === 0}
              className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Bulk Grant
            </button>
            <button
              type="button"
              onClick={() => openBadgeModal('bulk-revoke')}
              disabled={selectedUserIds.length === 0}
              className="inline-flex items-center rounded border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Bulk Revoke
            </button>
            <button
              type="button"
              onClick={handleExportUsers}
              className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Export CSV
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-3 py-3 text-left">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    checked={selectedUserIds.length === users.length && users.length > 0}
                    onChange={toggleSelectAll}
                    aria-label="Select all users"
                  />
                </th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500">
                  Username
                </th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500">
                  Email
                </th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500">
                  AWS Employee
                </th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500">
                  Roles
                </th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500">
                  Joined
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                    Loading users…
                  </td>
                </tr>
              )}
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                    No users found for the given filters.
                  </td>
                </tr>
              )}
              {users.map(user => {
                const isSelected = selectedUserIds.includes(user.id);
                const isActive = selectedUser?.user.id === user.id;
                return (
                  <tr
                    key={user.id}
                    className={`cursor-pointer hover:bg-blue-50 ${isActive ? 'bg-blue-50/80' : ''}`}
                    onClick={() => loadUserDetails(user.id)}
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={event => {
                          event.stopPropagation();
                          toggleUserSelection(user.id);
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        aria-label={`Select ${user.username}`}
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-900">{user.username}</td>
                    <td className="px-4 py-3 text-gray-500" aria-label={`Email ${user.email}`}>
                      <span aria-hidden="true">{user.email.replace('@', '@\u200B')}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          user.isAwsEmployee ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {user.isAwsEmployee ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          user.isAdmin ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {user.isAdmin ? 'Administrator' : 'Contributor'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-500">
          <div>
            Page {currentPage} of {totalPages || 1}
          </div>
          <div className="space-x-3">
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => handlePageChange('prev')}
              disabled={pagination.offset === 0}
            >
              Previous
            </button>
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => handlePageChange('next')}
              disabled={pagination.offset + pagination.limit >= pagination.total}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">User Profile</h3>
            {selectedUserLoading && (
              <p className="mt-2 text-sm text-gray-500">Loading user details…</p>
            )}
            {!selectedUserLoading && !selectedUser && (
              <p className="mt-2 text-sm text-gray-500">
                Select a user from the table to view their profile, badges, and content overview.
              </p>
            )}
            {selectedUser && (
              <div className="mt-4 space-y-4">
                <div className="rounded border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
                  <p className="text-gray-700">
                    <span className="font-medium text-gray-900">Username:</span> {selectedUser.user.username}
                  </p>
                  <p className="text-gray-700">
                    <span className="font-medium text-gray-900">Email:</span> {selectedUser.user.email}
                  </p>
                  <p className="text-gray-700">
                    <span className="font-medium text-gray-900">Content pieces:</span>{' '}
                    {selectedUser.contentCount.toLocaleString()}
                  </p>
                  <button
                    type="button"
                    onClick={() => toggleAwsEmployee(selectedUser.user)}
                    className="mt-3 inline-flex items-center rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={awsEmployeeUpdating}
                  >
                    {selectedUser.user.isAwsEmployee ? 'Remove AWS Employee' : 'Mark as AWS Employee'}
                  </button>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">Active Badges</h4>
                  {selectedUser.badges.length === 0 ? (
                    <p className="mt-1 text-sm text-gray-500">No badges granted yet.</p>
                  ) : (
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {selectedUser.badges.map(badge => (
                        <li
                          key={`${badge.badgeType}-${badge.awardedAt}`}
                          className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700"
                        >
                          {BADGE_LABELS[badge.badgeType]} &middot;{' '}
                          {new Date(badge.awardedAt).toLocaleDateString()}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Flagged Content</h3>
          <p className="text-sm text-gray-500">
            Content items authored by the selected user that require moderation.
          </p>
          {selectedUserContent.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No flagged content for this user.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {selectedUserContent.map(item => (
                <li key={item.id} className="rounded border border-red-100 bg-red-50 px-4 py-3 text-sm">
                  <p className="font-medium text-red-700">{item.title}</p>
                  <p className="text-xs text-red-600">
                    {item.flagReason || 'Flagged for review'} ·{' '}
                    {item.flaggedAt ? new Date(item.flaggedAt).toLocaleString() : 'Pending timestamp'}
                  </p>
                  <p className="mt-1 text-xs text-gray-600">
                    Visibility: {item.visibility} &middot; Status: {item.moderationStatus}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                      onClick={async () => {
                        try {
                          const client = await getSharedApiClient();
                          await client.moderateContent(item.id, 'approve');
                          await loadUserDetails(selectedUser!.user.id);
                        } catch (err) {
                          setActionMessage('Failed to approve content.');
                        }
                      }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                      onClick={async () => {
                        try {
                          const client = await getSharedApiClient();
                          await client.moderateContent(item.id, 'remove');
                          await loadUserDetails(selectedUser!.user.id);
                        } catch (err) {
                          setActionMessage('Failed to remove content.');
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <a
            href="/admin/moderation"
            className="mt-4 inline-flex items-center text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            View all flagged content &rarr;
          </a>
        </div>
      </section>

      <BadgeModal
        open={badgeModal.open}
        mode={badgeModal.mode}
        badgeType={badgeModal.badgeType}
        reason={badgeModal.reason}
        onClose={closeBadgeModal}
        onChangeBadgeType={badgeType => setBadgeModal(prev => ({ ...prev, badgeType }))}
        onChangeReason={reason => setBadgeModal(prev => ({ ...prev, reason }))}
        onSubmit={handleBadgeAction}
      />
    </div>
  );
}

function BadgeModal({
  open,
  mode,
  badgeType,
  reason,
  onClose,
  onChangeBadgeType,
  onChangeReason,
  onSubmit,
}: {
  open: boolean;
  mode: BadgeActionMode;
  badgeType: BadgeType | '';
  reason: string;
  onClose: () => void;
  onChangeBadgeType: (value: BadgeType) => void;
  onChangeReason: (value: string) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  const titleMap: Record<BadgeActionMode, string> = {
    grant: 'Grant Badge',
    revoke: 'Revoke Badge',
    'bulk-grant': 'Bulk Grant Badges',
    'bulk-revoke': 'Bulk Revoke Badges',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="badge-modal-title"
      aria-describedby="badge-modal-description"
    >
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
        <h3 id="badge-modal-title" className="text-lg font-semibold text-gray-900">
          {titleMap[mode]}
        </h3>
        <p id="badge-modal-description" className="mt-1 text-sm text-gray-500">
          Select the badge type and provide an optional reason for audit logging.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="modal-badge-type" className="block text-sm font-medium text-gray-700">
              Badge Type
            </label>
            <select
              id="modal-badge-type"
              value={badgeType}
              onChange={event => onChangeBadgeType(event.target.value as BadgeType)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Select badge type</option>
              {Object.values(BadgeType).map(option => (
                <option key={option} value={option}>
                  {BADGE_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="modal-reason" className="block text-sm font-medium text-gray-700">
              Reason (optional)
            </label>
            <textarea
              id="modal-reason"
              value={reason}
              onChange={event => onChangeReason(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Provide context for audit log (optional)"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
