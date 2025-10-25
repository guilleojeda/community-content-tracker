'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { AdminDashboardStats } from '@/api';
import { useAdminContext } from './context';
import type { SystemHealthStatus } from '@shared/types';

export default function AdminDashboardView(): JSX.Element {
  const { currentUser } = useAdminContext();
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchDashboardData = async () => {
      try {
        const { loadSharedApiClient } = await import('@/lib/api/lazyClient');
        const apiClient = await loadSharedApiClient();
        const [dashboardStats, health] = await Promise.all([
          apiClient.getAdminDashboardStats(),
          apiClient.getAdminSystemHealth(),
        ]);

        if (!isMounted) return;

        setStats(dashboardStats);
        setSystemHealth(health);

        apiClient
          .trackAnalyticsEvents({
            eventType: 'page_view',
            metadata: {
              page: '/admin',
              role: 'admin',
            },
          })
          .catch(() => {
            /* ignore analytics failures */
          });
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load admin dashboard');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchDashboardData();

    return () => {
      isMounted = false;
    };
  }, []);

  const badgeStats = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.usersByBadgeType).map(([badge, count]) => ({
      badge,
      count,
    }));
  }, [stats]);

  if (loading) {
    return (
      <div className="bg-white shadow-sm rounded-lg p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-1/4 rounded bg-gray-200" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-24 rounded-lg bg-gray-100" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="rounded-lg border border-red-100 bg-red-50 p-6 text-red-700">
        <h2 className="text-lg font-semibold">Unable to load admin dashboard</h2>
        <p className="mt-2 text-sm">{error || 'Unknown error'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-semibold text-gray-900">Platform Overview</h2>
        <p className="text-sm text-gray-500">Key metrics for the AWS Community Content Hub administration.</p>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total Users" value={stats.totalUsers.toLocaleString()} />
          <StatCard title="AWS Employees" value={stats.awsEmployees.toLocaleString()} />
          <StatCard title="Total Content" value={stats.totalContent.toLocaleString()} />
          <StatCard title="Pending Badge Candidates" value={stats.pendingBadgeCandidates.length.toLocaleString()} />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm lg:col-span-2">
          <h3 className="text-lg font-semibold text-gray-900">Badge Distribution</h3>
          <p className="text-sm text-gray-500">Active community badges across all users.</p>
          <ul className="mt-4 space-y-3">
            {badgeStats.length === 0 && (
              <li className="rounded border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                No active badges awarded yet.
              </li>
            )}
            {badgeStats.map(({ badge, count }) => (
              <li
                key={badge}
                className="flex items-center justify-between rounded border border-gray-100 bg-gray-50 px-4 py-3 text-sm"
              >
                <span className="font-medium text-gray-700">{badge.replace(/_/g, ' ')}</span>
                <span className="text-gray-900">{count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">System Health</h3>
          <p className="text-sm text-gray-500">Realtime indicators from core services.</p>
          <div className="mt-4 space-y-3">
            <SystemHealthItem
              label="Database"
              status={systemHealth?.database ?? 'unknown'}
              timestamp={systemHealth?.timestamp}
              error={systemHealth?.error}
            />
            <SystemHealthItem
              label="Last Checked"
              status={systemHealth?.timestamp ? new Date(systemHealth.timestamp).toLocaleString() : 'Unavailable'}
            />
          </div>
          <div className="mt-6 rounded border border-blue-50 bg-blue-50 px-4 py-3 text-xs text-blue-700">
            {currentUser
              ? `Signed in as ${currentUser.username} (${currentUser.email})`
              : 'Administrator authenticated'}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Recent Registrations</h3>
          <p className="text-sm text-gray-500">New contributors joining the platform.</p>
          <div className="mt-4 overflow-hidden rounded border border-gray-100">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-gray-500">
                    Username
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-gray-500">
                    Email
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-gray-500">
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {stats.recentRegistrations.map((user) => (
                  <tr key={user.id}>
                    <td className="px-3 py-2 text-gray-900">{user.username}</td>
                    <td className="px-3 py-2 text-gray-600">{user.email}</td>
                    <td className="px-3 py-2 text-gray-500">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
                {stats.recentRegistrations.length === 0 && (
                  <tr>
                    <td className="px-3 py-4 text-center text-sm text-gray-500" colSpan={3}>
                      No recent registrations.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Badge Candidates</h3>
          <p className="text-sm text-gray-500">
            Contributors without badges who have posted notable content.
          </p>
          <ul className="mt-4 space-y-3">
            {stats.pendingBadgeCandidates.length === 0 && (
              <li className="rounded border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                No pending badge candidates at this time.
              </li>
            )}
            {stats.pendingBadgeCandidates.map((candidate) => (
              <li
                key={candidate.id}
                className="rounded border border-gray-100 bg-gray-50 px-4 py-3 text-sm"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{candidate.username}</p>
                    <p className="text-xs text-gray-500">{candidate.email}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-700 font-semibold">{candidate.contentCount}</p>
                    <p className="text-xs text-gray-500">Content pieces</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  Member since {new Date(candidate.createdAt).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Quick Actions</h3>
        <p className="text-sm text-gray-500">Review items requiring attention across the admin console.</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <QuickActionCard
            title="Flagged Content"
            count={stats.quickActions.flaggedContentCount}
            description="Awaiting moderation"
            href="/admin/moderation"
          />
          <QuickActionCard
            title="Recent Admin Actions"
            count={stats.quickActions.recentAdminActions}
            description="Last 24 hours"
            href="/admin/audit-log"
          />
          <QuickActionCard
            title="Users Without Badges"
            count={stats.quickActions.usersWithoutBadges}
            description="Consider badge nominations"
            href="/admin/users"
          />
          <QuickActionCard
            title="Content Needing Review"
            count={stats.quickActions.contentNeedingReview}
            description="Published within 7 days"
            href="/admin/moderation"
          />
        </div>
      </section>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string | number }): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className="mt-2 text-3xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function SystemHealthItem({
  label,
  status,
  timestamp,
  error,
}: {
  label: string;
  status: string;
  timestamp?: string;
  error?: string;
}): JSX.Element {
  const isHealthy = status.toLowerCase() === 'healthy';
  const isUnknown = status.toLowerCase() === 'unknown';

  return (
    <div className="rounded border border-gray-100 bg-gray-50 px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-600">{label}</p>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            isHealthy
              ? 'bg-green-100 text-green-700'
              : isUnknown
              ? 'bg-gray-200 text-gray-600'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {status}
        </span>
      </div>
      {timestamp && (
        <p className="mt-1 text-xs text-gray-500">Checked {new Date(timestamp).toLocaleString()}</p>
      )}
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function QuickActionCard({
  title,
  count,
  description,
  href,
}: {
  title: string;
  count: number;
  description: string;
  href: string;
}): JSX.Element {
  return (
    <a
      href={href}
      className="block rounded-lg border border-blue-100 bg-blue-50 px-4 py-4 shadow-sm transition hover:border-blue-200 hover:bg-blue-100"
    >
      <p className="text-sm font-medium text-blue-800">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-blue-900">{count.toLocaleString()}</p>
      <p className="mt-2 text-xs text-blue-700">{description}</p>
    </a>
  );
}
