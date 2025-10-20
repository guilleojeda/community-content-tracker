'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  apiClient,
  UserAnalyticsData,
  CsvDownload,
} from '@/api';
import { downloadBlob } from '@/utils/download';
import { BadgeType, ContentType, ExportHistoryEntry } from '@shared/types';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from 'recharts';

const PROGRAM_EXPORT_OPTIONS = [
  { value: 'community_builder', label: 'Community Builders' },
  { value: 'hero', label: 'Heroes' },
  { value: 'ambassador', label: 'Ambassadors' },
  { value: 'user_group_leader', label: 'User Group Leaders' },
] as const;

const CHART_COLORS = ['#2563eb', '#16a34a', '#f97316', '#a855f7', '#f43f5e', '#14b8a6'];

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

  const loadAnalytics = async (override?: Partial<typeof filters>) => {
    setLoading(true);
    setError(null);
    try {
      const params = { ...filters, ...override };
      const data = await apiClient.getUserAnalytics({
        startDate: params.startDate,
        endDate: params.endDate,
        groupBy: params.groupBy,
      });
      setAnalytics(data);
      apiClient
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
  };

  const loadExportHistory = async (override?: { limit?: number; offset?: number }) => {
    setHistoryLoading(true);
    setHistoryError(null);

    try {
      const limit = override?.limit ?? historyPagination.limit ?? 10;
      const offset = override?.offset ?? (override?.offset === 0 ? 0 : historyPagination.offset ?? 0);
      const response = await apiClient.getExportHistory({ limit, offset });
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
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadAnalytics();
    loadExportHistory({ offset: 0 });
  }, []);

  const handleExportAnalytics = async () => {
    setExporting(true);
    try {
      const download = await apiClient.exportAnalyticsCsv(filters);
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
      const download = await apiClient.exportProgramCsv({
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
          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Content Views Over Time</h2>
              <p className="text-sm text-gray-500">
                Engagement trend grouped by {filters.groupBy}.
              </p>
              <div className="mt-4 h-64">
                {timeSeries.length === 0 ? (
                  <EmptyState message="No analytics data for the selected range." />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timeSeries}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={value => new Date(value).toLocaleDateString()}
                      />
                      <YAxis />
                      <Tooltip
                        labelFormatter={value => new Date(value).toLocaleString()}
                      />
                      <Line type="monotone" dataKey="views" stroke="#2563eb" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Channel Performance</h2>
              <p className="text-sm text-gray-500">
                Distribution of content types published on the platform.
              </p>
              <div className="mt-4 h-64">
                {contentDistribution.length === 0 ? (
                  <EmptyState message="Add content to view channel performance." />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={contentDistribution}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="type" tickFormatter={value => value.replace(/_/g, ' ')} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="value" fill="#16a34a" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Topic Distribution</h2>
              <p className="text-sm text-gray-500">
                Top tags across your published content.
              </p>
              <div className="mt-4 h-64">
                {topTags.length === 0 ? (
                  <EmptyState message="No tag analytics available yet." />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={topTags}
                        dataKey="count"
                        nameKey="tag"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={({ name }) => name}
                      >
                        {topTags.map((_, index) => (
                          <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Top Performing Content</h2>
              <p className="text-sm text-gray-500">
                Content items ranked by total views.
              </p>
              <div className="mt-4 space-y-3">
                {topContent.length === 0 && (
                  <EmptyState message="Performance metrics unavailable for the selected range." />
                )}
                {topContent.map(item => (
                  <div key={item.id} className="rounded border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
                    <p className="font-medium text-gray-900">{item.title}</p>
                    <p className="text-xs text-gray-500">
                      {item.contentType} · {item.views.toLocaleString()} views
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

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

function EmptyState({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center rounded border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500">
      {message}
    </div>
  );
}

function triggerDownload(download: CsvDownload, fallbackName: string): void {
  downloadBlob(download.blob, download.filename ?? fallbackName);
}
