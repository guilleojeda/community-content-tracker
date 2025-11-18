'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { UserAnalyticsData, CsvDownload } from '@/api';
import { downloadBlob } from '@/utils/download';
import { BadgeType, ContentType, ExportHistoryEntry } from '@shared/types';
import { EmptyState } from './components/EmptyState';
import { loadSharedApiClient } from '@/lib/api/lazyClient';

const AnalyticsVisualizations = dynamic(
  () => import('./components/AnalyticsVisualizations'),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6">
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
          Loading charts…
        </div>
      </div>
    ),
  }
);

const PROGRAM_EXPORT_OPTIONS = [
  { value: 'community_builder', label: 'Community Builders' },
  { value: 'hero', label: 'Heroes' },
  { value: 'ambassador', label: 'Ambassadors' },
  { value: 'user_group_leader', label: 'User Group Leaders' },
] as const;

export default function AnalyticsDashboardPage(): JSX.Element {
  const [analytics, setAnalytics] = useState<UserAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<{
    startDate?: string;
    endDate?: string;
    groupBy: 'day' | 'week' | 'month';
  }>({
    groupBy: 'day',
  });

  const [exportProgram, setExportProgram] = useState<typeof PROGRAM_EXPORT_OPTIONS[number]['value']>(
    'community_builder'
  );
  const [exportRange, setExportRange] = useState<{ startDate?: string; endDate?: string }>({});
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<ExportHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyPagination, setHistoryPagination] = useState({ total: 0, limit: 10, offset: 0 });

  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const historyPaginationRef = useRef(historyPagination);
  useEffect(() => {
    historyPaginationRef.current = historyPagination;
  }, [historyPagination]);

  const loadAnalytics = useCallback(async (override?: Partial<typeof filters>) => {
    setLoading(true);
    setError(null);
    try {
      const params = { ...filtersRef.current, ...override };
      const client = await loadSharedApiClient();
      const data = await client.getUserAnalytics({
        startDate: params.startDate,
        endDate: params.endDate,
        groupBy: params.groupBy,
      });
      setAnalytics(data);
      client
        .trackAnalyticsEvents({
          eventType: 'page_view',
          metadata: {
            page: '/dashboard/analytics',
            groupBy: params.groupBy,
            hasDateRange: Boolean(params.startDate && params.endDate),
          },
        })
        .catch(() => {});
      setFilters(prev => ({ ...prev, ...override }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadExportHistory = useCallback(async (override?: { limit?: number; offset?: number }) => {
    setHistoryLoading(true);
    setHistoryError(null);

    try {
      const currentPagination = historyPaginationRef.current;
      const limit = override?.limit ?? currentPagination.limit ?? 10;
      const offset = override?.offset ?? (override?.offset === 0 ? 0 : currentPagination.offset ?? 0);
      const client = await loadSharedApiClient();
      const response = await client.getExportHistory({ limit, offset });
      setHistory(response.history);
      setHistoryPagination({
        total: response.total,
        limit: response.limit,
        offset: response.offset,
      });
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Failed to load export history.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
    loadExportHistory({ offset: 0 });
  }, [loadAnalytics, loadExportHistory]);

  const handleExportAnalytics = async () => {
    setExporting(true);
    try {
      const client = await loadSharedApiClient();
      const download = await client.exportAnalyticsCsv(filters);
      triggerDownload(download, 'analytics-export.csv');
      setMessage('Analytics CSV exported successfully.');
      await loadExportHistory({ offset: 0 });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to export analytics CSV');
    } finally {
      setExporting(false);
    }
  };

  const handleProgramExport = async () => {
    setExporting(true);
    try {
      const client = await loadSharedApiClient();
      const download = await client.exportProgramCsv({
        programType: exportProgram,
        startDate: exportRange.startDate,
        endDate: exportRange.endDate,
      });
      triggerDownload(download, `${exportProgram}-export.csv`);
      setMessage('Program-specific CSV exported successfully.');
      await loadExportHistory({ offset: 0 });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to export program CSV');
    } finally {
      setExporting(false);
    }
  };

  const contentDistribution = useMemo(() => {
    if (!analytics) return [];
    return Object.entries(analytics.contentByType).map(([type, value]) => ({
      type,
      value,
    }));
  }, [analytics]);

  const topTags = analytics?.topTags ?? [];
  const topContent = analytics?.topContent ?? [];
  const timeSeries = analytics?.timeSeries ?? [];
  const historyLimit = historyPagination.limit || 10;
  const historyTotalPages = Math.max(1, Math.ceil((historyPagination.total || 0) / historyLimit));
  const historyCurrentPage = Math.floor((historyPagination.offset || 0) / historyLimit) + 1;

  return (
    <div className="space-y-6">
      <header className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Analytics Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Track performance across channels, topics, and content categories.
        </p>
        <form
          className="mt-4 grid gap-4 md:grid-cols-4"
          onSubmit={event => {
            event.preventDefault();
            loadAnalytics();
          }}
        >
          <div>
            <label htmlFor="start-date" className="block text-sm font-medium text-gray-700">
              Start Date
            </label>
            <input
              id="start-date"
              type="date"
              value={filters.startDate || ''}
              onChange={event => setFilters(prev => ({ ...prev, startDate: event.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="group-by" className="block text-sm font-medium text-gray-700">
              Group By
            </label>
            <select
              id="group-by"
              value={filters.groupBy}
              onChange={event =>
                setFilters(prev => ({ ...prev, groupBy: event.target.value as 'day' | 'week' | 'month' }))
              }
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </div>
          <div className="flex items-end justify-end space-x-3">
            <button
              type="button"
              onClick={() => {
                setFilters({ groupBy: 'day' });
                loadAnalytics({ startDate: undefined, endDate: undefined, groupBy: 'day' });
              }}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => loadAnalytics()}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Apply
            </button>
          </div>
        </form>
      </header>

      {message && (
        <div className="rounded border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {message}
        </div>
      )}

      {error && (
        <div className="rounded border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
          Loading analytics…
        </div>
      )}

      {!loading && analytics && (
        <div className="space-y-6">
          <AnalyticsVisualizations
            timeSeries={timeSeries}
            contentDistribution={contentDistribution}
            topTags={topTags}
            topContent={topContent}
            groupBy={filters.groupBy}
          />

          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Exports</h2>
            <p className="text-sm text-gray-500">
              Generate analytics CSVs for reporting and AWS program submissions.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
                <h3 className="font-semibold text-gray-900">Analytics Export</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Downloads the analytics dataset using the filters above.
                </p>
                <button
                  type="button"
                  disabled={exporting}
                  onClick={handleExportAnalytics}
                  className="mt-3 inline-flex items-center rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Export Analytics CSV
                </button>
              </div>
              <div className="rounded border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
                <h3 className="font-semibold text-gray-900">Program Export</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Generate CSV formatted for AWS program submissions.
                </p>
                <div className="mt-3 space-y-2">
                  <select
                    value={exportProgram}
                    onChange={event =>
                      setExportProgram(event.target.value as typeof PROGRAM_EXPORT_OPTIONS[number]['value'])
                    }
                    className="w-full rounded border border-gray-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {PROGRAM_EXPORT_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={exportRange.startDate || ''}
                      onChange={event => setExportRange(prev => ({ ...prev, startDate: event.target.value }))}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <input
                      type="date"
                      value={exportRange.endDate || ''}
                      onChange={event => setExportRange(prev => ({ ...prev, endDate: event.target.value }))}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={exporting}
                    onClick={handleProgramExport}
                    className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Export Program CSV
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Export History</h2>
                <p className="text-sm text-gray-500">Review your recent analytics and program exports.</p>
              </div>
              {historyPagination.total > historyPagination.limit && history.length > 0 && (
                <div className="flex items-center gap-3 text-sm text-gray-600">
                  <button
                    type="button"
                    className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => loadExportHistory({ offset: Math.max(0, historyPagination.offset - historyPagination.limit) })}
                    disabled={historyPagination.offset === 0 || historyLoading}
                  >
                    Previous
                  </button>
                  <span>
                    Page {historyCurrentPage} of {historyTotalPages}
                  </span>
                  <button
                    type="button"
                    className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => loadExportHistory({ offset: historyPagination.offset + historyPagination.limit })}
                    disabled={historyPagination.offset + historyPagination.limit >= historyPagination.total || historyLoading}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>

            {historyError && (
              <div className="mt-4 rounded border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                {historyError}
              </div>
            )}

            {historyLoading ? (
              <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                Loading export history…
              </div>
            ) : history.length === 0 ? (
              <EmptyState message="No export history yet." />
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Exported On</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Type</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Details</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Rows</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {history.map(entry => {
                      const exportedOn = new Date(entry.createdAt).toLocaleString();
                      const dateRange = [entry.parameters.startDate, entry.parameters.endDate]
                        .filter(Boolean)
                        .join(' → ');

                      let details = '';
                      if (entry.exportType === 'program') {
                        const program = entry.parameters.programType ?? entry.exportFormat ?? 'Program export';
                        details = `Program: ${program}`;
                        if (dateRange) {
                          details += ` • Range: ${dateRange}`;
                        }
                      } else if (entry.exportType === 'analytics') {
                        details = 'Analytics CSV export';
                        if (entry.parameters.groupBy) {
                          details += ` • Group By: ${entry.parameters.groupBy}`;
                        }
                        if (dateRange) {
                          details += ` • Range: ${dateRange}`;
                        }
                      } else {
                        details = entry.exportFormat ?? entry.exportType;
                      }

                      return (
                        <tr key={entry.id}>
                          <td className="px-3 py-2 text-gray-900">{exportedOn}</td>
                          <td className="px-3 py-2 capitalize text-gray-600">{entry.exportType.replace(/_/g, ' ')}</td>
                          <td className="px-3 py-2 text-gray-600">{details || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{entry.rowCount ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function triggerDownload(download: CsvDownload, fallbackName: string): void {
  downloadBlob(download.blob, download.filename ?? fallbackName);
}
