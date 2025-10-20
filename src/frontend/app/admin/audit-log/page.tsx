'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient, AuditLogEntry, AuditLogResponse } from '@/api';

const ACTION_TYPES = [
  'grant_badge',
  'revoke_badge',
  'bulk_badge',
  'set_aws_employee',
  'flag_content',
  'approve_content',
  'remove_content',
  'delete_content',
] as const;

type ActionTypeFilter = (typeof ACTION_TYPES)[number] | '';

export default function AdminAuditLogPage(): JSX.Element {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [filters, setFilters] = useState<{
    actionType: ActionTypeFilter;
    adminUserId: string;
    startDate?: string;
    endDate?: string;
    limit: number;
    offset: number;
  }>({
    actionType: '',
    adminUserId: '',
    limit: 25,
    offset: 0,
  });
  const [pagination, setPagination] = useState({ total: 0, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAuditLog = useCallback(
    async (override?: Partial<typeof filters>) => {
      setLoading(true);
      setError(null);
      try {
        const params = { ...filters, ...override };
        const response: AuditLogResponse = await apiClient.listAuditLog({
          actionType: params.actionType || undefined,
          adminUserId: params.adminUserId || undefined,
          startDate: params.startDate,
          endDate: params.endDate,
          limit: params.limit,
          offset: params.offset,
        });
        setEntries(response.entries);
        setPagination({
          total: response.pagination.total,
          hasMore: response.pagination.hasMore,
        });
        setFilters(prev => ({ ...prev, ...override }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load audit log');
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    loadAuditLog();
  }, [loadAuditLog]);

  const handleFilterSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    loadAuditLog({ offset: 0 });
  };

  const formattedEntries = useMemo(
    () =>
      entries.map(entry => ({
        ...entry,
        createdAtFormatted: new Date(entry.createdAt).toLocaleString(),
        actionLabel: entry.actionType.replace(/_/g, ' '),
        detailsSummary: summarizeDetails(entry.details),
      })),
    [entries]
  );

  const page = filters.offset / filters.limit + 1;
  const totalPages = Math.ceil(pagination.total / filters.limit);

  return (
    <div className="space-y-6">
      <header className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Admin Audit Log</h1>
        <p className="mt-1 text-sm text-gray-500">
          Track administrative actions for security, compliance, and review.
        </p>
        <form onSubmit={handleFilterSubmit} className="mt-4 grid gap-4 md:grid-cols-4">
          <div>
            <label htmlFor="action-type" className="block text-sm font-medium text-gray-700">
              Action Type
            </label>
            <select
              id="action-type"
              value={filters.actionType}
              onChange={event =>
                setFilters(prev => ({ ...prev, actionType: event.target.value as ActionTypeFilter }))
              }
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All actions</option>
              {ACTION_TYPES.map(action => (
                <option key={action} value={action}>
                  {action.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="admin-user" className="block text-sm font-medium text-gray-700">
              Admin User ID
            </label>
            <input
              id="admin-user"
              value={filters.adminUserId}
              onChange={event => setFilters(prev => ({ ...prev, adminUserId: event.target.value }))}
              placeholder="Filter by admin user ID"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="start-date" className="block text-sm font-medium text-gray-700">
              Start Date
            </label>
            <input
              id="start-date"
              type="date"
              value={filters.startDate || ''}
              onChange={event => setFilters(prev => ({ ...prev, startDate: event.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="end-date" className="block text-sm font-medium text-gray-700">
              End Date
            </label>
            <input
              id="end-date"
              type="date"
              value={filters.endDate || ''}
              onChange={event => setFilters(prev => ({ ...prev, endDate: event.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="md:col-span-4 flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => {
                setFilters(prev => ({
                  ...prev,
                  actionType: '',
                  adminUserId: '',
                  startDate: undefined,
                  endDate: undefined,
                }));
                loadAuditLog({ actionType: '', adminUserId: '', startDate: undefined, endDate: undefined, offset: 0 });
              }}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Clear
            </button>
            <button
              type="submit"
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Apply Filters
            </button>
          </div>
        </form>
      </header>

      {error && (
        <div className="rounded border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Timestamp</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Admin</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Action</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Target User</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Details</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                    Loading audit log…
                  </td>
                </tr>
              )}
              {!loading && formattedEntries.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                    No audit entries found for the selected filters.
                  </td>
                </tr>
              )}
              {formattedEntries.map(entry => (
                <tr key={entry.id} className="hover:bg-blue-50/50">
                  <td className="px-4 py-3 text-gray-700">{entry.createdAtFormatted}</td>
                  <td className="px-4 py-3">
                    <p className="text-gray-900">
                      {entry.adminUser.username || 'Unknown'} ({entry.adminUser.id})
                    </p>
                    <p className="text-xs text-gray-500">{entry.adminUser.email || '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-700 uppercase tracking-wide text-xs">
                    {entry.actionLabel}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {entry.targetUser
                      ? `${entry.targetUser.username || 'Unknown'} (${entry.targetUser.id})`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{entry.detailsSummary || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{entry.ipAddress || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-500">
          <div>
            Page {page} of {totalPages || 1}
          </div>
          <div className="space-x-3">
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => loadAuditLog({ offset: Math.max(0, filters.offset - filters.limit) })}
              disabled={filters.offset === 0}
            >
              Previous
            </button>
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => loadAuditLog({ offset: filters.offset + filters.limit })}
              disabled={!pagination.hasMore}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function summarizeDetails(details: Record<string, any> | null): string {
  if (!details) return '';

  if (details.reason) {
    return details.reason;
  }

  if (details.badgeType) {
    return `Badge: ${details.badgeType}`;
  }

  if (details.operation) {
    return `${details.operation} (${details.badgeType ?? ''})`;
  }

  if (details.contentTitle) {
    return details.contentTitle;
  }

  return JSON.stringify(details);
}
