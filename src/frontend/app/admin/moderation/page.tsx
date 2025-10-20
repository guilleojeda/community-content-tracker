'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { apiClient, FlaggedContentItem } from '@/api';
import { downloadBlob } from '@/utils/download';

type FilterStatus = 'all' | 'flagged' | 'pending' | 'removed';

export default function AdminModerationPage(): JSX.Element {
  const [content, setContent] = useState<FlaggedContentItem[]>([]);
  const [filteredStatus, setFilteredStatus] = useState<FilterStatus>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadFlaggedContent = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.listFlaggedContent({ limit: 100, offset: 0 });
      setContent(response.content);
      apiClient
        .trackAnalyticsEvents({
          eventType: 'page_view',
          metadata: { page: '/admin/moderation', total: response.total },
        })
        .catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load flagged content');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFlaggedContent();
  }, []);

  const filteredContent = useMemo(() => {
    return content.filter(item => {
      const matchesStatus =
        filteredStatus === 'all'
          ? true
          : filteredStatus === 'flagged'
          ? item.moderationStatus === 'flagged' || item.isFlagged
          : filteredStatus === 'pending'
          ? item.moderationStatus === 'approved' && item.isFlagged
          : item.moderationStatus === 'removed';

      const matchesSearch =
        searchTerm.trim().length === 0 ||
        item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.user.username.toLowerCase().includes(searchTerm.toLowerCase());

      return matchesStatus && matchesSearch;
    });
  }, [content, filteredStatus, searchTerm]);

  const handleModerationAction = async (
    item: FlaggedContentItem,
    action: 'approve' | 'remove' | 'delete'
  ) => {
    try {
      if (action === 'delete') {
        await apiClient.adminDeleteContent(item.id, 'Removed by admin moderation');
      } else {
        await apiClient.moderateContent(item.id, action, 'Admin moderation panel');
      }
      setActionMessage(`Content ${action === 'remove' ? 'removed' : action + 'd'} successfully.`);
      await loadFlaggedContent();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Moderation action failed');
    }
  };

  const exportFlaggedContent = () => {
    const csvLines = [
      ['Content ID', 'Title', 'Author', 'Visibility', 'Status', 'Flag Reason', 'Flagged At'].join(','),
      ...content.map(item =>
        [
          item.id,
          `"${item.title.replace(/"/g, '""')}"`,
          item.user.username,
          item.visibility,
          item.moderationStatus,
          item.flagReason ? `"${item.flagReason.replace(/"/g, '""')}"` : '',
          item.flaggedAt ? new Date(item.flaggedAt).toISOString() : '',
        ].join(',')
      ),
    ];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv' });
    downloadBlob(blob, 'flagged-content.csv');
  };

  return (
    <div className="space-y-6">
      <header className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Content Moderation</h1>
            <p className="mt-1 text-sm text-gray-500">
              Review and moderate flagged content across the AWS Community Content Hub.
            </p>
          </div>
          <button
            type="button"
            onClick={exportFlaggedContent}
            className="inline-flex items-center rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Export CSV
          </button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="moderation-search" className="block text-sm font-medium text-gray-700">
              Search
            </label>
            <input
              id="moderation-search"
              value={searchTerm}
              onChange={event => setSearchTerm(event.target.value)}
              placeholder="Search by title or username"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="moderation-status" className="block text-sm font-medium text-gray-700">
              Status Filter
            </label>
            <select
              id="moderation-status"
              value={filteredStatus}
              onChange={event => setFilteredStatus(event.target.value as FilterStatus)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All content</option>
              <option value="flagged">Flagged</option>
              <option value="pending">Pending review</option>
              <option value="removed">Removed</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={loadFlaggedContent}
              className="inline-flex items-center rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>
        </div>
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
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Title</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Author</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Visibility</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Flag Reason</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                    Loading flagged content…
                  </td>
                </tr>
              )}
              {!loading && filteredContent.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                    No content matches the current filters.
                  </td>
                </tr>
              )}
              {filteredContent.map(item => (
                <tr key={item.id} className="hover:bg-blue-50/50">
                  <td className="px-4 py-4">
                    <p className="font-medium text-gray-900">{item.title}</p>
                    {item.urls.length > 0 && (
                      <p className="mt-1 text-xs text-blue-600">
                        <a href={item.urls[0]} target="_blank" rel="noreferrer">
                          View Source
                        </a>
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <p className="text-gray-700">{item.user.username}</p>
                    <p className="text-xs text-gray-500">{item.user.email}</p>
                  </td>
                  <td className="px-4 py-4 text-gray-700 capitalize">{item.visibility}</td>
                  <td className="px-4 py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.moderationStatus === 'removed'
                          ? 'bg-red-100 text-red-700'
                          : item.moderationStatus === 'approved'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {item.moderationStatus}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-600">
                    {item.flagReason || '—'}
                    {item.flaggedAt && (
                      <p className="mt-1 text-xs text-gray-400">
                        Flagged {new Date(item.flaggedAt).toLocaleString()}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col space-y-2">
                      <button
                        type="button"
                        className="rounded border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100"
                        onClick={() => handleModerationAction(item, 'approve')}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                        onClick={() => handleModerationAction(item, 'remove')}
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                        onClick={() => handleModerationAction(item, 'delete')}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
